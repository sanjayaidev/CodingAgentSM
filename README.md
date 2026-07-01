# Coding Agent (Aider + NIM)

A minimal HTTP endpoint that:
1. Clones a GitHub repo
2. Runs [aider](https://aider.chat) against an NVIDIA NIM model to make the requested code change
3. Pushes a new branch
4. Opens a pull request

Later steps (deploy/test on Railway/Vercel per task) are **not** included yet — this is just clone → edit → PR.

## Setup

```bash
cp .env.example .env
# fill in AGENT_API_KEY, NIM_API_KEY, GITHUB_TOKEN
```

### GitHub token permissions
Classic PAT: `repo` scope.
Fine-grained PAT: Contents (read/write) + Pull requests (read/write) on the target repo(s).

### NIM model name
`NIM_MODEL` must match NVIDIA's exact model identifier as listed in the NIM catalog
(e.g. `qwen/qwen2.5-coder-32b-instruct` — confirm against your NIM account's available models,
since exact strings vary by deployment).

## Run locally

```bash
npm install
# aider must be installed locally too:
pip install aider-chat
node server.js
```

Server starts on `http://localhost:3000`.

## Test it

```bash
curl -X POST http://localhost:3000/agent/run \
  -H "Content-Type: application/json" \
  -H "x-api-key: $AGENT_API_KEY" \
  -d '{
    "repoUrl": "https://github.com/your-org/your-repo",
    "baseBranch": "main",
    "task": "Add input validation to the signup form and return a 400 with a clear message on invalid email"
  }'
```

Response (on success):
```json
{
  "ok": true,
  "changed": true,
  "prUrl": "https://github.com/your-org/your-repo/pull/42",
  "prNumber": 42,
  "branch": "aider/abc123",
  "aiderOutput": "...",
  "log": ["..."]
}
```

If aider decides no change is needed, `changed` will be `false` and no PR is opened.

## Deploy on Railway

1. Push this folder to a GitHub repo (or connect Railway directly to your repo).
2. In Railway: New Project → Deploy from GitHub repo → select this repo.
3. Railway will detect `railway.json` and build via the `Dockerfile`.
4. Set environment variables in Railway's dashboard (same as `.env.example`):
   - `AGENT_API_KEY`
   - `NIM_API_BASE`
   - `NIM_API_KEY`
   - `NIM_MODEL`
   - `GITHUB_TOKEN` (optional if you always pass `githubToken` per-request)
5. Deploy. Railway gives you a public URL — call `/agent/run` on it the same way as local testing.

## Notes / things to sanity check before relying on this

- **Per-request auth**: you can override the GitHub token per call via `"githubToken": "..."` in the
  request body — useful if different repos need different tokens. Falls back to the server's
  `GITHUB_TOKEN` env var otherwise.
- **Model override**: pass `"model": "..."` in the request body to use a different NIM model
  for a specific task without changing the server default.
- **No test/build verification yet**: aider makes the change and commits it, but nothing runs the
  project's test suite before opening the PR. That's the next piece to add (spin up the app,
  run tests, feed failures back to aider before pushing).
- **Concurrency**: each request gets its own `workspaces/<repo>-<runId>` directory, so concurrent
  requests against different repos (or even the same repo) won't collide. Workspaces are deleted
  after each run, success or failure.
- **maxBuffer**: git/aider output is capped at 50MB per command; raise `maxBuffer` in `run()` in
  `server.js` if you hit truncation on very large diffs.
