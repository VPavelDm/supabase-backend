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

import { sql } from "../_shared/db.ts";
import { type Device, makeAPNs } from "../_shared/apns.ts";
import { json } from "../_shared/router.ts";
import { hasPremium } from "./song-quota.ts";

const apns = makeAPNs({ topic: "com.vaitsikhouskaya.ala.lyncil", secretPrefix: "LYNCIL" });

const WINBACK_EVENTS = new Set(["trial_expired", "subscription_expired"]);
/// An older ending sends nothing: a dashboard resend of old events must not
/// push everyone who ever lapsed.
const FRESH_MS = 3 * 24 * 3600 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WinbackEvent {
  userId: string;
  lapsedAt: string;
  eventType: string;
}

/// The win-back event in an Adapty webhook body, or null for anything else
/// (the empty verification request, other events, unknown ids, stale ones).
export function winbackEvent(body: unknown, now: Date): WinbackEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const event = body as {
    event_type?: unknown;
    customer_user_id?: unknown;
    event_datetime?: unknown;
    event_properties?: { expires_at?: unknown } | null;
  };
  if (typeof event.event_type !== "string" || !WINBACK_EVENTS.has(event.event_type)) return null;
  if (typeof event.customer_user_id !== "string" || !UUID_RE.test(event.customer_user_id)) return null;
  const raw = event.event_properties?.expires_at ?? event.event_datetime;
  if (typeof raw !== "string") return null;
  const lapsedAt = new Date(raw);
  if (Number.isNaN(lapsedAt.getTime()) || now.getTime() - lapsedAt.getTime() > FRESH_MS) return null;
  return { userId: event.customer_user_id.toLowerCase(), lapsedAt: lapsedAt.toISOString(), eventType: event.event_type };
}

/// Constant-time comparison against the configured secret; none configured
/// accepts nothing.
export function isAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const a = new TextEncoder().encode(header);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

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
