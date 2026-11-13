// The win-back push: when an Affirmations trial or subscription ends unpaid,
// Adapty posts here and the user's iPhones get "A gift from Here 🎁"; tapping
// it opens the win-back offer in the app (`"offer": "winback"`,
// onboarding-ios' `OfferCenter`). Same rules as Lyncil's winback.ts
// (subscription-offers skill, references/winback-pipeline.md).
//
// Called by Adapty, not the app: no user token and no app key. The
// Authorization header must equal AFFIRMATIONS_ADAPTY_WEBHOOK_SECRET — the
// value set in both Affirmations Adapty projects' webhook settings. Without
// the check anyone who found the URL could post made-up events and push
// "special price" alerts at any user id.
//
// `customer_user_id` is the lowercased Supabase user id the app gives Adapty
// (UserIdentity on iOS). Every authorized call answers 200 (Adapty retries
// anything else); every failure degrades to "no push". One push per ending
// (affirmations.winback_pushes).

import { sql } from "../_shared/db.ts";
import { type Device, makeAPNs } from "../_shared/apns.ts";
import { json } from "../_shared/router.ts";
import { hasActiveAccess, isAuthorized, winbackEvent } from "../_shared/adapty-webhook.ts";

const apns = makeAPNs({ topic: "com.affirmations.sound", secretPrefix: "AFFIRMATIONS" });

/// Production and staging: TestFlight builds buy in the staging project, and
/// both projects post here.
function adaptyKeys(): string[] {
  return [
    Deno.env.get("AFFIRMATIONS_ADAPTY_SECRET_KEY"),
    Deno.env.get("AFFIRMATIONS_ADAPTY_STAGING_SECRET_KEY"),
  ].filter((key): key is string => !!key);
}

export async function handleAdaptyWebhook(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers.get("authorization"), Deno.env.get("AFFIRMATIONS_ADAPTY_WEBHOOK_SECRET"))) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const event = winbackEvent(await req.json().catch(() => null), new Date());
    if (!event) return json({ ok: true });

    // Back already (another plan, a purchase since, an upgrade's old plan
    // ending). Unknown → push anyway: the app shows nothing to a subscriber.
    if (await hasActiveAccess(adaptyKeys(), event.userId).catch(() => false)) return json({ ok: true });

    // Atomic once-per-ending gate; an id with no auth user fails the FK.
    const gate = await sql`
      insert into affirmations.winback_pushes (user_id, lapsed_at, event_type)
      values (${event.userId}, ${event.lapsedAt}, ${event.eventType})
      on conflict do nothing
      returning user_id`.catch(() => []);
    if (gate.length === 0) return json({ ok: true });

    const devices = await sql`
      select device_token, environment, locale
      from affirmations.devices where user_id = ${event.userId}`;
    let sent = 0;
    for (const device of devices) {
      // Keys are the app's English strings, translated on the phone.
      const result = await apns.push(
        device as unknown as Device,
        { "title-loc-key": "A gift from Here 🎁", "loc-key": "We saved you a special price on Here. Tap to open it." },
        { offer: "winback" },
      );
      if (result === "ok") sent++;
      if (result === "gone") {
        await sql`delete from affirmations.devices where device_token = ${device.device_token}`;
      }
    }
    console.log(`winback: ${event.eventType} for ${event.userId}, ${sent}/${devices.length} pushed`);
    return json({ ok: true });
  } catch (error) {
    console.error("winback error:", error);
    return json({ ok: true });
  }
}
