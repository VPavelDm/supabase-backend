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
// Sign in with Apple's token exchange and revocation use the team-wide
// APPLE_SIGN_IN_TEAM_ID, APPLE_SIGN_IN_KEY_ID and APPLE_SIGN_IN_PRIVATE_KEY
// (_shared/apple-sign-in.ts).
// Offers (winback.ts, delete-my-data.ts):
//   AFFIRMATIONS_ADAPTY_WEBHOOK_SECRET (Adapty's webhook Authorization header),
//   AFFIRMATIONS_ADAPTY_SECRET_KEY, AFFIRMATIONS_ADAPTY_STAGING_SECRET_KEY,
//   AFFIRMATIONS_APNS_TEAM_ID, AFFIRMATIONS_APNS_KEY_ID,
//   AFFIRMATIONS_APNS_PRIVATE_KEY, AFFIRMATIONS_APNS_SANDBOX_KEY_ID,
//   AFFIRMATIONS_APNS_SANDBOX_PRIVATE_KEY (_shared/apns.ts)
// Erasure at Amplitude (delete-my-data.ts): AFFIRMATIONS_AMPLITUDE_API_KEY,
//   AFFIRMATIONS_AMPLITUDE_SECRET_KEY, AFFIRMATIONS_AMPLITUDE_HOST (optional)

import { router } from "../_shared/router.ts";
import { handleAppleToken } from "./apple-token.ts";
import { handleDeleteMyData } from "./delete-my-data.ts";
import { handleGenerateAffirmations } from "./generate-affirmations.ts";
import { handleTextToSpeech } from "./text-to-speech.ts";
import { handleAdaptyWebhook } from "./winback.ts";

Deno.serve(router("affirmations", {
  "generate-affirmations": { POST: handleGenerateAffirmations },
  "text-to-speech": { POST: handleTextToSpeech },
  "delete-my-data": { POST: handleDeleteMyData },
  "apple-token": { POST: handleAppleToken },
  // Called by Adapty, not the app: checks its own secret (winback.ts).
  "adapty-webhook": { POST: handleAdaptyWebhook },
}));
