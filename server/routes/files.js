// routes/files.js
import express from 'express';
import fs from 'fs';
import { buildTree, readFile, writeFile, deleteItem, renameItem, moveItem, copyItem, createFile, createDirectory } from '../lib/fileTree.js';

const router = express.Router();

function checkRepoPath(req, res) {
  const repoPath = req.query.repoPath || req.body?.repoPath;
  if (!repoPath) {
    res.status(400).json({ error: 'repoPath is required' });
    return null;
  }
  if (!fs.existsSync(repoPath)) {
    res.status(404).json({ error: 'repoPath does not exist. Load the repo first.' });
    return null;
  }
  return repoPath;
}

// GET /api/files/tree?repoPath=...
router.get('/tree', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  try {
    res.json({ tree: buildTree(repoPath) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/files/content?repoPath=...&path=relative/file.js
router.get('/content', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: 'path is required' });
  try {
    const content = readFile(repoPath, relPath);
    res.json({ path: relPath, content });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/files/content  { repoPath, path, content }
router.put('/content', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  const { path: relPath, content } = req.body;
  if (!relPath || content === undefined) {
    return res.status(400).json({ error: 'path and content are required' });
  }
  try {
    writeFile(repoPath, relPath, content);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Task 2: File operations - Delete
router.delete('/item', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  const { path: relPath } = req.body;
  if (!relPath) {
    return res.status(400).json({ error: 'path is required' });
  }
  try {
    deleteItem(repoPath, relPath);
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Task 2: File operations - Rename
router.post('/rename', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) {
    return res.status(400).json({ error: 'oldPath and newPath are required' });
  }
  try {
    renameItem(repoPath, oldPath, newPath);
    res.json({ success: true, message: 'Item renamed successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Task 2: File operations - Move
router.post('/move', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  const { sourcePath, destPath } = req.body;
  if (!sourcePath || !destPath) {
    return res.status(400).json({ error: 'sourcePath and destPath are required' });
  }
  try {
    moveItem(repoPath, sourcePath, destPath);
    res.json({ success: true, message: 'Item moved successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Task 2: File operations - Copy
router.post('/copy', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  const { sourcePath, destPath } = req.body;
  if (!sourcePath || !destPath) {
    return res.status(400).json({ error: 'sourcePath and destPath are required' });
  }
  try {
    copyItem(repoPath, sourcePath, destPath);
    res.json({ success: true, message: 'Item copied successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Task 2: File operations - Create file
router.post('/create-file', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  const { path: relPath, content } = req.body;
  if (!relPath) {
    return res.status(400).json({ error: 'path is required' });
  }
  try {
    createFile(repoPath, relPath, content || '');
    res.json({ success: true, message: 'File created successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Task 2: File operations - Create directory
router.post('/create-directory', (req, res) => {
  const repoPath = checkRepoPath(req, res);
  if (!repoPath) return;
  const { path: relPath } = req.body;
  if (!relPath) {
    return res.status(400).json({ error: 'path is required' });
  }
  try {
    createDirectory(repoPath, relPath);
    res.json({ success: true, message: 'Directory created successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;