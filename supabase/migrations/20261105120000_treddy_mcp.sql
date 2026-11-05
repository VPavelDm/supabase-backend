-- Treddy MCP connector: Claude / ChatGPT can read the account's planning
-- context and SUGGEST posts; nothing they send is ever published until the
-- user approves it in the app.
--
--   * posts.status 'suggested' — a post an assistant proposed. The
--     publisher only claims 'scheduled' rows, so a suggestion is inert until
--     a device moves it to 'scheduled' (approve) or 'deleted' (dismiss).
--     /sync and /link only return suggestions to builds that ask for them:
--     older builds map an unknown status to scheduled.
--   * mcp_clients — OAuth clients: dynamically registered ones, and cached
--     Client ID Metadata Documents (verified_host = the host of the https
--     client_id, e.g. claude.ai; DCR clients name themselves, so they are
--     never "verified").
--   * mcp_pairings — one OAuth authorization in flight: the login page shows
--     user_code, the user confirms it in the app, the browser gets an auth
--     code. Ten minutes to live.
--   * mcp_grants — an assistant's access to one account. Only SHA-256 hashes
--     of its tokens are stored, so a database leak hands out no working
--     token. A refresh token that is presented again after rotation revokes
--     the grant: someone else holds a copy.
--   * accounts.time_zone — the device's IANA zone, so the tools can turn the
--     user's posting times (minutes after local midnight) into real times.

alter table treddy.accounts
  add column if not exists time_zone text;

create table if not exists treddy.mcp_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris jsonb not null check (jsonb_typeof(redirect_uris) = 'array'),
  verified_host text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists treddy.mcp_grants (
  id uuid primary key default gen_random_uuid(),
  threads_user_id text not null
    references treddy.accounts (threads_user_id) on delete cascade,
  client_id text not null
    references treddy.mcp_clients (client_id) on delete cascade,
  resource text not null,
  access_token_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_token_hash text not null unique,
  previous_refresh_hash text,
  -- When the refresh token last rotated: a client that races two refreshes
  -- gets a plain error for the stale one inside a short grace window
  -- instead of losing the whole grant.
  refreshed_at timestamptz,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists mcp_grants_account_idx on treddy.mcp_grants (threads_user_id);
create index if not exists mcp_grants_previous_refresh_idx
  on treddy.mcp_grants (previous_refresh_hash);

create table if not exists treddy.mcp_pairings (
  id uuid primary key default gen_random_uuid(),
  user_code text not null,
  poll_secret_hash text not null,
  client_id text not null
    references treddy.mcp_clients (client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  state text,
  resource text not null,
  -- pending → approved | denied (in the app) → issued (auth code handed to
  -- the browser) → used (exchanged for tokens).
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'issued', 'used')),
  threads_user_id text
    references treddy.accounts (threads_user_id) on delete cascade,
  auth_code_hash text unique,
  auth_code_expires_at timestamptz,
  grant_id uuid references treddy.mcp_grants (id) on delete set null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
create unique index if not exists mcp_pairings_pending_code_key
  on treddy.mcp_pairings (user_code) where status = 'pending';

alter table treddy.posts
  add column if not exists source text,
  add column if not exists suggested_by uuid
    references treddy.mcp_grants (id) on delete set null;
create index if not exists posts_suggested_by_idx
  on treddy.posts (suggested_by) where suggested_by is not null;

alter table treddy.posts drop constraint if exists posts_status_check;
alter table treddy.posts
  add constraint posts_status_check
  check (status in ('scheduled', 'publishing', 'published', 'failed', 'deleted', 'suggested'));

alter table treddy.mcp_clients enable row level security;
alter table treddy.mcp_grants enable row level security;
alter table treddy.mcp_pairings enable row level security;

-- Retention, now including the connector's rows. Suggestions nobody acted
-- on for 30 days become tombstones, so every device drops them too.
select cron.unschedule('treddy-cleanup');
select cron.schedule('treddy-cleanup', '17 4 * * *', $$
  delete from treddy.posts
  where status in ('published', 'failed')
    and updated_at < now() - interval '90 days';
  delete from treddy.posts
  where status = 'deleted'
    and updated_at < now() - interval '30 days';
  update treddy.posts
  set status = 'deleted', edited_at = now()
  where status = 'suggested'
    and updated_at < now() - interval '30 days';
  delete from treddy.mcp_pairings where expires_at < now() - interval '1 day';
  delete from treddy.mcp_grants
  where revoked_at < now() - interval '30 days'
     or refresh_expires_at < now() - interval '30 days';
  delete from treddy.mcp_clients c
  where c.created_at < now() - interval '7 days'
    and not exists (select 1 from treddy.mcp_grants g where g.client_id = c.client_id)
    and not exists (select 1 from treddy.mcp_pairings p where p.client_id = c.client_id);
  delete from treddy.ai_usage where day < current_date - 30;
  delete from treddy.job_runs where finished_at < now() - interval '30 days';
$$);
