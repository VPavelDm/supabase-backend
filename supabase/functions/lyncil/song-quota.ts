// How many songs a caller may still make. Songs cost real money per track,
// so the allowance follows the plan the caller pays for; lyrics stay
// unlimited and never come through here.
//
//   no plan   1 song in any 7 days
//   legacy    1 song in any 7 days: a subscription bought before songs were
//             sold (lyrics only). Upgrading to a songs plan, in the same
//             App Store group, lifts it.
//   weekly   20 songs per billing week
//   monthly  30 songs per billing month
//   annual   30 songs per month, months counted from the purchase
//
// The plan comes from Adapty's server-side API, looked up by customer user id:
// the app identifies every install with its Supabase user id (anonymous
// sign-in), and the id here is the one in the caller's token, so a caller
// can't borrow someone else's plan. Simulator and TestFlight builds use the
// staging Adapty app while App Store builds use production, and all of them
// call this backend, so both apps are asked, production first.
//
// Every started song counts except the ones that failed, including songs
// deleted since: deleting doesn't hand the allowance back.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { callerUserId, isAppCall } from "./auth.ts";

export type Plan = "free" | "legacy" | "weekly" | "monthly" | "annual";

export interface SongQuota {
  plan: Plan;
  limit: number;
  used: number;
  /// When the count starts over: the end of the billing window on a plan;
  /// with no plan, when the next song frees up (null while there is room,
  /// since the week slides).
  resetsAt: string | null;
}

const LIMITS: Record<Plan, number> = { free: 1, legacy: 1, weekly: 20, monthly: 30, annual: 30 };
const FREE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/// Every Lyncil subscription in App Store Connect before songs were sold
/// (2026-09-30). They keep lyrics and lose nothing, but songs come with the
/// new plans. The songs plans aren't listed yet, so any other id counts as a
/// songs plan, its cadence read from the dates; add them here once they exist,
/// since sandbox renewals run minutes rather than weeks.
const LEGACY_PRODUCTS = new Set([
  "com.vaitsikhouskaya.ala.lyncil.subscription.plan.standard",
  "com.vaitsikhouskaya.ala.lyncil.subscription.plan.premium",
  "com.vaitsikhouskaya.ala.lyncil.subscription.plan.pro",
  "com.lyncil.subscription.plan.pro.max",
  "lyncil_weekly_3_99",
  "lyncil_monthly_8_99",
  "lyncil_monthly_9_99",
  "lyncil_yearly_no_trial_29_99",
  "lyncil_yearly_no_trial_39_99",
  "lyncil_yearly_no_trial_49_99",
]);

/// The songs plans by product id, once they exist.
const SONG_PLANS: Record<string, "weekly" | "monthly" | "annual"> = {};

export class PlanUnavailableError extends Error {}

interface AccessLevel {
  access_level_id: string;
  store_product_id?: string;
  purchased_at?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  offer?: { type?: string | null } | null;
}

function adaptyKeys(): string[] {
  return [
    Deno.env.get("LYNCIL_ADAPTY_SECRET_KEY"),
    Deno.env.get("LYNCIL_ADAPTY_STAGING_SECRET_KEY"),
  ].filter((key): key is string => !!key);
}

/// The caller's active premium access, or null when they have none. A
/// profile missing from one Adapty app is normal (it lives in the other).
async function premiumAccess(userId: string, now: Date): Promise<AccessLevel | null> {
  const keys = adaptyKeys();
  if (keys.length === 0) console.error("No Adapty secret key set; every caller counts as free");
  for (const key of keys) {
    let res: Response;
    try {
      res = await fetch("https://api.adapty.io/api/v2/server-side-api/profile/", {
        headers: { Authorization: `Api-Key ${key}`, "adapty-customer-user-id": userId },
      });
    } catch (error) {
      throw new PlanUnavailableError(`Adapty unreachable: ${error}`);
    }
    if (res.status === 404) continue;
    if (!res.ok) throw new PlanUnavailableError(`Adapty profile returned ${res.status}`);
    const body = await res.json().catch(() => null);
    const levels: AccessLevel[] = body?.data?.access_levels ?? [];
    const level = levels.find((level) =>
      level.access_level_id === "premium" &&
      (!level.expires_at || new Date(level.expires_at) > now)
    );
    if (level) return level;
  }
  return null;
}

function planOf(level: AccessLevel): Exclude<Plan, "free"> {
  if (level.store_product_id && LEGACY_PRODUCTS.has(level.store_product_id)) return "legacy";
  const known = level.store_product_id ? SONG_PLANS[level.store_product_id] : undefined;
  if (known) return known;
  const start = Date.parse(level.purchased_at ?? level.starts_at ?? "");
  const end = Date.parse(level.expires_at ?? "");
  const days = (end - start) / DAY_MS;
  if (!Number.isFinite(days)) return "weekly";
  return days <= 8 ? "weekly" : days <= 35 ? "monthly" : "annual";
}

/// Clamped to the month's last day, so a purchase on the 31st renews on
/// Feb 28, not Mar 3.
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/// The window the plan's songs are counted in, and when it ends.
function billingWindow(plan: "weekly" | "monthly" | "annual", level: AccessLevel, now: Date): { start: Date; end: Date } {
  const purchased = new Date(level.purchased_at ?? level.starts_at ?? now);
  const expires = level.expires_at ? new Date(level.expires_at) : null;
  if (plan === "annual") {
    // Month k of the year: [purchase + k months, purchase + k+1 months).
    let months = (now.getUTCFullYear() - purchased.getUTCFullYear()) * 12 +
      now.getUTCMonth() - purchased.getUTCMonth();
    if (addMonths(purchased, months) > now) months -= 1;
    months = Math.max(months, 0);
    return { start: addMonths(purchased, months), end: addMonths(purchased, months + 1) };
  }
  // One renewal period. Should Adapty report an old purchase date, the window
  // still never reaches back further than one period.
  const periodMs = plan === "weekly" ? 7 * DAY_MS : 31 * DAY_MS;
  const start = new Date(Math.max(purchased.getTime(), now.getTime() - periodMs));
  const end = expires && expires > now ? expires : new Date(start.getTime() + periodMs);
  return { start, end };
}

type Db = typeof sql;

/// The plan and the window its songs are counted in, from Adapty. Kept apart
/// from the count so generate-song can make the network call before it takes
/// the per-user lock, then count and reserve inside it.
export interface Allowance {
  plan: Plan;
  limit: number;
  /// Songs started from here on count. With no plan, the last 7 days.
  since: Date;
  /// When a plan's window ends; null with no plan (the week slides).
  endsAt: Date | null;
}

export async function planAllowance(userId: string, now = new Date()): Promise<Allowance> {
  const level = await premiumAccess(userId, now);
  // A free trial counts as no plan: Lyncil sells none today, and one started
  // anyway shouldn't be worth a week of free songs.
  const plan = !level || level.offer?.type === "free_trial" ? "free" : planOf(level);
  if (plan === "free" || plan === "legacy") {
    return {
      plan,
      limit: LIMITS[plan],
      since: new Date(now.getTime() - FREE_WINDOW_DAYS * DAY_MS),
      endsAt: null,
    };
  }
  const window = billingWindow(plan, level!, now);
  return { plan, limit: LIMITS[plan], since: window.start, endsAt: window.end };
}

/// Counts what the allowance has spent. `db` is generate-song's transaction
/// when it is about to reserve a song.
export async function quotaFor(allowance: Allowance, userId: string, db: Db = sql): Promise<SongQuota> {
  const rows = await db`
    select count(*)::int as count from lyncil.song_jobs
    where user_id = ${userId} and status <> 'failed' and created_at >= ${allowance.since}`;
  const used = Number(rows[0].count);
  const { plan, limit } = allowance;
  if (allowance.endsAt) return { plan, limit, used, resetsAt: allowance.endsAt.toISOString() };
  let resetsAt: string | null = null;
  if (used >= limit) {
    // The week slides: room comes back when the oldest of the last `limit`
    // songs turns a week old.
    const oldest = await db`
      select min(created_at) as oldest from (
        select created_at from lyncil.song_jobs
        where user_id = ${userId} and status <> 'failed' and created_at >= ${allowance.since}
        order by created_at desc limit ${limit}
      ) recent`;
    const from = oldest[0]?.oldest ? new Date(oldest[0].oldest) : new Date();
    resetsAt = new Date(from.getTime() + FREE_WINDOW_DAYS * DAY_MS).toISOString();
  }
  return { plan, limit, used, resetsAt };
}

export async function songQuota(userId: string): Promise<SongQuota> {
  return await quotaFor(await planAllowance(userId), userId);
}

/// POST song-quota: the caller's allowance, for the counter under "Convert
/// into a song".
export async function handleSongQuota(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);
  try {
    return json(await songQuota(userId));
  } catch (error) {
    console.error("song quota failed", error);
    return json({ error: "Plan unavailable" }, 503);
  }
}
