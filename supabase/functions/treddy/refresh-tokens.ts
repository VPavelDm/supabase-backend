// Keeps stored Threads tokens alive. Long-lived tokens last 60 days; pg_cron
// runs this daily (job `treddy-refresh-tokens`) and refreshes any token in
// its last 30 days. A token Threads no longer accepts flags the account and
// pushes a "reconnect" prompt so autoposting doesn't die silently. Every run
// leaves a row in treddy.job_runs.

import { isCronCall, json, sql } from "./db.ts";
import { refreshToken, ThreadsAPIError } from "./threads-api.ts";
import { notifyDevices } from "./notify.ts";
import { recordJobRun } from "./jobs.ts";

export async function handleRefreshTokens(req: Request): Promise<Response> {
  if (!await isCronCall(req)) return json({ error: "Unauthorized" }, 401);
  const startedAt = new Date();

  let refreshed = 0;
  let expired = 0;
  try {
    const accounts = await sql`
      select threads_user_id, access_token
      from treddy.accounts
      where not needs_reauth
        and token_expires_at < now() + interval '30 days'`;

    for (const account of accounts) {
      try {
        const fresh = await refreshToken(account.access_token);
        await sql`
          update treddy.accounts
          set access_token = ${fresh.accessToken},
              token_expires_at = now() + make_interval(secs => ${fresh.expiresInSeconds}),
              updated_at = now()
          where threads_user_id = ${account.threads_user_id}`;
        refreshed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("token refresh failed", account.threads_user_id, message);
        if (error instanceof ThreadsAPIError && error.isAuthError) {
          await sql`
            update treddy.accounts
            set needs_reauth = true, updated_at = now()
            where threads_user_id = ${account.threads_user_id}`;
          expired += 1;
          await notifyDevices(account.threads_user_id, "reconnect", null, {
            route: "reconnect",
          });
        }
        // Any other failure (network, Threads hiccup): leave the token in
        // place — tomorrow's run tries again well before expiry.
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobRun("refresh-tokens", startedAt, refreshed, expired, message);
    throw error;
  }

  await recordJobRun("refresh-tokens", startedAt, refreshed, expired);
  return json({ refreshed, expired });
}
