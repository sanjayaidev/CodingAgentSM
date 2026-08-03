// lib/fileTree.js
import fs from 'fs';
import path from 'path';

const IGNORE_PATTERNS = [
  '.git',
  'node_modules',
  '__pycache__',
  '.env',
  '.DS_Store',
  '*.pyc',
];

function shouldIgnore(name) {
  return IGNORE_PATTERNS.some(pattern => {
    if (pattern.startsWith('*')) {
      return name.endsWith(pattern.slice(1));
    }
    return name === pattern;
  });
}

export function buildTree(dir, basePath = '') {
  const items = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      items.push({
        type: 'directory',
        name: entry.name,
        path: relPath,
        children: buildTree(fullPath, relPath),
      });
    } else {
      items.push({
        type: 'file',
        name: entry.name,
        path: relPath,
        size: fs.statSync(fullPath).size,
      });
    }
  }

  // Sort directories first, then files, alphabetically
  items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return items;
}

export function readFile(repoPath, relPath) {
  const fullPath = path.join(repoPath, relPath);
  if (!fullPath.startsWith(path.resolve(repoPath))) {
    throw new Error('Invalid path');
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

export function writeFile(repoPath, relPath, content) {
  const fullPath = path.join(repoPath, relPath);
  if (!fullPath.startsWith(path.resolve(repoPath))) {
    throw new Error('Invalid path');
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

/**
 * Delete a file or directory
 */
export function deleteItem(repoPath, relPath) {
  const fullPath = path.join(repoPath, relPath);
  if (!fullPath.startsWith(path.resolve(repoPath))) {
    throw new Error('Invalid path');
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error('Item does not exist');
  }
  fs.rmSync(fullPath, { recursive: true, force: true });
}

/**
 * Rename a file or directory
 */
export function renameItem(repoPath, oldRelPath, newRelPath) {
  const oldFullPath = path.join(repoPath, oldRelPath);
  const newFullPath = path.join(repoPath, newRelPath);
  
  if (!oldFullPath.startsWith(path.resolve(repoPath)) || !newFullPath.startsWith(path.resolve(repoPath))) {
    throw new Error('Invalid path');
  }
  if (!fs.existsSync(oldFullPath)) {
    throw new Error('Source item does not exist');
  }
  fs.renameSync(oldFullPath, newFullPath);
}

/**
 * Move a file or directory to a new location
 */
export function moveItem(repoPath, sourceRelPath, destRelPath) {
  const sourceFullPath = path.join(repoPath, sourceRelPath);
  const destFullPath = path.join(repoPath, destRelPath);
  
  if (!sourceFullPath.startsWith(path.resolve(repoPath)) || !destFullPath.startsWith(path.resolve(repoPath))) {
    throw new Error('Invalid path');
  }
  if (!fs.existsSync(sourceFullPath)) {
    throw new Error('Source item does not exist');
  }
  fs.mkdirSync(path.dirname(destFullPath), { recursive: true });
  fs.renameSync(sourceFullPath, destFullPath);
}

/**
 * Copy a file or directory to a new location
 */
export function copyItem(repoPath, sourceRelPath, destRelPath) {
  const sourceFullPath = path.join(repoPath, sourceRelPath);
  const destFullPath = path.join(repoPath, destRelPath);
  
  if (!sourceFullPath.startsWith(path.resolve(repoPath)) || !destFullPath.startsWith(path.resolve(repoPath))) {
    throw new Error('Invalid path');
  }
  if (!fs.existsSync(sourceFullPath)) {
    throw new Error('Source item does not exist');
  }
  
  if (fs.statSync(sourceFullPath).isDirectory()) {
    fs.cpSync(sourceFullPath, destFullPath, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(destFullPath), { recursive: true });
    fs.copyFileSync(sourceFullPath, destFullPath);
  }
}

/**
 * Create a new file
 */
export function createFile(repoPath, relPath, content = '') {
  const fullPath = path.join(repoPath, relPath);
  if (!fullPath.startsWith(path.resolve(repoPath))) {
    throw new Error('Invalid path');
  }
  if (fs.existsSync(fullPath)) {
    throw new Error('File already exists');
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

/**
 * Create a new directory
 */
export function createDirectory(repoPath, relPath) {
  const fullPath = path.join(repoPath, relPath);
  if (!fullPath.startsWith(path.resolve(repoPath))) {
    throw new Error('Invalid path');
  }
  if (fs.existsSync(fullPath)) {
    throw new Error('Directory already exists');
  }
  fs.mkdirSync(fullPath, { recursive: true });
}