// "Your song is ready" to every device of the song's owner. The text is the
// app's own string (loc keys are the English text, so a build without the
// translation still shows English); the app decides on the phone whether to
// show it while it is open. Deletes device rows APNs reports as gone.

import { sql } from "../_shared/db.ts";
import { type Device, makeAPNs } from "../_shared/apns.ts";

const apns = makeAPNs({ topic: "com.vaitsikhouskaya.ala.lyncil", secretPrefix: "LYNCIL" });

export async function notifySongReady(userId: string, songId: string | null): Promise<void> {
  const devices = await sql`
    select device_token, environment, locale
    from lyncil.devices where user_id = ${userId}`;
  for (const device of devices) {
    const result = await apns.push(
      device as unknown as Device,
      { "title-loc-key": "Your song is ready 🎶", "loc-key": "Tap to listen" },
      { push_id: "song_ready", ...(songId ? { song_id: songId } : {}) },
    );
    if (result === "gone") {
      await sql`delete from lyncil.devices where device_token = ${device.device_token}`;
    }
  }
}
