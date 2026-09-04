-- Lyncil's slice of the shared project. The app has no accounts and no
-- Supabase auth, so lyncil/generate-lyrics deploys with JWT verification off
-- and authenticates callers with the app key baked into the binary. A key in
-- a shipped binary is extractable, so ai_usage is the second line of defence:
-- a per-caller daily counter the route increments before it ever spends a
-- token on OpenAI.
--
-- Idempotent like every migration here — the shared project is long-lived
-- and re-runs happen.

create schema if not exists lyncil;

create table if not exists lyncil.ai_usage (
  caller text not null,
  day date not null default current_date,
  count int not null default 0,
  primary key (caller, day)
);

-- Not exposed through PostgREST (api.schemas stays public + graphql_public);
-- RLS on as a belt-and-braces guard, same as treddy's bookkeeping tables.
alter table lyncil.ai_usage enable row level security;

-- Counters older than the cap window are dead weight.
select cron.schedule('lyncil-cleanup', '23 4 * * *', $$
  delete from lyncil.ai_usage where day < current_date - 30;
$$);
