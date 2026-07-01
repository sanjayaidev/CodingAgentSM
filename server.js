const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
// Railway terminates TLS and forwards requests internally over HTTP; without
// this, req.protocol always reports 'http' even on a https:// request, which
// makes the OAuth redirect_uri we build not match what's registered on the
// GitHub OAuth App ("redirect_uri is not associated with this application").
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Shared secret to protect /agent/run from random internet traffic when
// called server-to-server (e.g. from another backend). The built-in UI
// below does NOT use this — it authenticates via the session cookie
// created by the GitHub OAuth flow instead.
const AGENT_API_KEY = process.env.AGENT_API_KEY || '';

// NIM connection details (OpenAI-compatible) — this is "our own API for AI
// calls": aider talks to NVIDIA NIM using these, never anything client-side.
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY || '';
const ALLOWED_MODELS = [
  'abacusai/dracarys-llama-3.1-70b-instruct',
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-1b-instruct',
  'meta/llama-3.2-3b-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-4-maverick-17b-128e-instruct',
  'meta/llama-guard-4-12b',
  'mistralai/ministral-14b-instruct-2512',
  'mistralai/mistral-large-3-675b-instruct-2512',
  'mistralai/mistral-medium-3.5-128b',
  'mistralai/mistral-small-4-119b-2603',
  'mistralai/mixtral-8x7b-instruct-v0.1',
  'moonshotai/kimi-k2.6',
  'nvidia/llama-3.1-nemoguard-8b-content-safety',
  'nvidia/llama-3.1-nemoguard-8b-topic-control',
];
const DEFAULT_MODEL = process.env.NIM_MODEL && ALLOWED_MODELS.includes(process.env.NIM_MODEL)
  ? process.env.NIM_MODEL
  : 'meta/llama-3.3-70b-instruct';

function isAllowedModel(modelId) {
  return ALLOWED_MODELS.includes(modelId);
}

const CODING_MODELS = [...new Set([DEFAULT_MODEL, ...ALLOWED_MODELS])];

// Fallback GitHub token if no one is connected via the UI and no per-request
// token is supplied (server-to-server callers only).
const DEFAULT_GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// GitHub OAuth App credentials — register an app at
// https://github.com/settings/developers with callback URL
// `${APP_BASE_URL}/auth/github/callback`.
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
// Public URL this app is deployed at, e.g. https://your-app.up.railway.app
// Falls back to inferring from the incoming request if unset.
const APP_BASE_URL = process.env.APP_BASE_URL || '';

const WORKSPACES_DIR = path.join(__dirname, 'workspaces');
if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

// ---- minimal cookie-session store (no extra deps) ----
// In-memory: sessionId -> { githubToken, githubLogin, createdAt }.
// Single-instance, lost on redeploy/restart — fine for a personal-use app;
// the user just clicks "Connect GitHub" again. If you scale to multiple
// Railway replicas later, swap this Map for Redis/Postgres.
const sessions = new Map();

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function appendSetCookie(res, cookieStr) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', [cookieStr]);
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, cookieStr]);
  else res.setHeader('Set-Cookie', [prev, cookieStr]);
}

function setCookie(res, name, value, { maxAge } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge) parts.push(`Max-Age=${maxAge}`);
  if (IS_PROD) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

function clearCookie(res, name) {
  appendSetCookie(res, `${name}=; Path=/; Max-Age=0`);
}

function getSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  return sessions.get(sid) || null;
}

function baseUrlFor(req) {
  return APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// Auth for /agent/run: accepts EITHER a valid x-api-key (server-to-server
// callers, per README) OR a logged-in browser session (the built-in UI).
// Populates req.githubToken and req.authSource either way.
function resolveAgentAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (AGENT_API_KEY && key === AGENT_API_KEY) {
    req.authSource = 'api-key';
    req.githubToken = req.body.githubToken || DEFAULT_GITHUB_TOKEN;
    return next();
  }
  const session = getSession(req);
  if (session) {
    req.authSource = 'session';
    req.githubToken = session.githubToken;
    return next();
  }
  if (!AGENT_API_KEY) {
    // No key configured at all — allow through for local testing only.
    req.authSource = 'open';
    req.githubToken = req.body.githubToken || DEFAULT_GITHUB_TOKEN;
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated — connect GitHub in the UI, or pass a valid x-api-key' });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 50, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseOwnerRepo(repoUrl) {
  // Handles https://github.com/owner/repo or https://github.com/owner/repo.git
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
  if (!match) throw new Error(`Could not parse owner/repo from: ${repoUrl}`);
  return { owner: match[1], repo: match[2] };
}

function buildAuthedCloneUrl(repoUrl, token) {
  if (!token) return repoUrl;
  return repoUrl.replace('https://', `https://x-access-token:${token}@`);
}

// Detects whether a git/GitHub-API failure was due to a bad/revoked token,
// as opposed to some other error (network, missing branch, etc.) — so the
// caller can tell the client "reconnect GitHub" specifically.
function isGithubAuthError(err) {
  const text = `${err.message || ''} ${err.stderr || ''}`.toLowerCase();
  return (
    text.includes('authentication failed') ||
    text.includes('invalid username or token') ||
    text.includes('bad credentials') ||
    text.includes('403') ||
    text.includes('401')
  );
}

async function openPullRequest({ owner, repo, token, head, base, title, body }) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ title, head, base, body })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GitHub PR creation failed (${res.status}): ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

app.post('/agent/run', resolveAgentAuth, async (req, res) => {
  const {
    repoUrl,
    task,
    baseBranch = 'main',
    model,
    prTitle,
    prBody
  } = req.body;

  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });
  if (!task) return res.status(400).json({ error: 'task is required (instructions for aider)' });

  const token = req.githubToken;
  if (!token) {
    return res.status(400).json({
      error: req.authSource === 'session'
        ? 'No GitHub token on your session — reconnect GitHub'
        : 'No GitHub token provided (body.githubToken or GITHUB_TOKEN env var)'
    });
  }

  if (!NIM_API_KEY) return res.status(500).json({ error: 'NIM_API_KEY is not configured on the server' });

  let owner, repo;
  try {
    ({ owner, repo } = parseOwnerRepo(repoUrl));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const runId = crypto.randomBytes(6).toString('hex');
  const workDir = path.join(WORKSPACES_DIR, `${repo}-${runId}`);
  const branchName = `aider/${runId}`;
  const chosenModel = model || DEFAULT_MODEL;

  const log = [];
  const step = (msg) => { console.log(`[${runId}] ${msg}`); log.push(msg); };

  try {
    step(`Cloning ${owner}/${repo}@${baseBranch}`);
    const cloneUrl = buildAuthedCloneUrl(repoUrl, token);
    await run('git', ['clone', '--depth', '1', '--branch', baseBranch, cloneUrl, workDir]);

    step(`Creating branch ${branchName}`);
    await run('git', ['checkout', '-b', branchName], { cwd: workDir });

    // Set a commit identity so aider's auto-commits don't fail
    await run('git', ['config', 'user.email', 'coding-agent@bot.local'], { cwd: workDir });
    await run('git', ['config', 'user.name', 'Coding Agent'], { cwd: workDir });

    step(`Running aider with model ${chosenModel}`);
    const aiderEnv = {
      ...process.env,
      OPENAI_API_BASE: NIM_API_BASE,
      OPENAI_API_KEY: NIM_API_KEY
    };
    const aiderArgs = [
      '--yes-always',
      '--no-check-update',
      '--model', `openai/${chosenModel}`,
      '--message', task,
      '--no-gitignore'
    ];
    let aiderResult;
    try {
      aiderResult = await run('aider', aiderArgs, { cwd: workDir, env: aiderEnv });
      step('Aider finished successfully');
    } catch (aiderErr) {
      // aider can exit non-zero even after making valid partial progress; capture output either way
      step(`Aider exited with error: ${aiderErr.message}`);
      aiderResult = { stdout: aiderErr.stdout || '', stderr: aiderErr.stderr || '' };
    }

    // Check whether aider actually produced any commits on top of base
    const { stdout: diffStat } = await run('git', ['diff', '--stat', `origin/${baseBranch}`, 'HEAD'], { cwd: workDir });
    if (!diffStat.trim()) {
      step('No changes were made by aider — skipping push/PR');
      cleanup(workDir);
      return res.json({
        ok: true,
        changed: false,
        message: 'Aider made no changes for this task',
        aiderOutput: aiderResult.stdout,
        log
      });
    }

    step(`Pushing branch ${branchName}`);
    await run('git', ['push', 'origin', branchName], { cwd: workDir });

    step('Opening pull request');
    const pr = await openPullRequest({
      owner,
      repo,
      token,
      head: branchName,
      base: baseBranch,
      title: prTitle || `Aider: ${task.slice(0, 60)}`,
      body: prBody || `Automated change requested via coding agent.\n\n**Task:**\n${task}\n\n**Model:** ${chosenModel}`
    });

    step(`PR opened: ${pr.html_url}`);
    cleanup(workDir);

    return res.json({
      ok: true,
      changed: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch: branchName,
      aiderOutput: aiderResult.stdout,
      log
    });
  } catch (err) {
    step(`Failed: ${err.message}`);
    cleanup(workDir);
    const authError = isGithubAuthError(err);
    if (authError) {
      step('Detected GitHub auth failure — token is likely invalid or revoked');
      if (req.authSource === 'session') {
        const sid = parseCookies(req).sid;
        if (sid) sessions.delete(sid);
      }
    }
    return res.status(authError ? 401 : 500).json({
      ok: false,
      error: err.message,
      authError,
      reconnectRequired: authError && req.authSource === 'session',
      stderr: err.stderr || null,
      log
    });
  }
});

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

app.get('/health', (req, res) => res.json({ ok: true }));

// ---- GitHub OAuth (connect account) ----

app.get('/auth/github', (req, res) => {
  if (!GITHUB_CLIENT_ID) return res.status(500).send('GITHUB_CLIENT_ID is not configured on the server');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'oauth_state', state, { maxAge: 600 });
  const redirectUri = `${baseUrlFor(req)}/auth/github/callback`;
  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'repo'); // needed for clone/push/PR on private + public repos
  authUrl.searchParams.set('state', state);
  res.redirect(authUrl.toString());
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, state } = req.query;
  const cookies = parseCookies(req);
  if (!code || !state || state !== cookies.oauth_state) {
    return res.status(400).send('GitHub sign-in failed (invalid or expired state). Go back and try connecting again.');
  }
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${baseUrlFor(req)}/auth/github/callback`,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).send(`GitHub sign-in failed: ${tokenData.error_description || JSON.stringify(tokenData)}`);
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'coding-agent' },
    });
    const userData = await userRes.json();

    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, {
      githubToken: tokenData.access_token,
      githubLogin: userData.login || null,
      createdAt: Date.now(),
    });
    setCookie(res, 'sid', sid, { maxAge: 60 * 60 * 24 * 7 }); // 7 days
    clearCookie(res, 'oauth_state');
    res.redirect('/');
  } catch (err) {
    res.status(500).send(`GitHub sign-in failed: ${err.message}`);
  }
});

app.post('/auth/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) sessions.delete(sid);
  clearCookie(res, 'sid');
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ loggedIn: false, githubConfigured: Boolean(GITHUB_CLIENT_ID) });
  res.json({ loggedIn: true, githubLogin: session.githubLogin });
});

// ---- repo picker ----

app.get('/api/repos', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not connected to GitHub yet' });
  try {
    const repos = [];
    for (let page = 1; page <= 3; page++) {
      const r = await fetch(`https://api.github.com/user/repos?sort=updated&per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${session.githubToken}`, 'User-Agent': 'coding-agent' },
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: errBody.message || 'Failed to list repos from GitHub' });
      }
      const batch = await r.json();
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    res.json({
      repos: repos.map((r) => ({
        fullName: r.full_name,
        htmlUrl: r.html_url,
        defaultBranch: r.default_branch,
        private: r.private,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/models', (req, res) => {
  res.json({ models: ALLOWED_MODELS, default: DEFAULT_MODEL });
});

app.post('/api/chat', async (req, res) => {
  const { messages = [], model } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (!NIM_API_KEY) {
    return res.status(500).json({ error: 'NIM_API_KEY is not configured on the server' });
  }

  const selectedModel = isAllowedModel(model) ? model : DEFAULT_MODEL;
  try {
    const response = await fetch(`${NIM_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: 0.2,
        max_tokens: 1800,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || `NVIDIA API request failed (${response.status})`);
    }

    const content = data.choices?.[0]?.message?.content || '';
    return res.json({ message: content, model: selectedModel });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to reach NVIDIA NIM' });
  }
});

// ---- static UI ----
// Serves public/index.html at '/' (fixes "Cannot GET /") and the agent
// dashboard. Must come after the API routes above so nothing shadows them.
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Coding agent server listening on port ${PORT}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
  console.log(`NIM base: ${NIM_API_BASE}`);
});
