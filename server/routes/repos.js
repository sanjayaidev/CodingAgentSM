// routes/repos.js
import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { listGithubRepos, createPullRequest } from '../lib/github.js';
import { cloneOrUpdateRepo, commitAll, pushBranch, getDiff, setupSshRemote, ensureBranch, getCurrentBranch } from '../lib/git.js';

const execFileAsync = promisify(execFile);
const GIT_PATH = '/usr/bin/git';
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

    // Task 1: Set up SSH remote for authenticated pushes
    const sshUrl = cloneUrl.replace('https://github.com/', 'git@github.com:');
    await setupSshRemote(localPath, sshUrl);

    // Task 1: Ensure we're on the main branch (or specified default branch)
    const branchName = defaultBranch || 'main';
    await ensureBranch(localPath, branchName);

    res.json({ success: true, path: localPath, branch: branchName });
  } catch (error) {
    console.error('[Repos] Clone failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Setup SSH remote for a loaded repo
router.post('/setup-ssh', requireAuth, async (req, res) => {
  const { repoPath, sshUrl } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: 'repoPath is required' });
  }

  try {
    const result = await setupSshRemote(repoPath, sshUrl);
    res.json(result);
  } catch (error) {
    console.error('[Repos] Setup SSH failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get current branch info
router.get('/branch', requireAuth, async (req, res) => {
  const { repoPath } = req.query;

  if (!repoPath) {
    return res.status(400).json({ error: 'repoPath is required' });
  }

  try {
    const branch = await getCurrentBranch(repoPath);
    res.json({ success: true, branch });
  } catch (error) {
    console.error('[Repos] Get branch failed:', error);
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
      env: { ...process.env, GIT_EXEC_PATH: '/usr/lib/git-core' },
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

// Commit changes and push to a branch, optionally creating a PR
router.post('/push', requireAuth, async (req, res) => {
  const { repoPath, commitMessage, branchName, createPR, prTitle, prBody, baseBranch } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: 'repoPath is required' });
  }
  if (!commitMessage) {
    return res.status(400).json({ error: 'commitMessage is required' });
  }
  if (!branchName) {
    return res.status(400).json({ error: 'branchName is required' });
  }

  try {
    // Step 1: Commit all changes
    const commitResult = await commitAll(repoPath, commitMessage);
    
    // Step 2: Push the branch
    await pushBranch(repoPath, branchName);

    let prInfo = null;
    
    // Step 3: Optionally create a pull request
    if (createPR) {
      if (!prTitle) {
        return res.status(400).json({ error: 'prTitle is required when createPR is true' });
      }
      if (!baseBranch) {
        return res.status(400).json({ error: 'baseBranch is required when createPR is true' });
      }

      // Get repo full name from path
      const pathParts = repoPath.split('/');
      const owner = pathParts[pathParts.length - 2];
      const repo = pathParts[pathParts.length - 1];
      const fullName = `${owner}/${repo}`;

      const prResult = await createPullRequest(req.session.githubToken, {
        fullName,
        title: prTitle,
        body: prBody || `Changes from branch: ${branchName}`,
        head: branchName,
        base: baseBranch,
      });

      prInfo = prResult;
    }

    res.json({
      success: true,
      commitSha: commitResult.sha,
      branchName,
      pr: prInfo,
    });
  } catch (error) {
    console.error('[Repos] Push failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Preview changes before committing (shows diff)
router.post('/preview', requireAuth, async (req, res) => {
  const { repoPath } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: 'repoPath is required' });
  }

  try {
    const diff = await getDiff(repoPath);
    res.json({
      success: true,
      diff: diff.diff,
      changedFiles: diff.files,
    });
  } catch (error) {
    console.error('[Repos] Preview failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;