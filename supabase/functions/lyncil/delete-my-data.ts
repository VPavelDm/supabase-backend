// delete-my-data: erases everything Lyncil holds about the caller, then the
// auth user unless another app on the project still holds something of
// theirs (_shared/erase-user.ts). The app signs out locally afterwards and
// starts over as a new anonymous user.
//
// Here: the profile, and through it every song, song job, feedback, device
// token, song grant, win-back push and share link (all cascade from
// lyncil.profiles); the daily counters in lyncil.ai_usage; the tracks under
// lyncil-tracks/<user id>/. A shared link's page answers 404 as soon as the
// rows are gone; CloudFront may serve its cached copy for up to an hour
// (web/share/src/app.mjs). Mureka's copies of a track sit on Mureka's CDN,
// which nothing here can delete; their URLs die after 30 days.
//
// Elsewhere: iOS and Android identify the user by this id at Amplitude and
// (iOS) Adapty, so both are asked to forget it. Google Analytics also has it
// as its user id (iOS); it is not erased here.
//
// Secrets, each service skipped with a warning while unset:
//   LYNCIL_ADAPTY_SECRET_KEY, LYNCIL_ADAPTY_STAGING_SECRET_KEY (already set
//     for song-quota.ts)
//   LYNCIL_AMPLITUDE_API_KEY, LYNCIL_AMPLITUDE_SECRET_KEY: Lyncil's
//     Amplitude project (the one App Store builds send to)
//   LYNCIL_AMPLITUDE_HOST: optional, https://analytics.eu.amplitude.com for an
//     EU project

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import {
  deleteAuthUserIfUnused,
  eraseAt,
  eraseFromAdapty,
  eraseFromAmplitude,
  removeUserFolder,
  verifiedUserId,
} from "../_shared/erase-user.ts";
import { isAppCall } from "./auth.ts";

const FN = "lyncil/delete-my-data";

export async function handleDeleteMyData(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await verifiedUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const songs = await sql.begin(async (tx) => {
    const [row] = await tx`select count(*)::int as songs from lyncil.songs where user_id = ${userId}::uuid`;
    await tx`delete from lyncil.profiles where id = ${userId}::uuid`;
    await tx`delete from lyncil.ai_usage where caller in (${`user:${userId}`}, ${`adfree:user:${userId}`})`;
    return row.songs as number;
  });

  // The folder is swept by prefix, not by row, so a retry after storage
  // refused still finds every track, and so does one a running job stored
  // while the rows were going.
  const files = await removeUserFolder("lyncil-tracks", userId);

  const env = (name: string) => Deno.env.get(name);
  const [account, adapty, adaptyStaging, amplitude] = await Promise.all([
    deleteAuthUserIfUnused(FN, userId),
    eraseAt(FN, "adapty", userId, () => eraseFromAdapty(env("LYNCIL_ADAPTY_SECRET_KEY"), userId)),
    eraseAt(FN, "adapty-staging", userId, () => eraseFromAdapty(env("LYNCIL_ADAPTY_STAGING_SECRET_KEY"), userId)),
    eraseAt(FN, "amplitude", userId, () =>
      eraseFromAmplitude({
        apiKey: env("LYNCIL_AMPLITUDE_API_KEY"),
        secretKey: env("LYNCIL_AMPLITUDE_SECRET_KEY"),
        host: env("LYNCIL_AMPLITUDE_HOST"),
      }, userId, "lyncil delete-my-data")),
  ]);

  console.log(JSON.stringify({ fn: FN, event: "deleted", songs, files, account, adapty, adaptyStaging, amplitude }));
  return json({ deleted: true });
}
