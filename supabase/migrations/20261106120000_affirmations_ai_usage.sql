-- Affirmations' slice of the shared project. The app (Here: Daily Audio
-- Affirmations) signs every install in anonymously, like Lyncil, and calls
-- two routes under the `affirmations` function: generate-affirmations
-- (OpenAI) and text-to-speech (ElevenLabs). Both need the caller's user
-- token and the app key baked into the binary; a key in a shipped binary is
-- extractable, so ai_usage is the second line of defence: a per-user daily
-- counter each route increments before it spends anything upstream.
--
-- Idempotent like every migration here — the shared project is long-lived
-- and re-runs happen.

create schema if not exists affirmations;

-- One row per user, route and day. `count` is calls; `characters` is the
-- text sent to ElevenLabs on a cache miss, which is what it bills.
create table if not exists affirmations.ai_usage (
  caller text not null,
  route text not null,
  day date not null default current_date,
  count int not null default 0,
  characters int not null default 0,
  primary key (caller, route, day)
);

-- Not exposed through PostgREST (api.schemas stays public + graphql_public);
-- RLS on as a belt-and-braces guard, same as lyncil's bookkeeping tables.
alter table affirmations.ai_usage enable row level security;

-- Synthesised clips, keyed by a hash of text, voice, model and settings, so
-- replaying an affirmation costs nothing. Only the function reads and writes
-- it, with the service role; no policy lets a user in.
insert into storage.buckets (id, name, public)
values ('affirmations-tts-cache', 'affirmations-tts-cache', false)
on conflict (id) do nothing;

-- Counters older than the cap window are dead weight.
select cron.schedule('affirmations-cleanup', '37 4 * * *', $$
  delete from affirmations.ai_usage where day < current_date - 30;
$$);
