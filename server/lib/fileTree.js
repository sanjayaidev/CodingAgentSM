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
