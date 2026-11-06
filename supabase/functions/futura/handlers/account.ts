// delete-my-data: erases everything Futura holds about the caller — every
// capsule (sealed ones too) with its photos, voice notes and location, and
// the profile — then the auth user, unless another app on the project still
// holds something of theirs (_shared/erase-user.ts). The app signs out
// locally afterwards and starts over as a new anonymous user.
//
// Unlike the other Futura routes this one reads and deletes with the direct
// connection, for the caller the auth server vouches for: it has to reach
// sealed capsules and the storage folder as a whole, files no row points at
// included. Futura identifies nobody at Amplitude or Adapty (neither SDK is
// given the user id), so there is no third-party erasure here.

import { sql } from "../../_shared/db.ts";
import { errorResponse, jsonResponse } from "../../_shared/response.ts";
import { deleteAuthUserIfUnused, removeUserFolder, verifiedUserId } from "../../_shared/erase-user.ts";

const FN = "futura/delete-my-data";
const BUCKETS = ["capsule-photos", "capsule-voice-notes"];

export async function handleDeleteMyData(req: Request): Promise<Response> {
  const userId = await verifiedUserId(req);
  if (!userId) return errorResponse("Unauthorized", 401);

  const capsules = await sql.begin(async (tx) => {
    // Photos and voice notes cascade from their capsule.
    const deleted = await tx`delete from futura.capsules where user_id = ${userId}::uuid returning id`;
    await tx`delete from futura.profiles where auth_id = ${userId}::uuid`;
    return deleted.length;
  });

  // The folder is swept by prefix, not by row, so a retry after storage
  // refused still finds every file, and so does an upload that landed while
  // the rows were going.
  let files = 0;
  for (const bucket of BUCKETS) files += await removeUserFolder(bucket, userId);

  const account = await deleteAuthUserIfUnused(FN, userId);
  console.log(JSON.stringify({ fn: FN, event: "deleted", capsules, files, account }));
  return jsonResponse({ deleted: true });
}
