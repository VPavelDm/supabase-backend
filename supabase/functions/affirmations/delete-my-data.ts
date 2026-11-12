// delete-my-data: erases what Affirmations holds about the caller — their
// library (collections, listening sessions with their moods, favorites) and
// the daily usage counters in affirmations.ai_usage — then the auth user
// unless another app on the project still holds something of theirs
// (_shared/erase-user.ts). The app signs out locally afterwards and starts
// over as a new anonymous user.
//
// The clips in affirmations-tts-cache are keyed by a hash of their text, with
// no user id. The app identifies nobody at Amplitude or Adapty (neither SDK is
// given the user id), so there is no third-party erasure here.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { deleteAuthUserIfUnused, verifiedUserId } from "../_shared/erase-user.ts";
import { isAppCall } from "./auth.ts";

const FN = "affirmations/delete-my-data";

export async function handleDeleteMyData(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await verifiedUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const id = userId.toLowerCase();
  const [collections, sessions, favorites, counters] = await sql.begin((tx) => [
    tx`delete from affirmations.collections where user_id = ${id}::uuid returning id`,
    tx`delete from affirmations.sessions where user_id = ${id}::uuid returning id`,
    tx`delete from affirmations.favorites where user_id = ${id}::uuid returning text`,
    tx`delete from affirmations.ai_usage where caller = ${`user:${userId}`} returning day`,
  ]);

  const account = await deleteAuthUserIfUnused(FN, userId);
  console.log(JSON.stringify({
    fn: FN,
    event: "deleted",
    collections: collections.length,
    sessions: sessions.length,
    favorites: favorites.length,
    counters: counters.length,
    account,
  }));
  return json({ deleted: true });
}
