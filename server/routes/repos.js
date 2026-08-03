// routes/repos.js
import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { listGithubRepos } from '../lib/github.js';
import { cloneOrUpdateRepo } from '../lib/git.js';

const execFileAsync = promisify(execFile);
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

// Execute a shell command in the context of a repo
router.post('/exec', requireAuth, async (req, res) => {
  const { repoPath, command } = req.body;

  if (!repoPath || !command) {
    return res.status(400).json({ error: 'repoPath and command are required' });
  }

  // Basic security: prevent some dangerous commands
  const dangerousPatterns = ['rm -rf /', 'sudo', 'mkfs', 'dd if=', '> /dev/', '| tee /'];
  for (const pattern of dangerousPatterns) {
    if (command.includes(pattern)) {
      return res.status(403).json({ error: 'Command contains dangerous patterns' });
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, {
      cwd: repoPath,
      shell: true,
      maxBuffer: 5 * 1024 * 1024,
      timeout: 30 * 1000,
    });

    res.json({
      output: stdout || stderr || '',
      success: true,
    });
  } catch (error) {
    res.json({
      output: error.stdout || '',
      error: error.stderr || error.message,
      success: false,
    });
  }
});

export default router;
