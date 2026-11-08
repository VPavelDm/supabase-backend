# CLAUDE.md — shared Supabase backend

This repo (github: VPavelDm/supabase-backend, local:
~/Developer/supabase-backend, formerly FuturaBE inside the futura folder) is
the single source of truth for the shared Supabase project
`ttjzshiaatqvszckjlhw` (org name "Futura"), which hosts several apps on one
plan. It owns the migration history, every edge function, and the shared
utilities. App repos (Treddy, Futura iOS, Lyncil iOS, Affirmations iOS, Hutarka iOS) contain no backend
code — they point here.

Layout: everything lives under `supabase/` — the CLI's canonical layout. It
looks for `supabase/config.toml` below the working directory, so run
commands from the repo root; files at the root itself are invisible to it.

## Conventions — everything an app owns is namespaced

| Piece            | Convention                      | Treddy                          | Futura | Lyncil | Affirmations | Lingo (Hutarka, Hejka, …) |
|------------------|---------------------------------|---------------------------------|--------|--------|--------------|---------------------------|
| Edge function    | one slug per app, routes inside | `treddy/<route>`                | `futura/<route>` (+ legacy single-route functions until the force update) | `lyncil/<route>` | `affirmations/<route>` | `lingo/<route>` — one slug for the app family; the app key says which app |
| Postgres schema  | one schema per app              | `treddy`                        | `futura` | `lyncil` | `affirmations` | `lingo` |
| Migrations       | `<timestamp>_<app>_<desc>.sql`  | `*_treddy_*.sql`                | historic names vary | `*_lyncil_*.sql` | `*_affirmations_*.sql` | `*_lingo_*.sql` |
| Cron jobs        | `<app>-` prefix                 | `treddy-publish-due` (every minute), `treddy-refresh-tokens` (daily), `treddy-cleanup` (daily) | — | `lyncil-cleanup` (daily) | `affirmations-cleanup` (daily) | `lingo-cleanup` (daily) |
| Vault secrets    | `<app>_` prefix                 | `treddy_cron_secret`            | — | — | — | — |
| Function secrets | `<APP>_` prefix                 | `TREDDY_*` (see functions/treddy/index.ts) | — | `LYNCIL_*` (see functions/lyncil/index.ts) | `AFFIRMATIONS_*` (see functions/affirmations/index.ts) | `LINGO_*`, one `LINGO_<APP>_APP_KEY` per app (see functions/lingo/index.ts) |

Cross-app pieces live under `shared`: the `shared` Postgres schema
(`shared.set_updated_at`), the `shared-` cron prefix
(`shared-purge-cron-history`), and `functions/_shared/` (router, direct-db
client, cron auth, APNs client, CORS/response helpers, supabase-js client,
`erase-user.ts`).

**Deleting a user's data** (`delete-my-data`, one route per app: Futura,
Lyncil, Affirmations, Lingo). Each route checks the caller with the auth server (plus
the app key where the app has one), deletes that app's rows and its
`<user id>/` storage folders, erases the user at the services that know their
id (Lyncil only: Adapty and Amplitude, under both id spellings), and then
deletes the auth user only if `userHoldsAppData` in `_shared/erase-user.ts`
finds nothing of any other app's. Auth users are shared by every app on the
project, and rows that reference `auth.users` cascade, so **an app that starts
keeping per-user rows or files here adds them to `userHoldsAppData`** —
otherwise another app's deletion can take its data with the auth user.
`OPENAI_API_KEY` without a prefix is the project-wide fallback key.

API keys come from `functions/_shared/keys.ts`: `publishableKey()` for calls
made with the caller's token, `secretKey()` (bypasses RLS) only for
server-side work. They read the new keys (`SUPABASE_PUBLISHABLE_KEYS` /
`SUPABASE_SECRET_KEYS`) and fall back to the legacy ones with a logged
warning ("… is not set; using the legacy …"); never read
`SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` directly. Supabase retires
legacy keys in early 2027; the apps' own keys are a separate matter (Lyncil
and Calories iOS still ship legacy ones).

**Offer seasons for every app** (`20261101120000_shared_offer_seasons.sql`):
`shared.offer_seasons` (one row per app and season: month-day `starts`/`ends`,
`duration_minutes`, `enabled`) and `shared.offer_rules` (per-app rest days,
refund quiet days, win-back hours), read by the apps' onboarding-ios
`SharedBackendOfferConfig` through `public.shared_offer_config(p_app)`. That
RPC is granted to `anon` as well as `authenticated` — the one exception to
the rule below: apps like Calyo have no session in this project, and season
dates are public. Nothing private goes in these tables. Each row names one
app; an edit reaches every installed copy of that app at its next launch.

**Force-update floors** (`20261106130000_shared_app_config.sql`):
`public.app_config` (`key`, `value`, `updated_at`), a key/value table that Futura iOS and Treddy
iOS read at launch straight through PostgREST with the publishable key: rows
`futura_ios_minimum_version` / `futura_ios_recommended_version` and
`treddy_ios_minimum_version` / `treddy_ios_recommended_version`, compared with the app's
`CFBundleShortVersionString`. It sits in `public` on purpose, against the rule below: the apps
select the table itself, so it must stay exposed under this exact name. **Don't move or rename
it**: the apps fail open, so a moved table quietly switches every force update off. `anon` and
`authenticated` may only read it, and only `service_role` (dashboard, migrations) writes it, so
nothing private goes in. No rows means no requirement. Raising a `*_minimum_version` locks out
every installed build below it at its next launch, all at once: only ever set it to a version
that is already live in the store and most users have. Lyncil keeps its floors in Firebase
Remote Config (`app_version` on iOS, `android_app_version` on Android), not here.

## Architecture per app

**Treddy** (`treddy` schema: accounts, posts, devices, job_runs, ai_usage):
the schema is NOT exposed through PostgREST — it holds Threads tokens. Routes
use the direct Postgres connection (`SUPABASE_DB_URL`, `_shared/db.ts`) and
carry their own auth: `link` proves ownership with the Threads token,
issues a sync secret, and returns the account's stored settings (null until
onboarding was completed somewhere — how the app tells a returning user from
a new one) and posts; `sync` (a merge, not a mirror: one account may live on several devices — content/schedule are last-write-wins on the device's `edited_at`, publish outcomes are the server's, deletions are `status = 'deleted'` tombstones purged after 30 days; it returns the account's whole post list plus its `settings`, null meaning the device must run the setup questions again)/`settings`/`generate`/`account` (DELETE — full
removal, cascades posts and devices) take the sync secret as bearer; `generate` pre-link (onboarding) takes the `x-treddy-app-key` header
instead; `publish-due`/`refresh-tokens` take pg_cron's Vault secret;
`threads-oauth` is Meta's OAuth redirect target. Generation prompts, model,
and caps are server-side; the app sends only per-action input, and the user's
brief + writing samples + planning defaults (posting times, plan days) live in
`accounts.settings`.

Treddy's **MCP connector** (Claude / ChatGPT custom connector) can only
*suggest* posts: `mcp` inserts `status = 'suggested'` rows, which
`publish-due` never claims; the user approves them in the app (a device
moves them to `scheduled`) or dismisses them (`deleted`). `sync`/`link`
return suggested rows only when the request sends `"suggestions": true` —
older app builds read an unknown status as scheduled. Its OAuth server
(`oauth/*`, public clients, PKCE S256, CIMD + DCR, token hashes only) and
login are reached through the Cloudflare Worker in `workers/treddy-mcp`
(root `/.well-known` docs and the HTML login page, which Supabase can't
serve). Users paste `https://treddy.lyncil.com/mcp`: a CloudFront
distribution in front of the Worker's workers.dev address
(`workers/treddy-mcp/cloudfront/README.md`), whose origin is the Worker's
`PUBLIC_ORIGIN` and the function's `TREDDY_MCP_PUBLIC_URL` (unset =
connector off). Per-IP limits read the caller through `clientIP()`
(`mcp-auth.ts`): the IP CloudFront saw, relayed by the Worker with
`TREDDY_RELAY_SECRET`, else the last `x-forwarded-for` entry, never the
first (the caller writes that one). Unlinked `generate` calls also share
one daily cap (`UNLINKED_DAILY_CAP`). Login is a pairing: the page shows a code,
the app confirms it via `mcp-pair/*`; `mcp-grants` lists/revokes
assistants. Deploy order: migration, then function (it selects new
columns), then Worker.

**Futura** (`futura` schema: capsules, capsule_photos, capsule_voice_notes,
profiles): routes are thin pass-throughs to `public` RPCs whose bodies
resolve tables via `SET search_path TO 'futura'`; auth is the caller's JWT
riding into PostgREST, enforced by `auth.uid()` + RLS. Storage: private
buckets `capsule-photos` / `capsule-voice-notes`, files scoped to
`{user_id}/{capsule_id}/{uuid}.{ext}`, signed URLs from `get-capsules`.
The legacy single-route functions are wrappers around
`functions/futura/handlers/` — delete them (and their config.toml entries)
after the app's force update.

**Lyncil** (`lyncil` schema: songs, ai_usage): the app signs every install
in **anonymously** on launch (Supabase anonymous sign-ins must be enabled on
the project; the session lives in the iOS Keychain, which survives a
reinstall, so the same anonymous user comes back with their library). Songs
live in `lyncil.songs` — the user's pickers (genre, mood, artist, voice),
their prompt, the generated name and lyrics, and the library state — reached
through Futura-style public RPCs `lyncil_get_songs()`, `lyncil_upsert_song(…)`,
`lyncil_delete_song(uuid)` (SECURITY DEFINER, `auth.uid()`, dates as epoch
seconds). One route, `generate-lyrics`, writes two distinct sets of song
lyrics in a single model call from the user's idea plus their pickers. It
requires the caller's user token (no token, or the bare anon key → 401) AND
the app key baked into the binary (`x-lyncil-app-key`, secret
`LYNCIL_APP_KEY`), and caps every user per day through `lyncil.ai_usage` —
a shipped key is extractable, and the cap is what keeps the OpenAI key from
being drained. The prompt template, the model, the strict JSON schema, and
the genre / mood / artist fallbacks all live server-side; the app sends only
the user's choices, so prompts iterate without an App Store release. This
replaced a raw GPT proxy on Lyncil's own Supabase project that anyone with
the anon key could drive with any model on our OpenAI key.

Share links (`functions/lyncil/share.ts`, `lyncil.song_shares`):
`share-song` gives a paid user's song one live link
(music.lyncil.com/s/<slug>), `unshare-song` revokes it, and `shared-song`
feeds the web page (VPavelDm/Lyncil-Web) the live song plus a 15-minute
signed track URL. `shared-song` takes `x-lyncil-web-key` (`LYNCIL_WEB_KEY`,
held by the page's Lambda), never the app key, and a deleted song, a revoked
link and an unknown slug all answer the same 404.

**Affirmations** (Here: Daily Audio Affirmations; `affirmations` schema:
ai_usage; storage bucket `affirmations-tts-cache`): set up like Lyncil. The
app signs every install in anonymously on launch, and both routes need the
caller's user token AND the app key baked into the binary
(`x-affirmations-app-key`, secret `AFFIRMATIONS_APP_KEY`).
`generate-affirmations` writes fifty affirmations on the user's topic; the
prompt, model and JSON schema live server-side, capped at 30 calls per user
per day. `text-to-speech` speaks one clip through ElevenLabs, accepts only
the app's five voices and two models, caps text at 400 characters, and
caches every clip in the bucket by a hash of text, voice, model and
settings; a cache miss counts its characters against 20,000 per user per
day. Both routes count through `affirmations.ai_usage` (per user, route and
day). Before 1.8 the app called `generate-affirmations` and
`text-to-speech` on Pretzly's project with the anon key alone.

**Lingo** (the language-learning apps — Hutarka teaches English, Hejka
Polish, the next one adds an entry to `functions/lingo/apps.ts`; `lingo`
schema: ai_usage; storage bucket `lingo-tts-cache`): one function for the
whole family, set up like Affirmations. Every install signs in anonymously,
and each route needs the caller's user token AND an app key
(`x-lingo-app-key`); the key is per app (`LINGO_HUTARKA_APP_KEY`,
`LINGO_HEJKA_APP_KEY`) and is how the route knows which app is calling, so
one app's key rotates without touching the others. `text-to-speech` takes
only `text` (≤ 200 characters) and a voice role (`narrator` or `partner`);
the language, ElevenLabs model, voice ids and speed come from `apps.ts`, so
a voice swap is a redeploy, not an App Store release. Clips are cached at
`<app>/<hash>.mp3`, the hash covering text, voice, model and settings, so a
phrase is paid for once and then heard by every learner. A cache miss
counts its characters in `lingo.ai_usage` twice: against the user (5,000 a
day — all of Hutarka's first chapter is about that) and against the app as
a whole (200,000 a day), the second being what stops a leaked key plus a
loop of fresh anonymous users from draining the shared ElevenLabs account.
Deploy order on first rollout: migration, then `_shared/erase-user.ts`
selects from `lingo.ai_usage`, so every app's `delete-my-data` fails until
the migration is in.

## Commands

Run from the repo root.

```bash
supabase db push                        # Apply new migrations to remote
supabase functions deploy               # Deploy all edge functions
supabase functions deploy treddy        # Deploy one app's function
supabase migration list                 # Check migration status
supabase start                          # Local stack (API:54321, DB:54322, Studio:54323)
```

## Local development

Debug builds of every app (Futura, Pretzly, Lyncil) point at the local stack,
not the shared project, so `supabase start` is the first step of any app
session that touches the backend. Migrations apply on start; if the volume
already existed, `supabase migration up` applies the new ones. Routes only
run when served: `supabase functions serve <slug> --env-file
supabase/functions/.env` (`.env` is gitignored; `supabase/functions/.env.example`
lists the keys — Lyncil's `generate-lyrics` needs `LYNCIL_APP_KEY` equal to
the app's baked key and an OpenAI key). Anonymous sign-ins are on in
`config.toml`, so Lyncil's install signs in against the local auth on first use.

## Migration rules

- One history for the whole project; never apply DDL outside `db push`.
- Name new files `<timestamp>_<app>_<desc>.sql` (`shared` counts as an app).
- Tables, indexes, and triggers go in the app's schema; only app-facing RPC
  functions go in `public`, always with `SET search_path TO '<schema>'`.
- Keep migrations idempotent where cheap (`if not exists`, `cron.schedule`
  upserts by name) — the shared project is long-lived and re-runs happen.

## DB function conventions (Futura RPC style)

- `SECURITY DEFINER` + `auth.uid()` for auth — never accept authID as a parameter
- **Always `GRANT EXECUTE ON FUNCTION ... TO authenticated`** — without it
  PostgREST won't expose the function (error PGRST202). Since
  `20261107120000` a new function starts with no grant at all (not even for
  `anon` or PUBLIC); grant only what the apps call, and only to
  `authenticated` unless it must work before sign-in. Helpers called only
  inside SECURITY DEFINER functions, and trigger functions, need no grant
- `lyncil-tracks` has no user insert or update policy: only `generate-song`
  writes tracks, with the secret key, into the verified caller's folder
- `CREATE OR REPLACE FUNCTION` only replaces on an exact signature match;
  changed params/return types create an overload — drop the old one (error 42725)
- Params `p_`, locals `v_`, return JSONB via `jsonb_build_object()`

## Operability

- `treddy.job_runs` records every cron run's outcome:
  `select * from treddy.job_runs order by finished_at desc limit 20;`
- `cron.job_run_details` shows the pg_cron side; `shared-purge-cron-history`
  keeps a week of it.
- `treddy.ai_usage`, `lyncil.ai_usage`, `affirmations.ai_usage` and
  `lingo.ai_usage` back the per-caller daily caps on /generate,
  /generate-lyrics, Affirmations' two routes and Lingo's text-to-speech
  (per user and per app).
