// Pushes to the account's registered devices, in the app's UI language.
// Deletes device rows APNs reports as gone.

import { sql } from "./db.ts";
import { type Device, makeAPNs } from "../_shared/apns.ts";

const apns = makeAPNs({ topic: "com.treddy.app", secretPrefix: "TREDDY" });

/// Minimal push copy in the languages the app ships; the device row carries
/// the app's UI locale.
export function localized(
  locale: string,
  key: "posted" | "failed" | "reconnect",
): { title: string; body?: string } {
  const russian = locale.toLowerCase().startsWith("ru");
  switch (key) {
    case "posted":
      return { title: russian ? "Опубликовано в Threads" : "Posted to Threads" };
    case "failed":
      return {
        title: russian ? "Пост не опубликован" : "Post failed",
        body: russian
          ? "Откройте Treddy, чтобы попробовать ещё раз."
          : "Open Treddy to try again.",
      };
    case "reconnect":
      return {
        title: russian ? "Переподключите Threads" : "Reconnect Threads",
        body: russian
          ? "Сессия Threads истекла — войдите снова, чтобы посты публиковались."
          : "Your Threads session expired — sign in again so posts keep going out.",
      };
  }
}

export async function notifyDevices(
  threadsUserID: string,
  kind: "posted" | "failed" | "reconnect",
  body: string | null,
  extra: Record<string, string> = {},
): Promise<void> {
  const devices = await sql`
    select device_token, environment, locale
    from treddy.devices where threads_user_id = ${threadsUserID}`;
  for (const device of devices) {
    const alert = localized(device.locale, kind);
    const result = await apns.push(
      device as unknown as Device,
      { title: alert.title, body: (body ?? alert.body ?? "").slice(0, 150) },
      extra,
    );
    if (result === "gone") {
      await sql`
        delete from treddy.devices
        where device_token = ${device.device_token}`;
    }
  }
}
