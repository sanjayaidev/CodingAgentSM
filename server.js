const express = require('express');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./lib/db');
const { resolveBaseUrl } = require('./lib/github-oauth');

const app = express();
// Railway terminates TLS and forwards requests internally over HTTP; without
// this, req.protocol always reports 'http' even on a https:// request, which
// makes the OAuth redirect_uri we build not match what's registered on the
// GitHub OAuth App ("redirect_uri is not associated with this application").
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// CORS — this app is meant to be callable as an API from external services
// (per-request auth is via x-api-key or session cookie, see resolveAgentAuth
// / resolveApiAuth below), so we allow cross-origin requests here rather
// than locking responses to same-origin.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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
  : 'moonshotai/kimi-k2.6';

// Best-effort context window (tokens) used only to show a "% of context used"
// hint in the UI/API responses. NIM doesn't expose this per-model, so it's
// configurable and defaults to a conservative common size.
const NIM_CONTEXT_WINDOW = parseInt(process.env.NIM_CONTEXT_WINDOW || '32768', 10);

// Rough fallback token estimate (~4 chars/token) for places where we don't
// get an exact count back from the API — e.g. the conversation context we
// fold into an aider task, since aider's own token usage isn't returned to
// this process in a structured way.
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

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
const RAILWAY_PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || '';

const WORKSPACES_DIR = path.join(__dirname, 'workspaces');
if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

// ---- cookie-session store ----
// In-memory Map: sessionId -> { githubToken, githubLogin, createdAt }.
// Doubles as a request-scoped cache in front of Postgres (see lib/db.js)
// when DATABASE_URL is set — reads hit the Map first, writes go to both.
// Without DATABASE_URL this behaves exactly as before: single-instance,
// lost on redeploy/restart, just click "Connect GitHub" again.
const sessions = new Map();

async function createSession(sid, data) {
  sessions.set(sid, data);
  if (db.enabled) await db.saveSession(sid, data);
}

async function fetchSession(sid) {
  if (sessions.has(sid)) return sessions.get(sid);
  if (db.enabled) {
    const fromDb = await db.getSession(sid);
    if (fromDb) sessions.set(sid, fromDb);
    return fromDb;
  }
  return null;
}

async function removeSession(sid) {
  sessions.delete(sid);
  if (db.enabled) await db.deleteSession(sid);
}

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

async function getSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  return fetchSession(sid);
}

function baseUrlFor(req) {
  const baseUrl = resolveBaseUrl({
    appBaseUrl: APP_BASE_URL,
    railwayPublicDomain: RAILWAY_PUBLIC_DOMAIN,
    req,
  });
  return baseUrl;
}

// Auth for /agent/run: accepts EITHER a valid x-api-key (server-to-server
// callers, per README) OR a logged-in browser session (the built-in UI).
// Populates req.githubToken and req.authSource either way.
async function resolveAgentAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (AGENT_API_KEY && key === AGENT_API_KEY) {
    req.authSource = 'api-key';
    req.githubToken = req.body.githubToken || DEFAULT_GITHUB_TOKEN;
    return next();
  }
  const session = await getSession(req);
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

// Lighter auth for endpoints that don't need a GitHub token (chat, console).
// Accepts x-api-key (external/server-to-server callers) OR a logged-in
// browser session; open (unauthenticated) only if no AGENT_API_KEY is set.
async function resolveApiAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (AGENT_API_KEY && key === AGENT_API_KEY) {
    req.authSource = 'api-key';
    return next();
  }
  const session = await getSession(req);
  if (session) {
    req.authSource = 'session';
    req.githubToken = session.githubToken;
    return next();
  }
  if (!AGENT_API_KEY) {
    req.authSource = 'open';
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

function sanitizeCommitMessage(message) {
  return String(message || 'update').replace(/\s+/g, ' ').trim().slice(0, 120) || 'update';
}

// Aider's own bookkeeping files (chat history, input history, tag cache)
// must never end up in a PR. We keep them out of the repo entirely (see
// --chat-history-file / --input-history-file in runAgentTask), but this
// exclusion is kept as a second line of defense in case aider or some other
// tool drops files matching these patterns into the working tree anyway.
//
// .godot/ is Godot 4's own generated import/UID cache — running the engine
// (even --headless, even just to open/check a project) creates it. Most
// Godot project templates .gitignore it already, but not all do, and
// forgetting it is the exact same class of bug as the aider log leak: a
// generated directory silently riding along into a commit. Excluded here
// unconditionally so it can never happen regardless of the target repo's
// own .gitignore.
const COMMIT_EXCLUDE_PATHSPECS = [
  ':(exclude).aider*',
  ':(exclude)**/.aider*',
  ':(exclude).godot',
  ':(exclude)**/.godot',
];

async function commitPendingChanges({ cwd, task, step }) {
  const { stdout: statusBefore } = await run(
    'git', ['status', '--short', '--', '.', ...COMMIT_EXCLUDE_PATHSPECS], { cwd }
  );
  if (!statusBefore.trim()) {
    return { committed: false, status: '' };
  }

  if (step) step('Staging and committing file changes');
  await run('git', ['add', '-A', '--', '.', ...COMMIT_EXCLUDE_PATHSPECS], { cwd });

  // If everything staged after the exclusion is empty (e.g. the only diff
  // WAS an aider log file), there's nothing real to commit.
  const { stdout: staged } = await run('git', ['diff', '--cached', '--stat'], { cwd });
  if (!staged.trim()) {
    await run('git', ['reset'], { cwd }).catch(() => {});
    return { committed: false, status: '' };
  }

  await run('git', ['commit', '-m', `Aider: ${sanitizeCommitMessage(task)}`], { cwd });

  const { stdout: statusAfter } = await run('git', ['status', '--short'], { cwd });
  return { committed: true, status: statusAfter.trim() };
}

// Previously this gated on a keyword regex (isRepoQuestionPrompt) trying to
// guess "is this a question about the repo" from the message text — that
// missed ordinary phrasings like "read the readme" or "what's in there",
// silently falling back to a plain chat call with zero repo context. Now:
// if the caller selected a repo (repoUrl present) and we're on the plain
// chat path at all (action/edit requests already went to /agent/run
// instead), just always attach context. REPO_CONTEXT_CACHE below keeps this
// cheap by avoiding a fresh clone on every turn of the same conversation.
const REPO_CONTEXT_CACHE = new Map(); // `${repoUrl}@${baseBranch}` -> { context, at }
const REPO_CONTEXT_TTL_MS = 5 * 60 * 1000;

async function getCachedRepositoryContext({ repoUrl, baseBranch, token }) {
  const key = `${repoUrl}@${baseBranch || 'main'}`;
  const cached = REPO_CONTEXT_CACHE.get(key);
  if (cached && Date.now() - cached.at < REPO_CONTEXT_TTL_MS) {
    return cached.context;
  }
  const context = await collectRepositoryContext({ repoUrl, baseBranch, token });
  REPO_CONTEXT_CACHE.set(key, { context, at: Date.now() });
  return context;
}

async function collectRepositoryContext({ cwd, repoUrl, baseBranch = 'main', token } = {}) {
  let tempDir = cwd;
  let shouldCleanup = false;

  if (repoUrl && !tempDir) {
    tempDir = fs.mkdtempSync(path.join(WORKSPACES_DIR, 'repo-context-'));
    shouldCleanup = true;
    const cloneUrl = buildAuthedCloneUrl(repoUrl, token);
    await run('git', ['clone', '--depth', '1', '--branch', baseBranch, cloneUrl, tempDir]);
  }

  if (!tempDir || !fs.existsSync(tempDir)) {
    throw new Error('Repository workspace could not be prepared');
  }

  const topLevelEntries = fs.readdirSync(tempDir, { withFileTypes: true });
  const topLevelFiles = topLevelEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .slice(0, 40)
    .join(', ') || '(none)';

  const candidateFiles = [
    'README.md',
    'readme.md',
    'package.json',
    'server.js',
    'index.js',
    'app.js',
    'src/index.js',
    'src/main.js',
    'src/app.js',
    'public/index.html',
    'index.html',
    'main.py',
    'requirements.txt',
    'pyproject.toml',
    'Dockerfile',
    'docker-compose.yml',
    'railway.json',
    'vercel.json',
    'tsconfig.json',
    '.env.example',
  ];

  const snippets = [];
  for (const relPath of candidateFiles) {
    const absPath = path.join(tempDir, relPath);
    if (!fs.existsSync(absPath)) continue;
    let content = fs.readFileSync(absPath, 'utf8').replace(/\r/g, '');
    content = content.split('\n').slice(0, 80).join('\n').trim();
    if (!content) continue;
    snippets.push(`File: ${relPath}\n${content.slice(0, 4000)}`);
  }

  if (snippets.length === 0) {
    snippets.push(`No obvious source files found. Top-level files: ${topLevelFiles}`);
  }

  const label = repoUrl || path.basename(tempDir);
  const result = `Repository context for ${label}\nTop-level files: ${topLevelFiles}\n\n${snippets.join('\n\n')}`;

  if (shouldCleanup) cleanup(tempDir);
  return result;
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

// Builds the actual instruction sent to aider. `context` is the recent
// chat history (from the browser session) — without this, each agent run
// is a fresh clone with zero memory of anything said earlier in the chat,
// so "add the text you just gave me" has nothing to refer to. We fold the
// last few turns in so aider can resolve references like that.
function buildAiderTask(task, context) {
  if (!Array.isArray(context) || context.length === 0) return task;
  const recent = context.slice(-8); // last few turns is plenty; keeps prompt small
  const transcript = recent
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n\n');
  return [
    'Recent conversation for context (the task below may refer back to things said here, e.g. "the text you gave me"):',
    '',
    '<conversation_context>',
    transcript,
    '</conversation_context>',
    '',
    'IMPORTANT: everything inside <conversation_context> above is prior chat history, provided',
    'only so you can resolve references in the task below. It is reference material, not a list',
    'of files/folders/routes to create. In particular, if it contains things that look like file',
    'paths, URLs, or HTTP routes (e.g. lines like "DELETE /api/..." from an API summary table),',
    'those describe concepts being discussed — do NOT create files, folders, or routes matching',
    'that literal text unless the task below explicitly asks you to implement that exact route.',
    '',
    '---',
    '',
    `Now do this: ${task}`,
  ].join('\n');
}

function findGodotMainScene(cwd) {
  try {
    const text = fs.readFileSync(path.join(cwd, 'project.godot'), 'utf8');
    const match = text.match(/run\/main_scene\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

// Boots the project headless for a short window and reports any errors
// printed to stdout/stderr. This is a smoke test, not a real test suite —
// it catches GDScript parse errors, missing autoload/resource references,
// and exceptions thrown during startup, which is exactly the class of thing
// a naive text edit to a .gd or .tscn file tends to break. Runs the
// project's configured main scene if project.godot declares one, otherwise
// just boots the project (still surfaces autoload/global script errors).
async function runGodotHeadlessCheck({ cwd, timeoutMs = 30000, quitAfterFrames = 60 }) {
  const mainScene = findGodotMainScene(cwd);
  const args = ['--headless', '--path', cwd];
  if (mainScene) args.push(mainScene);
  args.push('--quit-after', String(quitAfterFrames));

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  try {
    const result = await run('godot', args, { cwd, timeout: timeoutMs });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    stdout = err.stdout || '';
    stderr = err.stderr || '';
    timedOut = Boolean(err.killed);
  }

  const combined = `${stdout}\n${stderr}`;
  const errorLines = combined
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && /error/i.test(line))
    .slice(0, 40); // cap so a runaway error spam doesn't blow up the follow-up aider prompt

  return {
    mainScene,
    ok: errorLines.length === 0 && !timedOut,
    timedOut,
    errorLines,
  };
}

async function invokeAider({ workDir, logsDir, chosenModel, taskText, aiderEnv }) {
  const aiderArgs = [
    '--yes-always',
    '--no-check-update',
    '--model', `openai/${chosenModel}`,
    '--message', taskText,
    // Keep aider's own bookkeeping files entirely out of the repo working
    // tree (previously --no-gitignore caused .aider.chat.history.md /
    // .aider.input.history to get swept into the PR commit — see
    // commitPendingChanges for the belt-and-suspenders exclusion too).
    '--chat-history-file', path.join(logsDir, 'chat-history.md'),
    '--input-history-file', path.join(logsDir, 'input-history.md'),
  ];
  try {
    const result = await run('aider', aiderArgs, { cwd: workDir, env: aiderEnv });
    return { stdout: result.stdout, stderr: result.stderr, threw: false };
  } catch (aiderErr) {
    // aider can exit non-zero even after making valid partial progress; capture output either way
    return { stdout: aiderErr.stdout || '', stderr: aiderErr.stderr || '', threw: true, error: aiderErr };
  }
}

// Core run logic shared by the buffered /agent/run and the streaming
// /agent/run/stream. `onStep(msg)` is called for every progress update —
// /agent/run just accumulates it into an array, /agent/run/stream also
// writes it to the client immediately as an SSE event.
async function runAgentTask({
  repoUrl, task, context, baseBranch = 'main', model, prTitle, prBody, token,
  skipGodotCheck = false, godotCheckRetries = 2, godotCheckTimeoutMs = 30000,
}, onStep) {
  const { owner, repo } = parseOwnerRepo(repoUrl);
  const runId = crypto.randomBytes(6).toString('hex');
  const workDir = path.join(WORKSPACES_DIR, `${repo}-${runId}`);
  // Aider's chat/input history logs live OUTSIDE the cloned repo entirely so
  // there's no chance of them getting swept into `git add -A` and ending up
  // committed to the PR.
  const logsDir = path.join(WORKSPACES_DIR, `${repo}-${runId}-logs`);
  fs.mkdirSync(logsDir, { recursive: true });
  const branchName = `aider/${runId}`;
  const chosenModel = model || DEFAULT_MODEL;
  const fullTask = buildAiderTask(task, context);

  const step = (msg) => { console.log(`[${runId}] ${msg}`); onStep(msg); };

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
    let aiderResult = await invokeAider({ workDir, logsDir, chosenModel, taskText: fullTask, aiderEnv });
    step(aiderResult.threw ? `Aider exited with error: ${aiderResult.error.message}` : 'Aider finished successfully');

    // Godot headless test-and-fix loop: if this is a Godot project, boot it
    // headless and check for errors, feeding any back to aider to fix, up to
    // godotCheckRetries times, before ever committing/opening a PR. This is
    // what "test the scene before sending it to the user" means in practice
    // for a container with no display — a smoke test, not full QA (it can't
    // see rendering, only startup/script errors).
    const isGodotProject = fs.existsSync(path.join(workDir, 'project.godot'));
    let godotCheck = null;
    if (isGodotProject && !skipGodotCheck) {
      for (let attempt = 0; attempt <= godotCheckRetries; attempt++) {
        step(attempt === 0 ? 'Godot project detected — running headless check' : `Re-running headless check (fix attempt ${attempt})`);
        godotCheck = await runGodotHeadlessCheck({ cwd: workDir, timeoutMs: godotCheckTimeoutMs });
        if (godotCheck.ok) {
          step('Headless check passed — no errors detected');
          break;
        }
        if (attempt === godotCheckRetries) {
          step(`Headless check still shows ${godotCheck.errorLines.length} error line(s) after ${godotCheckRetries} fix attempt(s) — proceeding anyway, review before merging`);
          break;
        }
        step(`Headless check found ${godotCheck.errorLines.length} error line(s) — asking aider to fix`);
        const fixTask = [
          'Running this Godot project headless produced the following errors. Fix them.',
          '',
          '<headless_errors>',
          godotCheck.errorLines.join('\n'),
          '</headless_errors>',
        ].join('\n');
        aiderResult = await invokeAider({ workDir, logsDir, chosenModel, taskText: fixTask, aiderEnv });
        step(aiderResult.threw ? `Aider exited with error: ${aiderResult.error.message}` : 'Aider finished successfully');
      }
    }

    // Best-effort: aider sometimes prints a "Tokens: X sent, Y received" style
    // summary line — surface it if present so the caller can see real usage
    // for the aider call, in addition to the approximate context size below.
    const aiderTokenMatch = `${aiderResult.stdout}\n${aiderResult.stderr}`.match(
      /tokens?:\s*([\d.,]+k?)\s*sent.*?([\d.,]+k?)\s*received/i
    );
    const aiderTokenSummary = aiderTokenMatch
      ? { sent: aiderTokenMatch[1], received: aiderTokenMatch[2] }
      : null;

    step('Committing changes');
    await commitPendingChanges({ cwd: workDir, task, step });

    // Check whether aider actually produced any commits on top of base
    const { stdout: diffStat } = await run('git', ['diff', '--stat', `origin/${baseBranch}`, 'HEAD'], { cwd: workDir });
    if (!diffStat.trim()) {
      step('No changes were made by aider — skipping push/PR');
      cleanup(workDir);
      cleanup(logsDir);
      return {
        ok: true,
        changed: false,
        message: 'Aider made no changes for this task',
        aiderOutput: aiderResult.stdout,
        tokens: { approxContextTokens: estimateTokens(fullTask), aiderTokenSummary },
        godotCheck,
      };
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
    REPO_CONTEXT_CACHE.delete(`${repoUrl}@${baseBranch || 'main'}`);
    cleanup(workDir);
    cleanup(logsDir);

    return {
      ok: true,
      changed: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch: branchName,
      aiderOutput: aiderResult.stdout,
      tokens: { approxContextTokens: estimateTokens(fullTask), aiderTokenSummary },
    };
  } catch (err) {
    step(`Failed: ${err.message}`);
    cleanup(workDir);
    cleanup(logsDir);
    err.isAgentRunError = true;
    throw err;
  }
}

async function handleAuthErrorForRequest(req, err, step) {
  const authError = isGithubAuthError(err);
  if (authError) {
    if (step) step('Detected GitHub auth failure — token is likely invalid or revoked');
    if (req.authSource === 'session') {
      const sid = parseCookies(req).sid;
      if (sid) await removeSession(sid);
    }
  }
  return authError;
}

function validateAgentRunRequest(req, res) {
  const { repoUrl, task } = req.body;
  if (!repoUrl) { res.status(400).json({ error: 'repoUrl is required' }); return null; }
  if (!task) { res.status(400).json({ error: 'task is required (instructions for aider)' }); return null; }
  const token = req.githubToken;
  if (!token) {
    res.status(400).json({
      error: req.authSource === 'session'
        ? 'No GitHub token on your session — reconnect GitHub'
        : 'No GitHub token provided (body.githubToken or GITHUB_TOKEN env var)'
    });
    return null;
  }
  if (!NIM_API_KEY) { res.status(500).json({ error: 'NIM_API_KEY is not configured on the server' }); return null; }
  try {
    parseOwnerRepo(repoUrl);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return null;
  }
  return token;
}

// Buffered variant — unchanged response shape, still used by server-to-server
// callers (see README "Calling it directly").
app.post('/agent/run', resolveAgentAuth, async (req, res) => {
  const token = validateAgentRunRequest(req, res);
  if (!token) return;
  const { repoUrl, task, context, baseBranch = 'main', model, prTitle, prBody } = req.body;

  const log = [];
  try {
    const result = await runAgentTask(
      { repoUrl, task, context, baseBranch, model, prTitle, prBody, token },
      (msg) => log.push(msg)
    );
    if (db.enabled) {
      const sid = parseCookies(req).sid;
      await db.saveAgentRun(sid, { repoUrl, task, status: result.changed ? 'pr_opened' : 'no_changes', prUrl: result.prUrl, log });
    }
    return res.json({ ...result, log });
  } catch (err) {
    const authError = await handleAuthErrorForRequest(req, err, (msg) => log.push(msg));
    if (db.enabled) {
      const sid = parseCookies(req).sid;
      await db.saveAgentRun(sid, { repoUrl, task, status: 'failed', log });
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

// Streaming variant — used by the built-in UI so the activity panel shows
// real progress instead of a canned animation. Emits newline-delimited JSON
// events: {type:"step", message} for each stage, then one final
// {type:"done", ...result} or {type:"error", ...}.
app.post('/agent/run/stream', resolveAgentAuth, async (req, res) => {
  const token = validateAgentRunRequest(req, res);
  if (!token) return;
  const { repoUrl, task, context, baseBranch = 'main', model, prTitle, prBody } = req.body;

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event) => res.write(JSON.stringify(event) + '\n');

  const log = [];
  try {
    const result = await runAgentTask(
      { repoUrl, task, context, baseBranch, model, prTitle, prBody, token },
      (msg) => { log.push(msg); send({ type: 'step', message: msg }); }
    );
    if (db.enabled) {
      const sid = parseCookies(req).sid;
      await db.saveAgentRun(sid, { repoUrl, task, status: result.changed ? 'pr_opened' : 'no_changes', prUrl: result.prUrl, log });
    }
    send({ type: 'done', ...result, log });
  } catch (err) {
    const authError = await handleAuthErrorForRequest(req, err, (msg) => { log.push(msg); send({ type: 'step', message: msg }); });
    if (db.enabled) {
      const sid = parseCookies(req).sid;
      await db.saveAgentRun(sid, { repoUrl, task, status: 'failed', log });
    }
    send({
      type: 'error',
      error: err.message,
      authError,
      reconnectRequired: authError && req.authSource === 'session',
      stderr: err.stderr || null,
      log
    });
  } finally {
    res.end();
  }
});

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

app.get('/health', (req, res) => res.json({
  ok: true,
  githubConfigured: true,
  appBaseUrl: APP_BASE_URL || null,
  railwayPublicDomain: RAILWAY_PUBLIC_DOMAIN || null,
}));

// ---- GitHub OAuth (connect account) ----

app.get('/auth/github', (req, res) => {
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
    await createSession(sid, {
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

app.post('/auth/logout', async (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) await removeSession(sid);
  clearCookie(res, 'sid');
  res.json({ ok: true });
});

app.get('/api/session', async (req, res) => {
  const session = await getSession(req);
  if (!session) return res.json({ loggedIn: false, githubConfigured: true, persistence: db.enabled });
  res.json({ loggedIn: true, githubLogin: session.githubLogin, persistence: db.enabled });
});

// ---- repo picker ----

app.get('/api/repos', async (req, res) => {
  const session = await getSession(req);
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

app.get('/api/branches', async (req, res) => {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Not connected to GitHub yet' });
  const repoFullName = req.query.repo;
  if (!repoFullName || !repoFullName.includes('/')) {
    return res.status(400).json({ error: 'repo query param is required, e.g. ?repo=owner/name' });
  }
  try {
    const branches = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`https://api.github.com/repos/${repoFullName}/branches?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${session.githubToken}`, 'User-Agent': 'coding-agent' },
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: errBody.message || 'Failed to list branches from GitHub' });
      }
      const batch = await r.json();
      branches.push(...batch);
      if (batch.length < 100) break;
    }
    res.json({ branches: branches.map((b) => b.name) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/models', (req, res) => {
  res.json({ models: ALLOWED_MODELS, default: DEFAULT_MODEL });
});

app.post('/api/chat', resolveApiAuth, async (req, res) => {
  const { messages = [], model, repoUrl, baseBranch } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (!NIM_API_KEY) {
    return res.status(500).json({ error: 'NIM_API_KEY is not configured on the server' });
  }

  const selectedModel = isAllowedModel(model) ? model : DEFAULT_MODEL;
  const shouldInspectRepo = Boolean(repoUrl);

  try {
    let promptMessages = messages;
    if (shouldInspectRepo) {
      const repoContext = await getCachedRepositoryContext({
        repoUrl,
        baseBranch,
        token: req.githubToken || DEFAULT_GITHUB_TOKEN,
      });
      promptMessages = [
        {
          role: 'system',
          content: `You are a helpful coding assistant. Answer clearly in markdown. If asked for code, provide concise code blocks. If asked about a repository, explain what it does and mention likely entry points.\n\nRepository context:\n${repoContext}`,
        },
        ...messages,
      ];
    }

    const response = await fetch(`${NIM_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: promptMessages,
        temperature: 0.2,
        max_tokens: 1800,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || `NVIDIA API request failed (${response.status})`);
    }

    const content = data.choices?.[0]?.message?.content || '';

    // Exact usage from NIM when available (this is the real number that
    // matters for "am I approaching the model's context window" — since the
    // full `messages` array is re-sent every turn, prompt_tokens IS the
    // current conversation size as seen by the model). Fall back to a rough
    // char-based estimate if the API didn't return usage for some reason.
    const usage = data.usage || {
      prompt_tokens: estimateTokens(promptMessages.map((m) => m.content).join('\n')),
      completion_tokens: estimateTokens(content),
      total_tokens: null,
      estimated: true,
    };
    if (usage.total_tokens == null && usage.prompt_tokens != null && usage.completion_tokens != null) {
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    }

    return res.json({
      message: content,
      model: selectedModel,
      usage,
      contextWindow: NIM_CONTEXT_WINDOW,
      contextUsedFraction: usage.total_tokens != null ? usage.total_tokens / NIM_CONTEXT_WINDOW : null,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to reach NVIDIA NIM' });
  }
});

// ---- console (python / bash / npm / node) ----
//
// MVP execution console so external callers (and the UI, once you build a
// panel for it) can run commands. Each consoleId gets its own ephemeral
// directory under workspaces/ that persists across calls until explicitly
// deleted or reaped by the idle-cleanup sweep below.
//
// Security notes (read before exposing this publicly):
// - Commands are restricted to a fixed allowlist of interpreters (no shell
//   string is ever executed — execFile with an argv array, so there's no
//   shell-injection surface via `args`).
// - There is NO further sandboxing (no container/user/network isolation
//   beyond whatever the host process already has — e.g. this Railway/Docker
//   container). Anyone with a valid x-api-key or session can run arbitrary
//   python/bash/node/npm inside that container. Treat AGENT_API_KEY as
//   sensitive, rotate it if this is exposed to more than trusted callers,
//   and consider this a first version — proper multi-tenant use would need
//   real sandboxing (per-run containers, resource limits, network policy).
const CONSOLE_ALLOWED_COMMANDS = new Set(['python3', 'python', 'pip', 'pip3', 'node', 'npm', 'bash', 'sh', 'godot']);
const CONSOLE_IDLE_MS = 2 * 60 * 60 * 1000; // reap workspaces idle > 2h
const consoleWorkspaces = new Map(); // consoleId -> { dir, lastUsed }

function getOrCreateConsoleDir(consoleId) {
  if (consoleId && consoleWorkspaces.has(consoleId)) {
    const entry = consoleWorkspaces.get(consoleId);
    entry.lastUsed = Date.now();
    return { id: consoleId, dir: entry.dir };
  }
  const id = consoleId || crypto.randomBytes(8).toString('hex');
  const dir = path.join(WORKSPACES_DIR, `console-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  consoleWorkspaces.set(id, { dir, lastUsed: Date.now() });
  return { id, dir };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of consoleWorkspaces.entries()) {
    if (now - entry.lastUsed > CONSOLE_IDLE_MS) {
      cleanup(entry.dir);
      consoleWorkspaces.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

// Streams NDJSON events: {type:"start"}, {type:"stdout"|"stderr", data},
// {type:"exit", code}, or {type:"error", error}. Reuse the same consoleId
// across calls to keep files/state (e.g. a venv, node_modules) between runs.
app.post('/api/console/run', resolveApiAuth, (req, res) => {
  const { command, args = [], consoleId } = req.body || {};
  if (!CONSOLE_ALLOWED_COMMANDS.has(command)) {
    return res.status(400).json({ error: `command must be one of: ${[...CONSOLE_ALLOWED_COMMANDS].join(', ')}` });
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    return res.status(400).json({ error: 'args must be an array of strings' });
  }

  const { id, dir } = getOrCreateConsoleDir(consoleId);

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event) => res.write(JSON.stringify(event) + '\n');
  send({ type: 'start', consoleId: id, command, args });

  const child = execFile(command, args, {
    cwd: dir,
    timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 20,
    env: process.env,
  });

  child.stdout.on('data', (chunk) => send({ type: 'stdout', data: chunk.toString() }));
  child.stderr.on('data', (chunk) => send({ type: 'stderr', data: chunk.toString() }));
  child.on('error', (err) => { send({ type: 'error', error: err.message }); res.end(); });
  child.on('close', (code) => { send({ type: 'exit', code, consoleId: id }); res.end(); });
});

app.delete('/api/console/:id', resolveApiAuth, (req, res) => {
  const entry = consoleWorkspaces.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Unknown consoleId' });
  cleanup(entry.dir);
  consoleWorkspaces.delete(req.params.id);
  res.json({ ok: true });
});

// ---- Godot headless dedicated server ----
//
// Separate from /api/console/run: a Godot dedicated server is a long-running
// process that needs to stay up independent of any single HTTP request/
// stream, and typically needs to bind to a fixed port so it can be exposed
// (e.g. via Railway's TCP Proxy — see README). This is a minimal process
// manager: one Godot server at a time, controlled via start/stop/status,
// with its output kept in a ring buffer you can poll via /logs.
let godotServer = null; // { proc, startedAt, projectPath, args, logs: [] }
const GODOT_LOG_LINES = 500;

function pushGodotLog(stream, chunk) {
  if (!godotServer) return;
  const lines = chunk.toString().split('\n').filter(Boolean);
  for (const line of lines) {
    godotServer.logs.push({ stream, line, at: Date.now() });
  }
  if (godotServer.logs.length > GODOT_LOG_LINES) {
    godotServer.logs.splice(0, godotServer.logs.length - GODOT_LOG_LINES);
  }
}

app.post('/api/godot/start', resolveApiAuth, (req, res) => {
  if (godotServer && godotServer.proc.exitCode == null) {
    return res.status(409).json({ error: 'A Godot server is already running', pid: godotServer.proc.pid });
  }
  const { projectPath, binaryPath, mainPack, args = [] } = req.body || {};
  if (!projectPath && !binaryPath) {
    return res.status(400).json({
      error: 'Provide either projectPath (a directory containing project.godot, run via the system godot engine) '
        + 'or binaryPath (a prebuilt exported server executable, run directly — e.g. from a repo that ships its '
        + 'own godot_server binary + .pck instead of source).',
    });
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    return res.status(400).json({ error: 'args must be an array of strings' });
  }

  // Two mutually exclusive launch modes:
  let executable;
  let fullArgs;
  if (binaryPath) {
    // Prebuilt export: run the shipped executable directly. Not the system
    // `godot` engine at all — this binary already has the game baked in
    // (Godot's export process produces a standalone executable per-platform).
    executable = binaryPath;
    fullArgs = ['--headless', ...(mainPack ? ['--main-pack', mainPack] : []), ...args];
    // Make sure it's actually executable (repos cloned via git often need this,
    // and it's a common source of "exec format error"/"permission denied").
    try { fs.chmodSync(binaryPath, 0o755); } catch (_) {}
  } else {
    // Source project: use the system-installed godot engine against
    // project.godot, same as before.
    executable = 'godot';
    fullArgs = ['--headless', '--path', projectPath, ...args];
  }

  let proc;
  try {
    proc = spawn(executable, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return res.status(500).json({ error: `Failed to launch ${executable}: ${err.message}` });
  }

  godotServer = { proc, startedAt: Date.now(), projectPath: projectPath || null, binaryPath: binaryPath || null, args: fullArgs, logs: [] };
  proc.stdout.on('data', (chunk) => pushGodotLog('stdout', chunk));
  proc.stderr.on('data', (chunk) => pushGodotLog('stderr', chunk));
  proc.on('exit', (code, signal) => {
    if (godotServer && godotServer.proc === proc) {
      pushGodotLog('system', `process exited (code=${code}, signal=${signal})`);
    }
  });

  res.json({ started: true, pid: proc.pid, projectPath: projectPath || null, binaryPath: binaryPath || null, args: fullArgs });
});

app.post('/api/godot/stop', resolveApiAuth, (req, res) => {
  if (!godotServer || godotServer.proc.exitCode != null) {
    return res.status(404).json({ error: 'No Godot server is running' });
  }
  godotServer.proc.kill('SIGTERM');
  res.json({ stopping: true, pid: godotServer.proc.pid });
});

app.get('/api/godot/status', resolveApiAuth, (req, res) => {
  if (!godotServer) return res.json({ running: false });
  const running = godotServer.proc.exitCode == null;
  res.json({
    running,
    pid: godotServer.proc.pid,
    projectPath: godotServer.projectPath,
    binaryPath: godotServer.binaryPath,
    args: godotServer.args,
    uptimeMs: running ? Date.now() - godotServer.startedAt : null,
    exitCode: godotServer.proc.exitCode,
  });
});

app.get('/api/godot/logs', resolveApiAuth, (req, res) => {
  if (!godotServer) return res.json({ logs: [] });
  res.json({ logs: godotServer.logs });
});

// ---- static UI ----
// Serves public/index.html at '/' (fixes "Cannot GET /") and the agent
// dashboard. Must come after the API routes above so nothing shadows them.
app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Coding agent server listening on port ${PORT}`);
    console.log(`Default model: ${DEFAULT_MODEL}`);
    console.log(`NIM base: ${NIM_API_BASE}`);
  });
}

module.exports = {
  app,
  collectRepositoryContext,
  commitPendingChanges,
};
