// The win-back push: when a Lyncil trial or subscription ends unpaid, Adapty
// posts here and the user's iPhones get "A gift from Lyncil 🎁"; tapping it
// opens the win-back offer in the app (`"offer": "winback"`, onboarding-ios'
// `OfferCenter`). Same rules as Calyo's adapty-webhook (subscription-offers
// skill, references/winback-pipeline.md).
//
// Called by Adapty, not the app: no user token and no app key. The
// Authorization header must equal LYNCIL_ADAPTY_WEBHOOK_SECRET — the value set
// in both Lyncil Adapty projects' webhook settings. Without the check anyone
// who found the URL could post made-up events and push "special price" alerts
// at any user id.
//
// Every authorized call answers 200 (Adapty retries anything else); every
// failure degrades to "no push". One push per ending (lyncil.winback_pushes).
// Which posts count as a fresh ending, and the secret check, are the shared
// rules in _shared/adapty-webhook.ts (Affirmations uses them too).

import { sql } from "../_shared/db.ts";
import { type Device, makeAPNs } from "../_shared/apns.ts";
import { json } from "../_shared/router.ts";
import { isAuthorized, winbackEvent } from "../_shared/adapty-webhook.ts";
import { hasPremium } from "./song-quota.ts";

const apns = makeAPNs({ topic: "com.vaitsikhouskaya.ala.lyncil", secretPrefix: "LYNCIL" });

export async function handleAdaptyWebhook(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers.get("authorization"), Deno.env.get("LYNCIL_ADAPTY_WEBHOOK_SECRET"))) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const event = winbackEvent(await req.json().catch(() => null), new Date());
    if (!event) return json({ ok: true });

    // Back already (another plan, a purchase since). Both Adapty projects:
    // sandbox endings (TestFlight) post here too. Unknown → push anyway.
    if (await hasPremium(event.userId, true).catch(() => false)) return json({ ok: true });

    // Atomic once-per-ending gate; an id with no profile fails the FK.
    const gate = await sql`
      insert into lyncil.winback_pushes (user_id, lapsed_at, event_type)
      values (${event.userId}, ${event.lapsedAt}, ${event.eventType})
      on conflict do nothing
      returning user_id`.catch(() => []);
    if (gate.length === 0) return json({ ok: true });

    const devices = await sql`
      select device_token, environment, locale
      from lyncil.devices where user_id = ${event.userId}`;
    let sent = 0;
    for (const device of devices) {
      // Keys are the app's English strings, translated on the phone.
      const result = await apns.push(
        device as unknown as Device,
        { "title-loc-key": "A gift from Lyncil 🎁", "loc-key": "We saved you a special price on Lyncil. Tap to open it." },
        { offer: "winback" },
      );
      if (result === "ok") sent++;
      if (result === "gone") {
        await sql`delete from lyncil.devices where device_token = ${device.device_token}`;
      }
    }
    console.log(`winback: ${event.eventType} for ${event.userId}, ${sent}/${devices.length} pushed`);
    return json({ ok: true });
  } catch (error) {
    console.error("winback error:", error);
    return json({ ok: true });
  }
}
