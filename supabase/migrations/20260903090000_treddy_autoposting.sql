-- Treddy autoposting — everything Treddy owns in the shared Supabase project
-- is namespaced so apps stay visually separate in the dashboard:
--   schema        treddy            (tables: accounts, posts, devices)
--   cron jobs     treddy-publish-due, treddy-refresh-tokens
--   vault secret  treddy_cron_secret
--   fn secrets    TREDDY_*
-- The schema is never exposed through PostgREST: it holds Threads access
-- tokens, and only the treddy edge function's direct Postgres connection
-- reads it. Idempotent — safe to re-run against the shared project.

create schema if not exists treddy;

create table if not exists treddy.accounts (
  threads_user_id text primary key,
  username text,
  access_token text not null,
  token_expires_at timestamptz not null,
  -- Bearer credential the app uses for /sync, issued once at /link.
  sync_secret uuid not null default gen_random_uuid(),
  -- Set when Threads rejects the token; cleared by a fresh /link.
  needs_reauth boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists accounts_sync_secret_key
  on treddy.accounts (sync_secret);

create table if not exists treddy.posts (
  -- The app's draft UUID, so sync stays trivially idempotent.
  id uuid primary key,
  threads_user_id text not null
    references treddy.accounts (threads_user_id) on delete cascade,
  text text not null,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'publishing', 'published', 'failed')),
  error text,
  published_media_id text,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists posts_due_idx on treddy.posts (status, scheduled_at);
create index if not exists posts_account_idx on treddy.posts (threads_user_id);

create table if not exists treddy.devices (
  device_token text primary key,
  threads_user_id text not null
    references treddy.accounts (threads_user_id) on delete cascade,
  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  -- BCP 47 tag the app runs in, so pushes arrive in the user's language.
  locale text not null default 'en',
  updated_at timestamptz not null default now()
);
create index if not exists devices_account_idx on treddy.devices (threads_user_id);

-- Nothing reads these tables through the API, but RLS stays on as a
-- belt-and-braces guard; the function's direct connection is unaffected.
alter table treddy.accounts enable row level security;
alter table treddy.posts enable row level security;
alter table treddy.devices enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The cron secret authorizes pg_cron's calls into the treddy edge function.
-- Generated inside Postgres so it never leaves the database or lands in a
-- repo; the function reads it back from Vault to verify callers.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'treddy_cron_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(24), 'hex'),
      'treddy_cron_secret',
      'Authorizes pg_cron calls to the treddy edge function'
    );
  end if;
end $$;

-- cron.schedule upserts by name, so re-running just refreshes the jobs.
select cron.schedule('treddy-publish-due', '* * * * *', $$
  select net.http_post(
    url := 'https://ttjzshiaatqvszckjlhw.supabase.co/functions/v1/treddy/publish-due',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-treddy-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'treddy_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  )
$$);

select cron.schedule('treddy-refresh-tokens', '43 3 * * *', $$
  select net.http_post(
    url := 'https://ttjzshiaatqvszckjlhw.supabase.co/functions/v1/treddy/refresh-tokens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-treddy-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'treddy_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  )
$$);
