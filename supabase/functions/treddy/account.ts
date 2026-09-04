// Removes a Threads account from Treddy entirely: the stored token, the
// settings, every mirrored post, and the device registrations (the last
// two by cascade). Nothing publishes on the user's behalf afterwards, and
// the daily generation counters tied to the account go too.
//
// DELETE /account, bearer = the sync secret from /link. A secret the server
// doesn't know is a 401, not a silent success — the app keeps its local
// state until the server confirms, so an account can't keep autoposting
// with no device left that could stop it.

import { json, sql } from "./db.ts";
import { accountForBearer } from "./settings.ts";

export async function handleDeleteAccount(req: Request): Promise<Response> {
  const account = await accountForBearer(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const userID = account.threads_user_id;

  await sql.begin(async (tx) => {
    await tx`delete from treddy.ai_usage where caller = ${`acct:${userID}`}`;
    await tx`delete from treddy.accounts where threads_user_id = ${userID}`;
  });

  return json({ ok: true });
}
