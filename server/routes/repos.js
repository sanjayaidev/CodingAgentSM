// routes/repos.js
import express from 'express';
import { listGithubRepos } from '../lib/github.js';
import { cloneOrUpdateRepo } from '../lib/git.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.githubToken || !req.session.user) {
    return res.status(401).json({ error: 'Not logged in. Visit /api/auth/github to log in.' });
  }
  next();
}

// List repos the logged-in user can access
router.get('/', requireAuth, async (req, res) => {
  try {
    const repos = await listGithubRepos(req.session.githubToken);
    res.json({ repos, total: repos.length });
  } catch (error) {
    console.error('[Repos] List failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clone (or update) a repo locally and return its filesystem path
router.post('/clone', requireAuth, async (req, res) => {
  const { fullName, cloneUrl, defaultBranch } = req.body;

  if (!fullName || !cloneUrl) {
    return res.status(400).json({ error: 'fullName and cloneUrl are required' });
  }

  try {
    const localPath = await cloneOrUpdateRepo({
      token: req.session.githubToken,
      githubLogin: req.session.user.login,
      fullName,
      cloneUrl,
      defaultBranch,
      authorName: req.session.user.name,
      authorEmail: req.session.user.email,
    });

    res.json({ success: true, path: localPath });
  } catch (error) {
    console.error('[Repos] Clone failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
