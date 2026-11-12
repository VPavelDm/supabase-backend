// Lingo: the slug the language-learning apps share (Hutarka, Hejka, and the
// ones after — see apps.ts). Every route lives under
//   https://<project>.supabase.co/functions/v1/lingo/<route>
// Deploys with JWT verification off (config.toml): the gateway's check would
// accept the publishable key too, so each route verifies the caller's user
// token itself (every install is signed in anonymously) and an app key on
// top, which also says which app is calling.
//
// Secrets (ELEVENLABS_API_KEY works as a project-wide fallback):
//   LINGO_HUTARKA_APP_KEY, LINGO_HEJKA_APP_KEY, LINGO_ELEVENLABS_API_KEY,
//   LINGO_<APP>_ADAPTY_SECRET_KEY, LINGO_<APP>_ADAPTY_STAGING_SECRET_KEY (premium.ts)

import { router } from "../_shared/router.ts";
import { handleContent } from "./content.ts";
import { handleDeleteMyData } from "./delete-my-data.ts";
import { handleTextToSpeech } from "./text-to-speech.ts";

Deno.serve(router("lingo", {
  "content": { POST: handleContent },
  "text-to-speech": { POST: handleTextToSpeech },
  "delete-my-data": { POST: handleDeleteMyData },
}));
