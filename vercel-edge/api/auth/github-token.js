// POST /api/auth/github-token
// Called once, client-side, right after a successful Supabase GitHub
// OAuth sign-in — captures session.provider_token (which Supabase does
// NOT persist anywhere) and stores it against the user's id so later,
// unrelated requests (e.g. triggering the coding agent) can look it up
// without the user needing to be mid-OAuth-flow.
//
// Same edge/runtime shape as chat.js: fetch-based Neon client, no Node APIs.

import { getSql } from '../../lib/db';
import { getUserId, ensureUser } from '../../lib/auth';

export const config = {
  runtime: 'edge',
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function upsertToken(sql, userId, accessToken, githubLogin, scope) {
  await sql`
    insert into github_tokens (user_id, access_token, github_login, scope, updated_at)
    values (${userId}, ${accessToken}, ${githubLogin || null}, ${scope || null}, now())
    on conflict (user_id) do update
    set access_token = excluded.access_token,
        github_login = excluded.github_login,
        scope = excluded.scope,
        updated_at = now()
  `;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { accessToken, githubLogin, scope } = body || {};
  if (!accessToken) {
    return json({ error: 'accessToken is required (session.provider_token from Supabase)' }, 400);
  }

  let sql;
  let userId;
  try {
    sql = getSql();
    userId = await getUserId(req); // must be authenticated — same mechanism chat.js uses
    if (!userId) return json({ error: 'Not authenticated' }, 401);
    await ensureUser(sql, userId);
  } catch (err) {
    return json({ error: 'Auth/DB setup failed', details: err.message }, 500);
  }

  try {
    await upsertToken(sql, userId, accessToken, githubLogin, scope);
  } catch (err) {
    return json({ error: 'Failed to store token', details: err.message }, 500);
  }

  return json({ ok: true });
}
