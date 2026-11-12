-- Sign in with Apple for Affirmations. A user who signs in links an Apple
-- identity to their anonymous account (same auth id, so their library stays
-- theirs). App Store guideline 5.1.1(v) then requires that deleting their
-- data also revokes the app's Apple authorization, which takes the refresh
-- token Apple issues for the sign-in's authorization code. The app hands the
-- code to `affirmations/apple-token` right after signing in; the route trades
-- it for that token and keeps it here, and `affirmations/delete-my-data`
-- revokes it before deleting the row.
--
-- Only the functions touch this table, with the direct connection: RLS on and
-- no policy, so no app token can read a refresh token. It cascades with the
-- auth user, and `userHoldsAppData` lists it.
--
-- Idempotent like every migration here.

create schema if not exists affirmations;

create table if not exists affirmations.apple_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Apple's id for the person (`sub` of the identity token).
  apple_sub text not null,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table affirmations.apple_tokens enable row level security;
