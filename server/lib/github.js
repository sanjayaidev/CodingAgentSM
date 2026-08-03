// lib/github.js
// Thin wrapper around the GitHub REST API used for OAuth + repo listing.

const GITHUB_API = 'https://api.github.com';

/**
 * Exchange an OAuth "code" for an access token.
 */
export async function exchangeCodeForToken(code) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.APP_BASE_URL}/api/auth/github/callback`,
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }
  if (!data.access_token) {
    throw new Error('GitHub OAuth did not return an access token');
  }
  return data.access_token;
}

/**
 * Fetch the authenticated user's profile.
 */
export async function getGithubUser(token) {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub /user failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * List repos the authenticated user has access to (owned, collaborator, org member).
 * Paginates up to `maxPages` pages of 100.
 */
export async function listGithubRepos(token, { maxPages = 3 } = {}) {
  const repos = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `${GITHUB_API}/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) {
      throw new Error(`GitHub /user/repos failed: ${res.status} ${await res.text()}`);
    }
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break; // last page
  }

  return repos.map(r => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner?.login,
    private: r.private,
    defaultBranch: r.default_branch,
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
    updatedAt: r.updated_at,
  }));
}
