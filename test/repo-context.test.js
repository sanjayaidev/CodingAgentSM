const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { collectRepositoryContext, commitPendingChanges, isOnlyGitignoreChange } = require('../server');
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

test('commitPendingChanges never commits aider bookkeeping files (chat/input history)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-agent-exclude-'));
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tempDir, stdio: 'ignore' });

  fs.writeFileSync(path.join(tempDir, 'feature.txt'), 'real change\n');
  fs.writeFileSync(path.join(tempDir, '.aider.chat.history.md'), 'chat log leak\n');
  fs.writeFileSync(path.join(tempDir, '.aider.input.history'), 'input log leak\n');

  const result = await commitPendingChanges({ cwd: tempDir, task: 'Add a feature' });
  assert.equal(result.committed, true);

  const committedFiles = execFileSync('git', ['show', '--stat', '--name-only', 'HEAD'], { cwd: tempDir, encoding: 'utf8' });
  assert.match(committedFiles, /feature\.txt/);
  assert.doesNotMatch(committedFiles, /\.aider\.chat\.history\.md/);
  assert.doesNotMatch(committedFiles, /\.aider\.input\.history/);

  const status = execFileSync('git', ['status', '--short'], { cwd: tempDir, encoding: 'utf8' });
  assert.match(status, /\.aider\.chat\.history\.md/); // left untracked, not committed
});

test('commitPendingChanges reports no changes when only aider bookkeeping files are dirty', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-agent-onlylog-'));
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tempDir, stdio: 'ignore' });

  fs.writeFileSync(path.join(tempDir, '.aider.chat.history.md'), 'chat log leak\n');

  const result = await commitPendingChanges({ cwd: tempDir, task: 'No-op' });
  assert.equal(result.committed, false);
});

test('isOnlyGitignoreChange flags a diff that only touches .gitignore', () => {
  assert.equal(isOnlyGitignoreChange('.gitignore\n'), true);
  assert.equal(isOnlyGitignoreChange('.gitignore'), true);
});

test('isOnlyGitignoreChange is false for a real change, even alongside .gitignore', () => {
  assert.equal(isOnlyGitignoreChange('.gitignore\nsrc/index.js\n'), false);
  assert.equal(isOnlyGitignoreChange('src/index.js\n'), false);
});

test('isOnlyGitignoreChange is false for no changes at all', () => {
  assert.equal(isOnlyGitignoreChange(''), false);
  assert.equal(isOnlyGitignoreChange('\n'), false);
});

// Regression test for the reported bug: aider's own check_gitignore() step
// auto-adds ".aider*" to .gitignore under --yes-always, and unlike
// .aider* bookkeeping files, an edit to .gitignore itself is a real tracked
// change that commitPendingChanges will happily commit — it's runAgentTask's
// job (via isOnlyGitignoreChange) to then recognize that as "no real
// change" before pushing/opening a PR. This test locks in that
// commitPendingChanges' behavior here hasn't silently changed to also
// exclude .gitignore (which would make the runAgentTask guard redundant but
// harmless) or, worse, to start swallowing real .gitignore edits users do
// want committed.
test('commitPendingChanges DOES commit a lone .gitignore edit (guarding against it is runAgentTask\'s job)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-agent-gitignore-'));
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tempDir, stdio: 'ignore' });

  // Simulate aider's check_gitignore() auto-adding its own bookkeeping
  // pattern to .gitignore (what happens without --no-gitignore).
  fs.writeFileSync(path.join(tempDir, '.gitignore'), '.aider*\n');

  const result = await commitPendingChanges({ cwd: tempDir, task: 'Some task that made no real edits' });
  assert.equal(result.committed, true);

  const committedFiles = execFileSync('git', ['show', '--stat', '--name-only', 'HEAD'], { cwd: tempDir, encoding: 'utf8' });
  assert.match(committedFiles, /\.gitignore/);

  const nameOnlyDiff = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: tempDir, encoding: 'utf8' });
  assert.equal(isOnlyGitignoreChange(nameOnlyDiff), true);
});
