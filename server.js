const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;

// Shared secret to protect this endpoint from random internet traffic
const AGENT_API_KEY = process.env.AGENT_API_KEY || '';

// NIM connection details (OpenAI-compatible)
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY || '';
const DEFAULT_MODEL = process.env.NIM_MODEL || 'qwen/qwen2.5-coder-32b-instruct';

// Fallback GitHub token if the caller doesn't pass one per-request
const DEFAULT_GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const WORKSPACES_DIR = path.join(__dirname, 'workspaces');
if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

function requireApiKey(req, res, next) {
  if (!AGENT_API_KEY) return next(); // no key configured = open (fine for local testing only)
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key === AGENT_API_KEY) return next();
  return res.status(401).json({ error: 'Invalid or missing x-api-key' });
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

app.post('/agent/run', requireApiKey, async (req, res) => {
  const {
    repoUrl,
    task,
    baseBranch = 'main',
    githubToken,
    model,
    prTitle,
    prBody
  } = req.body;

  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });
  if (!task) return res.status(400).json({ error: 'task is required (instructions for aider)' });

  const token = githubToken || DEFAULT_GITHUB_TOKEN;
  if (!token) return res.status(400).json({ error: 'No GitHub token provided (body.githubToken or GITHUB_TOKEN env var)' });

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
    if (authError) step('Detected GitHub auth failure — token is likely invalid or revoked');
    return res.status(authError ? 401 : 500).json({
      ok: false,
      error: err.message,
      authError,
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Coding agent server listening on port ${PORT}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
  console.log(`NIM base: ${NIM_API_BASE}`);
});
