// The win-back push: when a Lingo app's trial or subscription ends unpaid, that
// app's Adapty projects post to `lingo/adapty-webhook/<app>` (one URL per app,
// e.g. adapty-webhook/hejka) and the learner's iPhones get "A gift for you 🎁";
// tapping it opens the win-back offer on the trail (`"offer": "winback"`,
// onboarding-ios' `OfferCenter`). Same rules as Affirmations' and Lyncil's
// winback.ts (subscription-offers skill, references/winback-pipeline.md).
//
// Called by Adapty, not the app: no user token and no app key. The
// Authorization header must equal that app's LINGO_<APP>_ADAPTY_WEBHOOK_SECRET
// — the value set in both of its Adapty projects' webhook settings. Each app
// has its own secret, so one app's URL and secret can't push into another
// app's users, and a leaked secret is rotated for one app only. Without the
// check anyone who found the URL could post made-up events and push "special
// price" alerts at any user id.
//
// `customer_user_id` is the lowercased Supabase user id the app gives Adapty
// (PremiumStore.identify on iOS). Every authorized call answers 200 (Adapty
// retries anything else); every failure degrades to "no push". One push per
// ending (lingo.winback_pushes).

import { sql } from "../_shared/db.ts";
import { type APNsClient, type Device, makeAPNs } from "../_shared/apns.ts";
import { type FCMClient, makeFCM } from "../_shared/fcm.ts";
import { json } from "../_shared/router.ts";
import { hasActiveAccess, isAuthorized, winbackEvent } from "../_shared/adapty-webhook.ts";
import { APPS, LingoApp } from "./apps.ts";
import { adaptyKeys } from "./premium.ts";

/// One APNs client per app: its bundle id is the topic, and its keys are
/// LINGO_<APP>_APNS_* (_shared/apns.ts).
const apnsClients = new Map<string, APNsClient>();

function apns(app: LingoApp): APNsClient {
  let client = apnsClients.get(app.id);
  if (!client) {
    client = makeAPNs({ topic: app.bundleID, secretPrefix: `LINGO_${app.id.toUpperCase()}` });
    apnsClients.set(app.id, client);
  }
  return client;
}

/// One FCM client per app, for its Android installs: LINGO_<APP>_FCM_SERVICE_ACCOUNT
/// (_shared/fcm.ts), the service account of the app's Firebase project.
const fcmClients = new Map<string, FCMClient>();

function fcm(app: LingoApp): FCMClient {
  let client = fcmClients.get(app.id);
  if (!client) {
    client = makeFCM({ secretPrefix: `LINGO_${app.id.toUpperCase()}` });
    fcmClients.set(app.id, client);
  }
  return client;
}

/// `adapty-webhook/<app>` for every app in apps.ts.
export function adaptyWebhookRoutes() {
  return Object.fromEntries(
    Object.values(APPS).map((app) => [
      `adapty-webhook/${app.id}`,
      { POST: (req: Request) => handleAdaptyWebhook(app, req) },
    ]),
  );
}

async function handleAdaptyWebhook(app: LingoApp, req: Request): Promise<Response> {
  const secret = Deno.env.get(`LINGO_${app.id.toUpperCase()}_ADAPTY_WEBHOOK_SECRET`);
  if (!isAuthorized(req.headers.get("authorization"), secret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const event = winbackEvent(await req.json().catch(() => null), new Date());
    if (!event) return json({ ok: true });

    // Back already (another plan, a purchase since, an upgrade's old plan
    // ending), in production or staging: TestFlight builds buy in staging and
    // both projects post here. Unknown → push anyway: the app shows nothing to
    // a subscriber.
    if (await hasActiveAccess(adaptyKeys(app, true), event.userId).catch(() => false)) {
      return json({ ok: true });
    }

    // Atomic once-per-ending gate; an id with no auth user fails the FK.
    const gate = await sql`
      insert into lingo.winback_pushes (app, user_id, lapsed_at, event_type)
      values (${app.id}, ${event.userId}, ${event.lapsedAt}, ${event.eventType})
      on conflict do nothing
      returning user_id`.catch(() => []);
    if (gate.length === 0) return json({ ok: true });

    const devices = await sql`
      select device_token, environment, locale, platform
      from lingo.devices where user_id = ${event.userId} and app = ${app.id}`;
    let sent = 0;
    for (const device of devices) {
      // Translated on the phone: iOS looks its keys up as the apps' English
      // strings (Shared/Resources/Localizable.xcstrings), Android as the
      // resource names the app's strings sync generates from them.
      const result = device.platform === "android"
        ? await fcm(app).push(
          device.device_token,
          {
            titleLocKey: "a_gift_for_you",
            bodyLocKey: "we_saved_you_a_special_price_on_premium_tap_to_open_it",
            channelId: "offers",
          },
          { offer: "winback" },
        )
        : await apns(app).push(
          device as unknown as Device,
          { "title-loc-key": "A gift for you 🎁", "loc-key": "We saved you a special price on Premium. Tap to open it." },
          { offer: "winback" },
        );
      if (result === "ok") sent++;
      if (result === "gone") {
        await sql`delete from lingo.devices where device_token = ${device.device_token}`;
      }
    }
    console.log(`winback: ${app.id} ${event.eventType} for ${event.userId}, ${sent}/${devices.length} pushed`);
    return json({ ok: true });
  } catch (error) {
    console.error("winback error:", app.id, error);
    return json({ ok: true });
  }
}
