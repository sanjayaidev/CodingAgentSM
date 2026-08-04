// lib/git.js
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

// Use absolute path to git to avoid ENOENT errors when PATH is not set correctly
const GIT_PATH = process.env.GIT_PATH || '/usr/bin/git';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');

function safeSegment(str) {
  // Prevent path traversal via crafted repo/owner names.
  return String(str).replace(/[^a-zA-Z0-9._-]/g, '_');
}

// aider is invoked with --no-gitignore (see lib/aider.js) so it never
// edits the user's .gitignore, but that also means it won't self-register
// its own scratch files there. Left alone, its repo-map cache
// (.aider.tags.cache.v3/) and any history files that land in the repo
// root get swept up by `git add -A` and pushed to the user's repo as
// junk. Keep them out at the git level instead, independent of the tree.
const AIDER_ARTIFACT_GLOB = '.aider*';

/**
 * Make sure aider's own working files are excluded locally (never shown
 * as untracked/added, and never written into the user's committed
 * .gitignore) and untrack any that a previous version of this tool may
 * already have committed.
 */
async function excludeAiderArtifacts(repoPath) {
  const excludePath = path.join(repoPath, '.git', 'info', 'exclude');
  try {
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf-8') : '';
    if (!existing.split('\n').includes(AIDER_ARTIFACT_GLOB)) {
      fs.appendFileSync(excludePath, `${existing.endsWith('\n') || !existing ? '' : '\n'}${AIDER_ARTIFACT_GLOB}\n`);
    }
  } catch {
    // Non-fatal — worst case aider artifacts show up as untracked files
    // for a human to notice before pushing.
  }

  // Untrack any aider artifacts a previous run already committed, and
  // delete them from the working tree so they don't linger locally.
  try {
    await execFileAsync(
      GIT_PATH,
      ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', AIDER_ARTIFACT_GLOB],
      { cwd: repoPath }
    );
  } catch {
    // Nothing tracked matched — fine.
  }
  for (const entry of fs.readdirSync(repoPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.aider')) {
      fs.rmSync(path.join(repoPath, entry.name), { recursive: true, force: true });
    }
  }
}

/**
 * Configure this repo to authenticate to github.com over HTTPS for every
 * git command run against it — not just ones this app issues itself, but
 * also anything typed directly into the exec terminal (`git push`,
 * `git pull`, ...). Without this, origin has no credentials at all: no
 * SSH key is ever configured anywhere in this app, and a plain HTTPS
 * remote with nothing supplying a username/password just fails outright
 * with no TTY to prompt on ("could not read Username ... No such device
 * or address").
 *
 * This is the same technique GitHub Actions' checkout action uses: an
 * `Authorization: Basic ...` header attached in local git config,
 * scoped to https://github.com/ only, so it's sent on every request but
 * never touches the remote URL itself (which would otherwise leak the
 * token into `git remote -v`, reflog, and every child-process argv).
 */
async function configureGithubAuth(repoPath, token) {
  if (!token) return;
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  await execFileAsync(
    GIT_PATH,
    ['config', '--local', 'http.https://github.com/.extraheader', header],
    { cwd: repoPath }
  );
}

/**
 * Returns the local filesystem path a repo would live at for a given user,
 * without touching disk.
 */
export function localPathFor(githubLogin, ownerRepo) {
  const [owner, repo] = ownerRepo.split('/');
  return path.join(WORKSPACE_DIR, safeSegment(githubLogin), safeSegment(owner), safeSegment(repo));
}

/**
 * Clone a repo on first use, or fetch+reset to latest on subsequent uses.
 * Leaves the repo configured with a standing auth header (see
 * configureGithubAuth) so any git command against it — ours or one typed
 * into a terminal — authenticates automatically, without ever putting the
 * token in the remote URL itself.
 */
export async function cloneOrUpdateRepo({ token, githubLogin, fullName, cloneUrl, defaultBranch, authorName, authorEmail }) {
  const dest = localPathFor(githubLogin, fullName);

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (!fs.existsSync(path.join(dest, '.git'))) {
    await execFileAsync(GIT_PATH, ['clone', '--depth', '1', cloneUrl, dest]);
    await configureGithubAuth(dest, token);
  } else {
    // Token may have rotated since the last time this repo was loaded —
    // refresh the header before touching the network.
    await configureGithubAuth(dest, token);
    await execFileAsync(GIT_PATH, ['fetch', 'origin', defaultBranch || 'HEAD'], { cwd: dest });
    await execFileAsync(GIT_PATH, ['reset', '--hard', `origin/${defaultBranch || 'HEAD'}`], { cwd: dest });
  }

  // aider needs a git identity to make commits.
  await execFileAsync(GIT_PATH, ['config', 'user.name', authorName || 'Coding Agent'], { cwd: dest });
  await execFileAsync(GIT_PATH, ['config', 'user.email', authorEmail || 'coding-agent@users.noreply.github.com'], { cwd: dest });

  // Keep aider's own scratch/cache files from ever being tracked, and
  // sweep out any that a previous run already committed.
  await excludeAiderArtifacts(dest);

  return dest;
}

/**
 * Set up the repository with SSH remote URL for authenticated pushes.
 * Converts HTTPS clone URL to SSH format and sets as origin.
 */
export async function setupSshRemote(repoPath, sshUrl) {
  if (!sshUrl) {
    throw new Error('SSH URL is required');
  }
  await execFileAsync(GIT_PATH, ['remote', 'set-url', 'origin', sshUrl], { cwd: repoPath });
  return { success: true, message: 'Remote origin updated to SSH' };
}

/**
 * Ensure the specified branch exists and is checked out.
 * Creates the branch from the current HEAD if it doesn't exist.
 */
export async function ensureBranch(repoPath, branchName) {
  try {
    // Try to checkout the branch
    await execFileAsync(GIT_PATH, ['checkout', branchName], { cwd: repoPath });
    return { success: true, branch: branchName, created: false };
  } catch (error) {
    // Branch doesn't exist, create it
    await execFileAsync(GIT_PATH, ['checkout', '-b', branchName], { cwd: repoPath });
    return { success: true, branch: branchName, created: true };
  }
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(repoPath) {
  const { stdout } = await execFileAsync(GIT_PATH, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath });
  return stdout.trim();
}

/**
 * Uncommitted changes (working tree + staged) as a unified diff, plus a
 * short per-file status list for the UI.
 */
export async function getDiff(repoPath) {
  const [{ stdout: diff }, { stdout: statusRaw }] = await Promise.all([
    execFileAsync(GIT_PATH, ['diff', 'HEAD'], { cwd: repoPath, maxBuffer: 20 * 1024 * 1024 }),
    execFileAsync(GIT_PATH, ['status', '--porcelain'], { cwd: repoPath }),
  ]);

  const files = statusRaw.split('\n').filter(Boolean).map(line => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3),
  }));

  return { diff, files };
}

/**
 * Commit whatever is currently sitting in the working tree (i.e. what
 * aider just wrote) as a single commit — the "apply" step after a human
 * reviews the diff.
 */
export async function commitAll(repoPath, message) {
  // Belt-and-suspenders: aider may have just written a fresh
  // .aider.tags.cache.v3/ into the working tree, so strip it again right
  // before staging rather than relying solely on the exclude file.
  await excludeAiderArtifacts(repoPath);
  await execFileAsync(GIT_PATH, ['add', '-A'], { cwd: repoPath });
  const { stdout } = await execFileAsync(GIT_PATH, ['commit', '-m', message || 'Apply aider changes'], { cwd: repoPath });
  const { stdout: sha } = await execFileAsync(GIT_PATH, ['rev-parse', 'HEAD'], { cwd: repoPath });
  return { output: stdout, sha: sha.trim() };
}

/**
 * Throw away uncommitted changes — the "discard" step if a human rejects
 * what aider produced.
 */
export async function discardChanges(repoPath) {
  await execFileAsync(GIT_PATH, ['reset', '--hard', 'HEAD'], { cwd: repoPath });
  await execFileAsync(GIT_PATH, ['clean', '-fd'], { cwd: repoPath });
}

/**
 * Push the current branch (creating it if needed) so a PR can be opened
 * against it on GitHub. Refreshes the auth header first in case the
 * token has rotated since the repo was last loaded — actual auth for the
 * push itself comes from that header (see configureGithubAuth), not from
 * anything embedded in the push command.
 */
export async function pushBranch(repoPath, branchName, token) {
  await configureGithubAuth(repoPath, token);
  await execFileAsync(GIT_PATH, ['checkout', '-B', branchName], { cwd: repoPath });
  await execFileAsync(GIT_PATH, ['push', '-u', 'origin', branchName, '--force-with-lease'], { cwd: repoPath });
}