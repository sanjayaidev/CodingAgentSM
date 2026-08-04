# Coding Agent v2.0

A web UI that lets you pick from 68 Alibaba DashScope AI models (Qwen/DeepSeek/GLM), load a GitHub repo, and hand it coding tasks that aider executes directly against the repo.

## How to run

```
PORT=5000 npm start
```

The workflow **Start application** is already configured and runs `PORT=5000 npm start`.

## Prerequisites

`aider` is a Python CLI, not an npm package, so `npm install` alone does not
provide it. Install it once per machine/container:

```
pip install aider-install && aider-install
```

Make sure the install directory (usually `~/.local/bin`) is on `PATH` for
whatever process runs `npm start` — otherwise agent runs fail with
`spawn aider ENOENT`. The Dockerfile and `.replit` config in this repo
already do this for you.

## Required environment variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | ✅ | Secret for express-session (already set) |
| `ALIBABA_API_KEY` | ✅ | DashScope API key for AI model calls |
| `ALIBABA_BASE_URL` | one of these | Full DashScope endpoint URL |
| `ALIBABA_WORKSPACE_ID` | one of these | Workspace ID (builds endpoint automatically) |
| `GITHUB_CLIENT_ID` | ✅ | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | ✅ | GitHub OAuth app client secret |
| `APP_BASE_URL` | ✅ | Public URL of this app (for OAuth callback) |

Optional:
- `NODE_ENV` — set to `production` in deployment
- `LOG_LEVEL` — defaults to `info`
- `FRONTEND_URL` — restrict CORS origin (defaults to `*`)
- `WORKSPACE_DIR` — where repos are cloned (defaults to `./workspace`)

## Stack

- **Backend**: Node.js 18+, Express 4, Socket.IO 4, express-session
- **Frontend**: Single-page vanilla JS (`public/index.html`)
- **AI**: Alibaba DashScope via aider + litellm (openai-compatible)
- **Auth**: GitHub OAuth 2.0

## Key API routes

| Route | Description |
|---|---|
| `GET /api/agent/models` | List all 68 available models |
| `POST /api/agent/run` | Run agent: `{ repoPath, task, modelId, files }` |
| `GET /api/auth/github` | Start GitHub OAuth flow |
| `GET /api/auth/me` | Get current session user |
| `GET /api/repos` | List user's GitHub repos |
| `POST /api/repos/clone` | Clone a repo locally |
| `GET /api/files/tree` | File tree for a repo |
| `GET/PUT /api/files/content` | Read/write file content |
| `POST /api/repos/push` | Commit + push + optional PR |

## User preferences

- Keep the existing Node.js/Express/vanilla-JS stack — do not migrate to a frontend framework
