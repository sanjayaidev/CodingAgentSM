// lib/git.js
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const GIT_PATH = 'git';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');

function safeSegment(str) {
  // Prevent path traversal via crafted repo/owner names.
  return String(str).replace(/[^a-zA-Z0-9._-]/g, '_');
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
 * Embeds the user's OAuth token in the clone URL so private repos work,
 * then immediately rewrites the git remote to strip the token back out
 * (so it never sits in plaintext inside .git/config on disk).
 */
export async function cloneOrUpdateRepo({ token, githubLogin, fullName, cloneUrl, defaultBranch, authorName, authorEmail }) {
  const dest = localPathFor(githubLogin, fullName);
  const authedUrl = cloneUrl.replace('https://', `https://x-access-token:${token}@`);

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (!fs.existsSync(path.join(dest, '.git'))) {
    await execFileAsync(GIT_PATH, ['clone', '--depth', '1', authedUrl, dest]);
  } else {
    // Refresh the remote URL (token may have changed) then pull latest.
    await execFileAsync(GIT_PATH, ['remote', 'set-url', 'origin', authedUrl], { cwd: dest });
    await execFileAsync(GIT_PATH, ['fetch', 'origin', defaultBranch || 'HEAD'], { cwd: dest });
    await execFileAsync(GIT_PATH, ['reset', '--hard', `origin/${defaultBranch || 'HEAD'}`], { cwd: dest });
  }

  // Strip the token back out of the stored remote so it's not sitting on disk.
  await execFileAsync(GIT_PATH, ['remote', 'set-url', 'origin', cloneUrl], { cwd: dest });

  // aider needs a git identity to make commits.
  await execFileAsync(GIT_PATH, ['config', 'user.name', authorName || 'Coding Agent'], { cwd: dest });
  await execFileAsync(GIT_PATH, ['config', 'user.email', authorEmail || 'coding-agent@users.noreply.github.com'], { cwd: dest });

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
 * against it on GitHub.
 */
export async function pushBranch(repoPath, branchName) {
  await execFileAsync(GIT_PATH, ['checkout', '-B', branchName], { cwd: repoPath });
  await execFileAsync(GIT_PATH, ['push', '-u', 'origin', branchName, '--force-with-lease'], { cwd: repoPath });
}