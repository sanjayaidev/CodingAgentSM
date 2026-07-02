const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { collectRepositoryContext, commitPendingChanges } = require('../server');
const { resolveBaseUrl } = require('../lib/github-oauth');

test('collectRepositoryContext reads key project files from a local repo', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-agent-repo-'));
  fs.mkdirSync(path.join(tempDir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# Demo Project\nThis app is a demo.\n');
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"demo"}\n');
  fs.writeFileSync(path.join(tempDir, 'server.js'), 'console.log("hello")\n');
  fs.writeFileSync(path.join(tempDir, 'Dockerfile'), 'FROM node:20\n');
  fs.writeFileSync(path.join(tempDir, 'railway.json'), '{"build": {"builder": "dockerfile"}}\n');
  fs.writeFileSync(path.join(tempDir, 'public/index.html'), '<html></html>\n');
  fs.writeFileSync(path.join(tempDir, 'src/index.js'), 'export const app = true;\n');

  const context = await collectRepositoryContext({ cwd: tempDir });

  assert.match(context, /README\.md/);
  assert.match(context, /server\.js/);
  assert.match(context, /public\/index\.html/);
  assert.match(context, /Demo Project/);
  assert.match(context, /console\.log\("hello"\)/);
});

test('resolveBaseUrl prefers Railway public domain when APP_BASE_URL is unset', () => {
  const req = {
    protocol: 'http',
    headers: { host: 'localhost:3000' },
    get(name) {
      return this.headers[name];
    },
  };

  assert.equal(resolveBaseUrl({ railwayPublicDomain: 'my-app.up.railway.app', req }), 'https://my-app.up.railway.app');
  assert.equal(resolveBaseUrl({ appBaseUrl: 'https://example.com', req }), 'https://example.com');
  assert.equal(resolveBaseUrl({ req }), 'http://localhost:3000');
});

test('commitPendingChanges stages and commits pending file edits', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-agent-commit-'));
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tempDir, stdio: 'ignore' });

  fs.writeFileSync(path.join(tempDir, 'new-file.txt'), 'created by test\n');

  const result = await commitPendingChanges({ cwd: tempDir, task: 'Create a new file' });

  assert.equal(result.committed, true);
  const status = execFileSync('git', ['status', '--short'], { cwd: tempDir, encoding: 'utf8' });
  assert.equal(status.trim(), '');
});
