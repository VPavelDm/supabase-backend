// The pure half of an app's Adapty win-back webhook (subscription-offers
// skill, references/winback-pipeline.md): which posts are a fresh ending
// worth a push, and the secret check in front of them. Lyncil
// (functions/lyncil/winback.ts), Affirmations (functions/affirmations/winback.ts)
// and the Lingo apps (functions/lingo/winback.ts) use it; Calyo's webhook
// lives in its own Supabase project with the same rules. A change here reaches every app's webhook at its next deploy.

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
/// (the empty verification request, other events — billing issues, grace
/// periods and refunds on purpose —, unknown ids, stale endings).
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

/// Whether Adapty has an active `levelID` access level for the user in any
/// of the given projects (production and staging keys). Throws when Adapty
/// can't be asked; a project that doesn't know the user is skipped.
export async function hasActiveAccess(keys: string[], userId: string, levelID = "premium", now = new Date()): Promise<boolean> {
  for (const key of keys) {
    const res = await fetch("https://api.adapty.io/api/v2/server-side-api/profile/", {
      headers: { Authorization: `Api-Key ${key}`, "adapty-customer-user-id": userId },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Adapty profile returned ${res.status}`);
    const body = await res.json().catch(() => null);
    const levels: { access_level_id: string; expires_at?: string | null }[] = body?.data?.access_levels ?? [];
    if (levels.some((level) => level.access_level_id === levelID && (!level.expires_at || new Date(level.expires_at) > now))) {
      return true;
    }
  }
  return false;
}
