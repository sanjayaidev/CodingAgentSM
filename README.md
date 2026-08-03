# Coding Agent

A web UI that lets you pick from Alibaba's Qwen/DeepSeek/GLM models on DashScope,
load a GitHub repo, and hand it tasks that [aider](https://aider.chat) executes
directly against the repo (editing files and committing changes).

## How it fits together

- `server/index.js` — Express app, sessions, static frontend
- `server/routes/auth.js` — GitHub OAuth login/callback/logout
- `server/routes/repos.js` — list the user's GitHub repos, clone/update one locally
- `server/routes/agent.js` — list models, run aider against a cloned repo
- `server/lib/github.js` — GitHub REST API calls
- `server/lib/git.js` — shells out to `git` to clone/update repos
- `server/lib/aider.js` — shells out to the `aider` CLI, pointed at Alibaba's OpenAI-compatible endpoint
- `public/index.html` — single-file React (via CDN + Babel) frontend

## 1. Register a GitHub OAuth App

Go to https://github.com/settings/developers → **New OAuth App**.

- **Homepage URL**: your app's URL (e.g. `https://your-app.railway.app`, or `http://localhost:3000` for local dev)
- **Authorization callback URL**: `<APP_BASE_URL>/api/auth/github/callback`, e.g.
  `http://localhost:3000/api/auth/github/callback`

Copy the generated **Client ID** and **Client Secret** into `.env`.

## 2. Get an Alibaba DashScope key

From Alibaba Cloud Model Studio, grab your workspace ID and API key and put
them in `.env` as `ALIBABA_WORKSPACE_ID` / `ALIBABA_API_KEY`.

> Double check the model IDs in `server/lib/models.js` against what's actually
> live in your DashScope console — a few of the dated ones look speculative
> and will simply fail at request time if they don't exist.

## 3. Configure `.env`

Fill in every value in `.env` (copy it, don't commit the real one — it's
already gitignored). At minimum you need:

```
ALIBABA_WORKSPACE_ID=...
ALIBABA_API_KEY=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=<random string>
```

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. Run locally

Aider is a Python CLI, so it needs to be installed separately from the Node app:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install aider-chat

npm install
npm start
```

Visit `http://localhost:3000`, click **Connect GitHub**, pick a repo, click
**Load repo**, choose a model, and type a task.

## 5. Deploy to Railway

This repo includes a `Dockerfile` (installs Node, Python, git, and aider in
one image) and `railway.json` is set to build from it. Push to Railway, set
the same env vars from `.env` in the Railway dashboard (with `APP_BASE_URL`
pointing at your real Railway domain and `NODE_ENV=production`), and update
your GitHub OAuth App's callback URL to match.

## Notes / limitations

- Sessions are stored in-memory (`express-session`'s default store). That's
  fine for a single low-traffic instance, but they're wiped on every restart
  and won't work if you scale to multiple instances. Swap in `connect-redis`
  or similar if that matters to you.
- The `repo` OAuth scope is requested so private repos work. If you only ever
  need public repos, narrow it to `public_repo` in `server/routes/auth.js`.
- Each aider run has a 5 minute timeout (`server/lib/aider.js`) — bump
  `timeout` there for bigger tasks.
- A streaming endpoint (`POST /api/agent/run/stream`, Server-Sent Events)
  already exists but isn't wired into the frontend yet — the UI currently
  waits for the full aider run before showing output.
