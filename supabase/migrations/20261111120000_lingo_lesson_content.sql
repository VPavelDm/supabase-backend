-- The Lingo apps' lessons: the trail and every lesson file of each app
-- (Hutarka, Hejka, …), published from content/lingo/<app>/ with
-- content/lingo/publish.ts and read by the apps through lingo/content. The
-- files used to ship inside the app binaries; here a content fix reaches
-- every learner at their next launch instead of at the next App Store release.
--
-- One row per app and file: `id` is `trail` for the app's trail.json and the
-- lesson id (= file name) for a lesson. `body` is the file as it is; the apps
-- decode it exactly as they decoded the bundled files, so the format in
-- content/lingo/README.md is the contract. `checksum` is a hash of the body,
-- computed by the publish script; the route hashes the checksums of an app's
-- rows into a version, which the apps send back to be told "unchanged".
--
-- Idempotent like every migration here — the shared project is long-lived
-- and re-runs happen.

create schema if not exists lingo;

create table if not exists lingo.lesson_content (
  app text not null,
  id text not null,
  body jsonb not null,
  checksum text not null,
  published_at timestamptz not null default now(),
  primary key (app, id)
);

-- Not exposed through PostgREST (api.schemas stays public + graphql_public):
-- the route reads it over the direct connection. RLS on as a belt-and-braces
-- guard, same as lingo.ai_usage.
alter table lingo.lesson_content enable row level security;
