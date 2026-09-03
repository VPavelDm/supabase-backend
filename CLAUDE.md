# CLAUDE.md — shared Supabase backend

This repo (github: VPavelDm/supabase-backend, local:
~/Developer/supabase-backend, formerly FuturaBE inside the futura folder) is
the single source of truth for the shared Supabase project
`ttjzshiaatqvszckjlhw` (org name "Futura"), which hosts several apps on one
plan. It owns the migration history, every edge function, and the shared
utilities. App repos (Treddy, Futura iOS) contain no backend code — they
point here.

Layout: everything lives under `supabase/` — the CLI's canonical layout. It
looks for `supabase/config.toml` below the working directory, so run
commands from the repo root; files at the root itself are invisible to it.

## Conventions — everything an app owns is namespaced

| Piece            | Convention                      | Treddy                          | Futura |
|------------------|---------------------------------|---------------------------------|--------|
| Edge function    | one slug per app, routes inside | `treddy/<route>`                | `futura/<route>` (+ legacy single-route functions until the force update) |
| Postgres schema  | one schema per app              | `treddy`                        | `futura` |
| Migrations       | `<timestamp>_<app>_<desc>.sql`  | `*_treddy_*.sql`                | historic names vary |
| Cron jobs        | `<app>-` prefix                 | `treddy-publish-due` (every minute), `treddy-refresh-tokens` (daily), `treddy-cleanup` (daily) | — |
| Vault secrets    | `<app>_` prefix                 | `treddy_cron_secret`            | — |
| Function secrets | `<APP>_` prefix                 | `TREDDY_*` (see functions/treddy/index.ts) | — |

Cross-app pieces live under `shared`: the `shared` Postgres schema
(`shared.set_updated_at`), the `shared-` cron prefix
(`shared-purge-cron-history`), and `functions/_shared/` (router, direct-db
client, cron auth, APNs client, CORS/response helpers, supabase-js client).
`OPENAI_API_KEY` without a prefix is the project-wide fallback key.

## Architecture per app

**Treddy** (`treddy` schema: accounts, posts, devices, job_runs, ai_usage):
the schema is NOT exposed through PostgREST — it holds Threads tokens. Routes
use the direct Postgres connection (`SUPABASE_DB_URL`, `_shared/db.ts`) and
carry their own auth: `link` proves ownership with the Threads token and
issues a sync secret; `sync`/`settings`/`generate` take the sync secret as
bearer; `generate` pre-link (onboarding) takes the `x-treddy-app-key` header
instead; `publish-due`/`refresh-tokens` take pg_cron's Vault secret;
`threads-oauth` is Meta's OAuth redirect target. Generation prompts, model,
and caps are server-side; the app sends only per-action input, and the user's
brief + writing samples live in `accounts.settings`.

**Futura** (`futura` schema: capsules, capsule_photos, capsule_voice_notes,
profiles): routes are thin pass-throughs to `public` RPCs whose bodies
resolve tables via `SET search_path TO 'futura'`; auth is the caller's JWT
riding into PostgREST, enforced by `auth.uid()` + RLS. Storage: private
buckets `capsule-photos` / `capsule-voice-notes`, files scoped to
`{user_id}/{capsule_id}/{uuid}.{ext}`, signed URLs from `get-capsules`.
The legacy single-route functions are wrappers around
`functions/futura/handlers/` — delete them (and their config.toml entries)
after the app's force update.

## Commands

Run from the repo root.

```bash
supabase db push                        # Apply new migrations to remote
supabase functions deploy               # Deploy all edge functions
supabase functions deploy treddy        # Deploy one app's function
supabase migration list                 # Check migration status
supabase start                          # Local stack (API:54321, DB:54322, Studio:54323)
```

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
  PostgREST won't expose the function (error PGRST202)
- `CREATE OR REPLACE FUNCTION` only replaces on an exact signature match;
  changed params/return types create an overload — drop the old one (error 42725)
- Params `p_`, locals `v_`, return JSONB via `jsonb_build_object()`

## Operability

- `treddy.job_runs` records every cron run's outcome:
  `select * from treddy.job_runs order by finished_at desc limit 20;`
- `cron.job_run_details` shows the pg_cron side; `shared-purge-cron-history`
  keeps a week of it.
- `treddy.ai_usage` backs /generate's per-caller daily cap.
