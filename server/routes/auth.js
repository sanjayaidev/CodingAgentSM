// routes/auth.js
import express from 'express';
import crypto from 'crypto';
import { exchangeCodeForToken, getGithubUser } from '../lib/github.js';

const router = express.Router();

// Step 1: kick off GitHub OAuth
router.get('/github', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(500).send('GITHUB_CLIENT_ID is not configured on the server.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.APP_BASE_URL}/api/auth/github/callback`,
    scope: 'repo read:user user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// Step 2: GitHub redirects back here with a code
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid OAuth state. Please try logging in again.');
  }
  delete req.session.oauthState;

  try {
    const token = await exchangeCodeForToken(code);
    const user = await getGithubUser(token);

    req.session.githubToken = token;
    req.session.user = {
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
      email: user.email,
    };

    res.redirect('/');
  } catch (error) {
    console.error('[Auth] OAuth callback failed:', error);
    res.status(500).send(`Login failed: ${error.message}`);
  }
});

// Current session's user, if any
router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json({ user: req.session.user });
});

// Log out
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

export default router;
