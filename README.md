# Coding Agent (Aider + NIM)

A self-contained app — API + UI in one Railway service — that:
1. Lets you connect a GitHub account (OAuth, `repo` scope) from a built-in web UI
2. Lists your repos so you can pick one and describe a task
3. Clones the repo and runs [aider](https://aider.chat) against an NVIDIA NIM model to make the change
4. Pushes a new branch and opens a pull request, with the result shown live in the UI

`/agent/run` also still works as a plain HTTP endpoint for server-to-server callers (see "Calling it directly" below).

## Setup

```bash
cp .env.example .env
# fill in NIM_API_KEY, GITHUB_CLIENT_ID/SECRET (see below), optionally AGENT_API_KEY / GITHUB_TOKEN
```

### GitHub OAuth App (for the "Connect GitHub" button)
1. Go to https://github.com/settings/developers → **New OAuth App**.
2. Homepage URL: your Railway URL (or `http://localhost:3000` for local dev).
3. Authorization callback URL: `<your-app-url>/auth/github/callback` — e.g.
   `https://your-app.up.railway.app/auth/github/callback`.
4. Copy the generated Client ID / Client Secret into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
5. Set `APP_BASE_URL` to that same base URL in production (Railway) so the callback matches exactly;
   leave it blank locally and it's inferred from the request.

Sessions (GitHub token per logged-in user) are stored **in memory** — fine for a personal, single-replica
app, but they're lost on redeploy/restart. Just click "Connect GitHub" again.

### GitHub token permissions
The OAuth flow requests `repo` scope, which covers clone/push + pull requests on both public and
private repos. If you're instead using a manually-issued token (`GITHUB_TOKEN` env var, server-to-server
calls only): classic PAT needs `repo` scope; fine-grained PAT needs Contents (read/write) + Pull requests
(read/write) on the target repo(s).

### NIM model name
`NIM_MODEL` must match NVIDIA's exact model identifier as listed in the NIM catalog
(e.g. `qwen/qwen2.5-coder-32b-instruct` — confirm against your NIM account's available models,
since exact strings vary by deployment). The UI's model field is a free-text input with a few
suggestions (`CODING_MODELS` in `server.js`) — edit that list once you've confirmed what's actually
in your NIM catalog.

## Run locally

```bash
npm install
# aider must be installed locally too:
pip install aider-chat
node server.js
```

Open `http://localhost:3000` — click **Connect GitHub**, pick a repo, describe a task, and run.

## Using the UI

1. Deploy (see below), open the app's URL.
2. Click **Connect GitHub** → authorize the OAuth App (`repo` scope).
3. Pick a repo from the dropdown (base branch pre-fills from the repo's default branch).
4. Optionally override the model.
5. Describe the change in the **Task** box and click **Run agent**.
6. Watch the log stream in; on success you get a link straight to the opened PR.

## Calling it directly (server-to-server)

`/agent/run` still accepts a plain API-key-authenticated call, e.g. from another backend of yours —
in that mode you must supply `githubToken` yourself (the UI's browser session isn't involved):

```bash
curl -X POST http://localhost:3000/agent/run \
  -H "Content-Type: application/json" \
  -H "x-api-key: $AGENT_API_KEY" \
  -d '{
    "repoUrl": "https://github.com/your-org/your-repo",
    "baseBranch": "main",
    "githubToken": "ghp_...",
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
   - `NIM_API_KEY` (+ `NIM_API_BASE` / `NIM_MODEL` if you're not using the defaults)
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (OAuth App, see above)
   - `APP_BASE_URL` — set this to your Railway URL once Railway assigns one, e.g.
     `https://your-app.up.railway.app`, and update the OAuth App's callback URL to match
   - `AGENT_API_KEY` (optional — only needed if you also call `/agent/run` server-to-server)
   - `GITHUB_TOKEN` (optional fallback for server-to-server calls without a `githubToken` in the body)
5. Deploy. Railway gives you a public URL — open it, that's your UI. (This also fixes the
   "Cannot GET /" you were seeing: `server.js` previously had no route for `GET /` at all, only
   `POST /agent/run` and `GET /health` — it now serves the dashboard there.)

## About `vercel-edge/`

Those three files were written to be dropped into a *separate* Next.js/Vercel app (one with its own
`lib/db.js` / `lib/auth.js` on Neon + Supabase) as a thin proxy in front of this Railway service. Since
the UI now lives directly in this app instead, that folder is no longer needed — safe to delete, or keep
around if you later want a Vercel frontend talking to this same `/agent/run` endpoint via `AGENT_API_KEY`.

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
