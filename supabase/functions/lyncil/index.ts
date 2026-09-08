// Lyncil's slug in the shared project: every route lives under
//   https://<project>.supabase.co/functions/v1/lyncil/<route>
// so this Supabase project can host several apps side by side. Deploys with
// JWT verification off (config.toml): the gateway's check would accept the
// anon key too, so each route verifies the caller's user token itself (every
// install is signed in anonymously) and the app key on top.
//
// Secrets (app-prefixed so apps coexist; OPENAI_API_KEY works as a
// project-wide fallback):
//   LYNCIL_OPENAI_API_KEY, LYNCIL_OPENAI_MODEL, LYNCIL_APP_KEY

import { router } from "../_shared/router.ts";
import { handleGenerateLyrics } from "./generate-lyrics.ts";

Deno.serve(router("lyncil", {
  "generate-lyrics": { POST: handleGenerateLyrics },
}));
