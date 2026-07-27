// lib/db.js - Optional PostgreSQL persistence for sessions and agent runs
// If DATABASE_URL is not set, this module exports enabled=false and the
// in-memory Map in server.js is used directly (single-instance behavior).

let pool = null;
let enabled = false;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  enabled = true;
}

async function saveSession(sid, data) {
  if (!enabled) return;
  await pool.query(
    `INSERT INTO sessions (id, github_token, github_login, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET github_token = $2, github_login = $3`,
    [sid, data.githubToken, data.githubLogin]
  );
}

async function getSession(sid) {
  if (!enabled) return null;
  const res = await pool.query('SELECT github_token, github_login FROM sessions WHERE id = $1', [sid]);
  if (res.rows.length === 0) return null;
  return { githubToken: res.rows[0].github_token, githubLogin: res.rows[0].github_login };
}

async function deleteSession(sid) {
  if (!enabled) return;
  await pool.query('DELETE FROM sessions WHERE id = $1', [sid]);
}

async function saveAgentRun(sid, { repoUrl, task, status, prUrl, log }) {
  if (!enabled) return;
  await pool.query(
    `INSERT INTO agent_runs (session_id, repo_url, task, status, pr_url, log, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [sid, repoUrl, task, status, prUrl || null, JSON.stringify(log)]
  );
}

module.exports = { enabled, saveSession, getSession, deleteSession, saveAgentRun };
