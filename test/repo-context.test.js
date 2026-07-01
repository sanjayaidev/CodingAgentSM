const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectRepositoryContext } = require('../server');

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
