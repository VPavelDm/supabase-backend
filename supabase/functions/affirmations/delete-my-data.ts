// delete-my-data: erases what Affirmations holds about the caller — their
// library (collections, listening sessions with their moods, favorites) and
// the daily usage counters in affirmations.ai_usage — then the auth user
// unless another app on the project still holds something of theirs
// (_shared/erase-user.ts). A user who signed in with Apple has the app's
// Apple authorization revoked first (App Store guideline 5.1.1(v)). The app
// signs out locally afterwards and starts over as a new anonymous user.
//
// The clips in affirmations-tts-cache are keyed by a hash of their text, with
// no user id. The app identifies nobody at Amplitude or Adapty (neither SDK is
// given the user id), so there is no third-party erasure here.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { deleteAuthUserIfUnused, verifiedUserId } from "../_shared/erase-user.ts";
import { appleConfig, revokeRefreshToken } from "../_shared/apple-sign-in.ts";
import { AFFIRMATIONS_APPLE_CLIENT_ID } from "./apple-token.ts";
import { isAppCall } from "./auth.ts";

const FN = "affirmations/delete-my-data";

export async function handleDeleteMyData(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await verifiedUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const id = userId.toLowerCase();
  // Before the token's row goes: a deletion retried after a failure further
  // down would otherwise find nothing to revoke.
  const apple = await revokeAppleSignIn(id);

  const [collections, sessions, favorites, counters] = await sql.begin((tx) => [
    tx`delete from affirmations.collections where user_id = ${id}::uuid returning id`,
    tx`delete from affirmations.sessions where user_id = ${id}::uuid returning id`,
    tx`delete from affirmations.favorites where user_id = ${id}::uuid returning text`,
    tx`delete from affirmations.ai_usage where caller = ${`user:${userId}`} returning day`,
    tx`delete from affirmations.apple_tokens where user_id = ${id}::uuid returning user_id`,
  ]);

  const account = await deleteAuthUserIfUnused(FN, userId);
  console.log(JSON.stringify({
    fn: FN,
    event: "deleted",
    collections: collections.length,
    sessions: sessions.length,
    favorites: favorites.length,
    counters: counters.length,
    apple,
    account,
  }));
  return json({ deleted: true });
}

/// Revokes the app's Sign in with Apple authorization when the user signed in
/// with Apple. Never throws: a failure is logged for a manual follow-up (the
/// user can also remove the app in their Apple Account settings), and the
/// deletion goes on.
async function revokeAppleSignIn(userId: string): Promise<"revoked" | "none" | "skipped" | "failed"> {
  try {
    const [row] = await sql`
      select refresh_token from affirmations.apple_tokens where user_id = ${userId}::uuid`;
    if (!row) return "none";
    const config = appleConfig(AFFIRMATIONS_APPLE_CLIENT_ID);
    if (!config) {
      console.warn(JSON.stringify({ level: "warn", fn: FN, event: "apple_revoke_skipped", reason: "not_configured" }));
      return "skipped";
    }
    await revokeRefreshToken(config, row.refresh_token as string);
    return "revoked";
  } catch (e) {
    console.error(JSON.stringify({
      level: "error",
      fn: FN,
      event: "apple_revoke_failed",
      user_id: userId,
      message: e instanceof Error ? e.message : String(e),
    }));
    return "failed";
  }
}
