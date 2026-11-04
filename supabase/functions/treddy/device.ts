// Registers this phone for an account's pushes without syncing its posts.
// The app calls it at launch for every account signed in on the phone, so
// the accounts it isn't working as right now still reach it.
//
// Request (bearer = the account's sync secret from /link):
//   { device_token, environment?, locale? }
// Response: { ok: true }

import { json } from "./db.ts";
import { accountForBearer } from "./settings.ts";
import { upsertDevice } from "./sync.ts";

export async function handleDevice(req: Request): Promise<Response> {
  const account = await accountForBearer(req);
  if (!account) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (typeof body?.device_token !== "string" || body.device_token.length === 0) {
    return json({ error: "device_token is required" }, 400);
  }
  await upsertDevice(account.threads_user_id, body);
  return json({ ok: true });
}
