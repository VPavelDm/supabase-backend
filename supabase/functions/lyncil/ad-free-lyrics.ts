// Lyrics without the rewarded ad. A free user's lyrics are paid for by a
// rewarded ad the app shows while they're written; when the ad can't be
// shown after a retry (no fill, failed to present), the app still asks for
// the lyrics, flagged ad-free, and this caps how many a free user gets that
// way: 2 a day (Pavel, 2026-10-19). Subscribers never watch ads and are never
// counted. The app shows the paywall, not the limit, when it's reached.
//
// The count lives in lyncil.ai_usage under its own caller key, so the daily
// cleanup cron already prunes it and no table is needed. A slot is reserved
// before the model is called and given back if the lyrics don't come, so a
// failed generation never costs one.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { callerUserId, isAppCall } from "./auth.ts";
import { hasPremium, PlanUnavailableError } from "./song-quota.ts";

export const AD_FREE_DAILY = 2;

function callerKey(userId: string): string {
  return `adfree:user:${userId}`;
}

/// Takes one of today's ad-free slots. True when it was free to take, or the
/// caller has premium (then nothing is counted). Atomic: two requests at
/// once can't both take the last slot.
export async function reserveAdFree(userId: string): Promise<{ allowed: boolean; counted: boolean }> {
  try {
    if (await hasPremium(userId)) return { allowed: true, counted: false };
  } catch (error) {
    // Adapty down: count the caller as free rather than refuse them.
    if (!(error instanceof PlanUnavailableError)) throw error;
    console.error("ad-free: plan unavailable, counting as free", error);
  }
  const rows = await sql`
    insert into lyncil.ai_usage (caller, day, count)
    values (${callerKey(userId)}, current_date, 1)
    on conflict (caller, day) do update set count = lyncil.ai_usage.count + 1
    where lyncil.ai_usage.count < ${AD_FREE_DAILY}
    returning count`;
  return rows.length > 0 ? { allowed: true, counted: true } : { allowed: false, counted: false };
}

/// Gives a reserved slot back (the lyrics didn't come).
export async function refundAdFree(userId: string): Promise<void> {
  await sql`
    update lyncil.ai_usage set count = greatest(count - 1, 0)
    where caller = ${callerKey(userId)} and day = current_date`;
}

export function adFreeLimitResponse(): Response {
  return json({ error: "ad_free_limit" }, 402);
}

/// POST ad-free-lyrics: spends a slot for lyrics the app already has, when the
/// ad failed only after the request went out. 200, or 402 ad_free_limit.
export async function handleAdFreeLyrics(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);
  const { allowed } = await reserveAdFree(userId);
  return allowed ? json({ ok: true }) : adFreeLimitResponse();
}
