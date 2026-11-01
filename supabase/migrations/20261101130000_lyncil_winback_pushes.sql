-- lyncil.winback_pushes: one row per (user, ending) — the idempotency gate
-- behind the win-back push (functions/lyncil/winback.ts). A trial or
-- subscription that ends sends one push however many times Adapty delivers
-- the event (it retries on any non-2xx, and both Adapty projects post here).
-- `lapsed_at` is the access level's expiry, so a user who comes back, pays
-- and lapses again gets a new row and a new push.
--
-- Reached only by the edge function over the direct connection; RLS on as a
-- guard. Idempotent like every migration here.

create table if not exists lyncil.winback_pushes (
  user_id uuid not null references lyncil.profiles (id) on delete cascade,
  lapsed_at timestamptz not null,
  event_type text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, lapsed_at)
);

alter table lyncil.winback_pushes enable row level security;
