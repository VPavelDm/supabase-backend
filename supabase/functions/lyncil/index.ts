// Lyncil's slug in the shared project: every route lives under
//   https://<project>.supabase.co/functions/v1/lyncil/<route>
// so this Supabase project can host several apps side by side. Deploys with
// JWT verification off (config.toml) — Lyncil has no Supabase auth at all,
// so each route carries its own auth (the app key).
//
// Secrets (app-prefixed so apps coexist; OPENAI_API_KEY works as a
// project-wide fallback):
//   LYNCIL_OPENAI_API_KEY, LYNCIL_OPENAI_MODEL, LYNCIL_APP_KEY

import { router } from "../_shared/router.ts";
import { handleGenerateLyrics } from "./generate-lyrics.ts";

Deno.serve(router("lyncil", {
  "generate-lyrics": { POST: handleGenerateLyrics },
}));
