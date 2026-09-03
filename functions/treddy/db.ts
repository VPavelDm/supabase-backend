// Treddy's slice of the shared plumbing: the direct Postgres connection (the
// `treddy` schema is not exposed through PostgREST — it holds Threads access
// tokens), the cron guard for the pg_cron-only routes, and the JSON helper.

export { sql } from "../_shared/db.ts";
export { json } from "../_shared/router.ts";
import { cronGuard } from "../_shared/cron-auth.ts";

/// The cron-only routes (publish-due, refresh-tokens) are reachable from the
/// public internet because the treddy function deploys with JWT verification
/// off. pg_cron proves itself with the Vault secret the migration generated.
export const isCronCall = cronGuard("x-treddy-cron-secret", "treddy_cron_secret");
