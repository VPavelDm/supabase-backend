// Affirmations' slug in the shared project: every route lives under
//   https://<project>.supabase.co/functions/v1/affirmations/<route>
// Deploys with JWT verification off (config.toml): the gateway's check would
// accept the anon key too, so each route verifies the caller's user token
// itself (every install is signed in anonymously) and the app key on top.
//
// Secrets (app-prefixed so apps coexist; OPENAI_API_KEY and
// ELEVENLABS_API_KEY work as project-wide fallbacks):
//   AFFIRMATIONS_APP_KEY, AFFIRMATIONS_OPENAI_API_KEY,
//   AFFIRMATIONS_OPENAI_MODEL (optional), AFFIRMATIONS_ELEVENLABS_API_KEY

import { router } from "../_shared/router.ts";
import { handleGenerateAffirmations } from "./generate-affirmations.ts";
import { handleTextToSpeech } from "./text-to-speech.ts";

Deno.serve(router("affirmations", {
  "generate-affirmations": { POST: handleGenerateAffirmations },
  "text-to-speech": { POST: handleTextToSpeech },
}));
