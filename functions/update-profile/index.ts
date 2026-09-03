// Legacy entry point kept for app versions released before the `futura`
// router existed — same handler, same behavior. Delete this function once
// the force update lands.

import { serve } from "../_shared/router.ts";
import { handleUpdateProfile } from "../futura/handlers/profiles.ts";

Deno.serve(serve({ POST: handleUpdateProfile }));
