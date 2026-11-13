// Futura's slug in the shared project: every route lives under
//   https://<project>.supabase.co/functions/v1/futura/<route>
// mirroring Treddy's one-function-per-app pattern. The legacy single-route
// functions (get-capsules, create-capsule, …) wrap the same handlers and
// stay deployed until old app versions are force-updated away.
//
// Secrets: FUTURA_APPLE_SIGN_IN_TEAM_ID, FUTURA_APPLE_SIGN_IN_KEY_ID,
// FUTURA_APPLE_SIGN_IN_PRIVATE_KEY (Sign in with Apple's token exchange and
// revocation: handlers/apple-token.ts, handlers/account.ts,
// _shared/apple-sign-in.ts).

import { router } from "../_shared/router.ts";
import { handleDeleteMyData } from "./handlers/account.ts";
import { handleAppleToken } from "./handlers/apple-token.ts";
import {
  handleAddCapsuleMedia,
  handleCreateCapsule,
  handleDeleteCapsule,
  handleGetCapsules,
  handleOpenCapsule,
} from "./handlers/capsules.ts";
import {
  handleCreateProfileIfNeeded,
  handleGetProfile,
  handleUpdateProfile,
} from "./handlers/profiles.ts";

Deno.serve(router("futura", {
  "get-capsules": { POST: handleGetCapsules },
  "create-capsule": { POST: handleCreateCapsule },
  "delete-capsule": { POST: handleDeleteCapsule },
  "add-capsule-media": { POST: handleAddCapsuleMedia },
  "open-capsule": { POST: handleOpenCapsule },
  "get-profile": { POST: handleGetProfile },
  "update-profile": { POST: handleUpdateProfile },
  "create-profile-if-needed": { POST: handleCreateProfileIfNeeded },
  "delete-my-data": { POST: handleDeleteMyData },
  "apple-token": { POST: handleAppleToken },
}));
