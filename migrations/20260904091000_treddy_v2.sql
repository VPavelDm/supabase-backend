-- Treddy backend v2 — closes the tech debts from the first pass:
--   * accounts.settings: server-side copy of the user's generation settings,
--     so /generate runs without the app resending the brief every call
--   * posts.created_at, a partial index for the due-post claim query, and
--     updated_at triggers via shared.set_updated_at
--   * job_runs: every cron run leaves an outcome row (autoposting health is
--     one query away)
--   * ai_usage: per-caller daily counters backing /generate's rate limit
--   * treddy-cleanup cron: retention for abandoned installs and old rows
-- Idempotent like every treddy migration — safe to re-run.

alter table treddy.accounts
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table treddy.posts
  add column if not exists created_at timestamptz not null default now();

-- The claim query only ever looks at scheduled rows.
drop index if exists treddy.posts_due_idx;
create index if not exists posts_due_scheduled_idx
  on treddy.posts (scheduled_at) where status = 'scheduled';

-- updated_at maintained by trigger instead of by hand in every statement.
drop trigger if exists treddy_set_updated_at on treddy.accounts;
create trigger treddy_set_updated_at
  before update on treddy.accounts
  for each row execute function shared.set_updated_at();
drop trigger if exists treddy_set_updated_at on treddy.posts;
create trigger treddy_set_updated_at
  before update on treddy.posts
  for each row execute function shared.set_updated_at();
drop trigger if exists treddy_set_updated_at on treddy.devices;
create trigger treddy_set_updated_at
  before update on treddy.devices
  for each row execute function shared.set_updated_at();

create table if not exists treddy.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  ok_count int not null default 0,
  fail_count int not null default 0,
  error text
);
create index if not exists job_runs_job_idx
  on treddy.job_runs (job, finished_at desc);

create table if not exists treddy.ai_usage (
  caller text not null,
  day date not null default current_date,
  count int not null default 0,
  primary key (caller, day)
);

-- Like the rest of the schema: never exposed through PostgREST, RLS stays on
-- as a belt-and-braces guard.
alter table treddy.job_runs enable row level security;
alter table treddy.ai_usage enable row level security;

-- Retention: sync only deletes rows for apps that still talk to us; this
-- catches abandoned installs and keeps the bookkeeping tables small.
select cron.schedule('treddy-cleanup', '17 4 * * *', $$
  delete from treddy.posts
  where status in ('published', 'failed')
    and updated_at < now() - interval '90 days';
  delete from treddy.ai_usage where day < current_date - 30;
  delete from treddy.job_runs where finished_at < now() - interval '30 days';
$$);
