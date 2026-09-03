// Legacy entry point kept for app versions released before the `futura`
// router existed — same handler, same behavior. Delete this function once
// the force update lands.

import { serve } from "../_shared/router.ts";
import { handleGetCapsules } from "../futura/handlers/capsules.ts";

Deno.serve(serve({ POST: handleGetCapsules }));
