// delete-my-data: erases what the Lingo apps hold about the caller — the
// daily usage counters in lingo.ai_usage, whichever app wrote them — then the
// auth user unless another app on the project still holds something of
// theirs (_shared/erase-user.ts). The app signs out locally afterwards and
// starts over as a new anonymous user.
//
// The clips in lingo-tts-cache are keyed by a hash of lesson text, with no
// user id, so there is nothing of the user's in storage.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { deleteAuthUserIfUnused, verifiedUserId } from "../_shared/erase-user.ts";
import { callerApp } from "./auth.ts";

const FN = "lingo/delete-my-data";

export async function handleDeleteMyData(req: Request): Promise<Response> {
  const app = await callerApp(req);
  if (!app) return json({ error: "Unauthorized" }, 401);
  const userId = await verifiedUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const counters = await sql`
    delete from lingo.ai_usage where caller = ${`user:${userId}`} returning day`;

  const account = await deleteAuthUserIfUnused(FN, userId);
  console.log(JSON.stringify({ fn: FN, event: "deleted", app: app.id, counters: counters.length, account }));
  return json({ deleted: true });
}
