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

Every run also returns a `tokens` field: `{ approxContextTokens, aiderTokenSummary }`.
`approxContextTokens` is a rough (chars/4) estimate of the conversation context folded into
the aider task (see `context` below) — aider manages its own LLM calls internally, so this
process doesn't get an exact count back from it the way it does for `/api/chat`.
`aiderTokenSummary` is only populated if aider's own console output included a
"Tokens: X sent, Y received" line.

### Persisting chat context into the agent run

Pass the prior conversation as `context` (an array of `{role, content}` messages, same shape
as `/api/chat`) so a fresh aider clone can resolve references like "the text you gave me
earlier":

```json
{
  "repoUrl": "...",
  "task": "Use the text I gave you above as the new footer copy",
  "context": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

## API reference (for external callers)

Every endpoint below accepts either a browser session cookie (from "Connect GitHub") or an
`x-api-key: $AGENT_API_KEY` header — pass whichever you have. CORS is enabled, so these can be
called directly from another service/browser origin.

| Method & path              | Purpose                                                                 |
|-----------------------------|--------------------------------------------------------------------------|
| `POST /agent/run`           | Buffered agent run — clone, aider, commit, push, open PR. Returns once done. |
| `POST /agent/run/stream`    | Same as above, but streams newline-delimited JSON progress events (`{"type":"step",...}`, then one `{"type":"done"|"error",...}`). This is what the built-in UI's activity panel now consumes for real progress. |
| `POST /api/chat`            | Plain chat completion via NIM. Returns `{ message, usage, contextWindow, contextUsedFraction }` — `usage` is the exact `prompt_tokens`/`completion_tokens`/`total_tokens` from NIM for that call, since the full message history is re-sent every turn this **is** your current context-window usage. |
| `GET /api/models`           | List of allowed NIM models + the default. |
| `POST /api/console/run`     | Run `python3`/`python`/`pip`/`pip3`/`node`/`npm`/`bash`/`sh` with args, streamed as NDJSON (`stdout`/`stderr`/`exit` events). See "Execution console" below. |
| `DELETE /api/console/:id`   | Delete a console workspace. |

`NIM_CONTEXT_WINDOW` (env var, default `32768`) controls the context-window size used to
compute `contextUsedFraction` — set it to match whatever model you're actually using so the
percentage is meaningful.

## Execution console (Python / bash / npm)

`POST /api/console/run` runs one allowlisted command (`python3`, `python`, `pip`, `pip3`,
`node`, `npm`, `bash`, `sh`) with an argv array — never a shell string, so there's no
shell-injection surface through `args`:

```bash
curl -N -X POST http://localhost:3000/api/console/run \
  -H "Content-Type: application/json" \
  -H "x-api-key: $AGENT_API_KEY" \
  -d '{"command": "python3", "args": ["-c", "print(1+1)"]}'
```

Pass back the `consoleId` from the `start` event on later calls to reuse the same working
directory (e.g. keep a venv or `node_modules` around between calls). Idle console workspaces
are swept after 2 hours; `DELETE /api/console/:id` removes one immediately.

**This is a first version, not a sandbox.** Commands run directly inside this app's own
container with whatever filesystem/network access that container already has — there's no
per-run isolation (no separate container, user, or network policy per command). Anyone with a
valid `x-api-key` or session can run arbitrary code inside it. That's fine for a personal
deployment behind a private `AGENT_API_KEY`; before exposing this more broadly, put real
sandboxing in front of it (e.g. a per-run container/VM with resource and network limits).

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
  requests against different repos (or even the same repo) won't collide. Workspaces (and aider's
  log dir alongside them) are deleted after each run, success or failure.
- **maxBuffer**: git/aider output is capped at 50MB per command; raise `maxBuffer` in `run()` in
  `server.js` if you hit truncation on very large diffs.
- **Aider's chat/input history files never enter the repo**: they're written to a directory
  outside the clone (`--chat-history-file` / `--input-history-file`) and `commitPendingChanges`
  additionally excludes any `.aider*` files from `git add` as a second layer of defense, so
  they can't end up committed into a PR even if something else drops one into the working tree.
- **Console execution has no sandboxing beyond the host container** — see "Execution console" above.
