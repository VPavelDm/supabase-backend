// Futura's slug in the shared project: every route lives under
//   https://<project>.supabase.co/functions/v1/futura/<route>
// mirroring Treddy's one-function-per-app pattern. The legacy single-route
// functions (get-capsules, create-capsule, …) wrap the same handlers and
// stay deployed until old app versions are force-updated away.

import { router } from "../_shared/router.ts";
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
}));
