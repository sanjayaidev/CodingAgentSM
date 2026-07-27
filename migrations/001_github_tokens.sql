create table if not exists github_tokens (
  user_id text primary key,
  access_token text not null,
  github_login text,
  scope text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
