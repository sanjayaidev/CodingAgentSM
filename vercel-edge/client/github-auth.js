// Run this once wherever your app initializes Supabase auth listening
// (e.g. a top-level AuthProvider). Captures provider_token the moment
// it's available and ships it to /api/auth/github-token for storage —
// Supabase itself never persists this token, so this is the only chance
// to grab it (fires on SIGNED_IN and on INITIAL_SESSION if the token is
// still present in that session object).

import { supabase } from './supabaseClient'; // however you already init the client

// Kick off sign-in — 'repo' scope is required for clone/push/PR access.
// Public-repo-only use case can use 'public_repo' instead.
export async function signInWithGitHub() {
  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { scopes: 'repo' },
  });
}

// Call this once on app load (e.g. in your root layout / AuthProvider effect)
export function listenForGithubToken() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (!session?.provider_token) return;
    if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;

    try {
      await fetch('/api/auth/github-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // however your app attaches the Supabase access token for
          // getUserId(req) to verify server-side — adjust header name
          // to match your existing lib/auth.js convention
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          accessToken: session.provider_token,
          githubLogin: session.user?.user_metadata?.user_name || null,
          scope: 'repo',
        }),
      });
    } catch (err) {
      console.error('Failed to persist GitHub token:', err);
    }
  });
}
