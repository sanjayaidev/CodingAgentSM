// lib/git.js
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

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
    await execFileAsync('git', ['clone', '--depth', '1', authedUrl, dest]);
  } else {
    // Refresh the remote URL (token may have changed) then pull latest.
    await execFileAsync('git', ['remote', 'set-url', 'origin', authedUrl], { cwd: dest });
    await execFileAsync('git', ['fetch', 'origin', defaultBranch || 'HEAD'], { cwd: dest });
    await execFileAsync('git', ['reset', '--hard', `origin/${defaultBranch || 'HEAD'}`], { cwd: dest });
  }

  // Strip the token back out of the stored remote so it's not sitting on disk.
  await execFileAsync('git', ['remote', 'set-url', 'origin', cloneUrl], { cwd: dest });

  // aider needs a git identity to make commits.
  await execFileAsync('git', ['config', 'user.name', authorName || 'Coding Agent'], { cwd: dest });
  await execFileAsync('git', ['config', 'user.email', authorEmail || 'coding-agent@users.noreply.github.com'], { cwd: dest });

  return dest;
}
