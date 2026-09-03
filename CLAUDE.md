# CLAUDE.md — Supabase Backend

## Shared project

This Supabase project (`ttjzshiaatqvszckjlhw`) hosts several apps. Futura's
tables live in the `futura` schema (moved 2026-09-03); the `public` RPC
functions are the shipped app's API and stay in `public` with their bodies
resolving tables via `SET search_path TO 'futura'`. Other apps follow the
same pattern (e.g. Treddy: `treddy` schema, `treddy/<route>` edge function,
`treddy-*` cron jobs, `TREDDY_*` secrets). This repo owns the project's
migration history — other apps apply their idempotent DDL outside
`supabase db push`.

When writing new DB code here: tables, indexes, and triggers go in `futura`;
only the app-facing RPC functions go in `public`, always with
`SET search_path TO 'futura'`.

## Structure

```
supabase/
├── migrations/     — Postgres migrations (timestamped SQL files)
├── functions/      — Deno edge functions (one folder per function)
│   └── _shared/   — Shared utilities (cors, response, supabase-client)
├── config.toml     — Supabase project config
└── seed.sql        — Seed data (if needed)
```

## Common Commands

All commands must be run from the `supabase/` directory.

```bash
supabase start                          # Start local (API:54321, DB:54322, Studio:54323)
supabase db push                        # Apply migrations to remote
supabase functions deploy               # Deploy all edge functions
supabase functions deploy function-name # Deploy a single edge function
supabase migration list                 # Check migration status
supabase migration repair --status reverted MIGRATION_VERSION  # Revert failed migration
```

## DB Function Conventions

- Use `SECURITY DEFINER` and `auth.uid()` for auth — never accept authID as a parameter
- **Always add `GRANT EXECUTE ON FUNCTION ... TO authenticated`** when creating new functions — without this, PostgREST won't expose them (error PGRST202)
- `CREATE OR REPLACE FUNCTION` only replaces when the full signature (params + return type) matches. Adding parameters or changing return types creates a **new overload**. Drop the old one explicitly to avoid error 42725 ("function is not unique")
- Parameters use `p_` prefix (e.g., `p_capsule_id`, `p_storage_path`)
- Local variables use `v_` prefix (e.g., `v_auth_id`, `v_capsule_id`)
- Return JSONB via `jsonb_build_object()`

## Edge Function Template

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { jsonResponse, errorResponse, corsResponse, methodNotAllowedResponse } from "../_shared/response.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return methodNotAllowedResponse();
  try {
    const supabase = createSupabaseClient(req);
    const params = await req.json();
    const { data, error } = await supabase.rpc("function_name", params);
    if (error) {
      console.error("function-name RPC failed:", error);
      return errorResponse("Internal server error", 500);
    }
    return jsonResponse(data);
  } catch (e) {
    console.error("function-name unexpected error:", e);
    return errorResponse("Internal server error", 500);
  }
});
```

## Auth Model

- Edge functions receive the user's JWT via `Authorization` header
- `createSupabaseClient(req)` creates a client scoped to that user
- DB functions use `auth.uid()` to get the current user — no authID is passed from the client
- RLS policies enforce row-level access; `SECURITY DEFINER` functions bypass RLS when needed

## Storage

- Two private buckets: `capsule-photos` and `capsule-voice-notes`
- Files are scoped to `{user_id}/{capsule_id}/{uuid}.{ext}`
- Storage policies restrict access to the user's own folder
- `upload-media` edge function handles file upload + metadata registration via RPC
- `get-capsules` generates signed URLs (1h expiry) for photos and voice notes
- `delete-capsule` cleans up storage files after DB cascade delete
