-- Lingo's slice of the shared project: the language-learning apps (Hutarka
-- for English, Hejka for Polish, more to come) share one edge function,
-- `lingo`, one schema and one clip cache. Each app signs every install in
-- anonymously and calls text-to-speech (ElevenLabs) with the caller's user
-- token and its own app key. A key in a shipped binary is extractable, so
-- ai_usage is the second line of defence: daily counters per user and per
-- app that the route increments before it spends anything upstream.
--
-- Idempotent like every migration here — the shared project is long-lived
-- and re-runs happen.

create schema if not exists lingo;

-- One row per app, caller, route and day. `caller` is `user:<id>` for a
-- user's own counter and `app` for the app's total. `count` is calls;
-- `characters` is the text sent to ElevenLabs on a cache miss, which is what
-- it bills.
create table if not exists lingo.ai_usage (
  app text not null,
  caller text not null,
  route text not null,
  day date not null default current_date,
  count int not null default 0,
  characters int not null default 0,
  primary key (app, caller, route, day)
);

-- Not exposed through PostgREST (api.schemas stays public + graphql_public);
-- RLS on as a belt-and-braces guard, same as the other apps' bookkeeping.
alter table lingo.ai_usage enable row level security;

-- Synthesised clips at `<app>/<hash>.mp3`, the hash covering text, voice,
-- model and settings, so a phrase is paid for once and then served to every
-- learner. Only the function reads and writes it, with the service role; no
-- policy lets a user in.
insert into storage.buckets (id, name, public)
values ('lingo-tts-cache', 'lingo-tts-cache', false)
on conflict (id) do nothing;

-- Counters older than the cap window are dead weight.
select cron.schedule('lingo-cleanup', '41 4 * * *', $$
  delete from lingo.ai_usage where day < current_date - 30;
$$);
