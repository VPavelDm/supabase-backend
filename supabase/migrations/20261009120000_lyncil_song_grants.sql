-- Extra songs given to one user by hand (an apology after an outage, say),
-- on top of their plan's allowance (functions/lyncil/song-quota.ts). A grant
-- counts in the allowance window it was given in: until the plan renews, or
-- for 7 days with no plan. Nothing in the app writes here; grants are made
-- from the CLI, one row each, with the reason on record:
--
--   supabase db query --linked "insert into lyncil.song_grants (user_id, songs, reason)
--     values ('<user id>', 10, 'Lyria 402 outage 2026-10-08')"
--
-- Idempotent like every migration here.

create table if not exists lyncil.song_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references lyncil.profiles (id) on delete cascade,
  songs int not null check (songs between 1 and 1000),
  reason text not null check (length(trim(reason)) > 0),
  granted_at timestamptz not null default now()
);

create index if not exists song_grants_user_granted_idx
  on lyncil.song_grants (user_id, granted_at);

-- Reached only by the edge function over the direct connection; the lyncil
-- schema is not exposed through PostgREST. RLS on as a guard all the same.
alter table lyncil.song_grants enable row level security;
