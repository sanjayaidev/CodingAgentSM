// POST /api/agent/run
// Client calls this (authenticated via Supabase session) with just
// { repoUrl, task, baseBranch, model }. This function looks up the
// user's stored GitHub token from Neon, then calls the Railway
// coding-agent server on their behalf — so the Railway URL and its
// AGENT_API_KEY never reach the browser.

import { getSql } from '../../lib/db';
import { getUserId } from '../../lib/auth';

export const config = {
  runtime: 'edge',
};

const AGENT_BASE_URL = process.env.CODING_AGENT_URL; // e.g. https://your-app.up.railway.app
const AGENT_API_KEY = process.env.CODING_AGENT_API_KEY;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function getStoredToken(sql, userId) {
  const rows = await sql`
    select access_token from github_tokens where user_id = ${userId}
  `;
  return rows[0]?.access_token || null;
}

async function deleteStoredToken(sql, userId) {
  await sql`delete from github_tokens where user_id = ${userId}`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (!AGENT_BASE_URL || !AGENT_API_KEY) {
    return json({ error: 'CODING_AGENT_URL / CODING_AGENT_API_KEY not configured' }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { repoUrl, task, baseBranch = 'main', model } = body || {};
  if (!repoUrl) return json({ error: 'repoUrl is required' }, 400);
  if (!task) return json({ error: 'task is required' }, 400);

  let sql, userId, githubToken;
  try {
    sql = getSql();
    userId = await getUserId(req);
    if (!userId) return json({ error: 'Not authenticated' }, 401);
    githubToken = await getStoredToken(sql, userId);
  } catch (err) {
    return json({ error: 'Auth/DB lookup failed', details: err.message }, 500);
  }

  if (!githubToken) {
    return json(
      { error: 'No GitHub token on file for this user — sign in with GitHub (repo scope) first' },
      400
    );
  }

  let upstream;
  try {
    upstream = await fetch(`${AGENT_BASE_URL}/agent/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': AGENT_API_KEY,
      },
      body: JSON.stringify({ repoUrl, task, baseBranch, model, githubToken }),
    });
  } catch (err) {
    return json({ error: 'Failed to reach coding agent', details: err.message }, 502);
  }

  const data = await upstream.json();

  if (data?.authError) {
    // Token is dead — remove it so future requests fail fast with a clear
    // "reconnect" message instead of repeatedly hitting GitHub with a bad token.
    try {
      await deleteStoredToken(sql, userId);
    } catch (err) {
      console.error('run.js: failed to delete invalid token:', err.message);
    }
    return json(
      {
        ok: false,
        error: 'Your GitHub connection has expired or been revoked.',
        reconnectRequired: true,
      },
      401
    );
  }

  return json(data, upstream.status);
}
