// Lyncil's slug in the shared project: every route lives under
//   https://<project>.supabase.co/functions/v1/lyncil/<route>
// so this Supabase project can host several apps side by side. Deploys with
// JWT verification off (config.toml): the gateway's check would accept the
// anon key too, so each route verifies the caller's user token itself (every
// install is signed in anonymously) and the app key on top.
//
// Secrets (app-prefixed so apps coexist; OPENAI_API_KEY works as a
// project-wide fallback):
//   LYNCIL_OPENAI_API_KEY, LYNCIL_OPENAI_MODEL, LYNCIL_APP_KEY,
//   LYNCIL_SONG_PROVIDER (mureka | google), LYNCIL_MUREKA_API_KEY,
//   LYNCIL_MUREKA_MODEL, LYNCIL_GEMINI_API_KEY, LYNCIL_LYRIA_MODEL,
//   LYNCIL_LYRIA_MODE (sync | background),
//   LYNCIL_ADAPTY_SECRET_KEY, LYNCIL_ADAPTY_STAGING_SECRET_KEY (song-quota.ts),
//   LYNCIL_APNS_TEAM_ID, LYNCIL_APNS_KEY_ID + LYNCIL_APNS_PRIVATE_KEY,
//   LYNCIL_APNS_SANDBOX_KEY_ID + LYNCIL_APNS_SANDBOX_PRIVATE_KEY (notify.ts)
//   LYNCIL_WEB_KEY (the music.lyncil.com Lambda), LYNCIL_SHARE_BASE_URL
//   (optional, default https://music.lyncil.com) (share.ts)

import { router } from "../_shared/router.ts";
import { handleGenerateLyrics } from "./generate-lyrics.ts";
import { handleGenerateSong, handleSongStatus } from "./generate-song.ts";
import { handleSharedSong, handleShareSong, handleUnshareSong } from "./share.ts";
import { handleSongQuota } from "./song-quota.ts";

Deno.serve(router("lyncil", {
  "generate-lyrics": { POST: handleGenerateLyrics },
  "generate-song": { POST: handleGenerateSong },
  "song-status": { POST: handleSongStatus },
  "song-quota": { POST: handleSongQuota },
  "share-song": { POST: handleShareSong },
  "unshare-song": { POST: handleUnshareSong },
  "shared-song": { GET: handleSharedSong },
}));
