// Server-side copy of the user's setup, stored on the account row: the
// editable AI brief and the writing samples (which /generate reads here so
// the app never resends the whole brief per call), plus the planning
// defaults (posting times, plan length) so a returning user — new phone,
// reinstall, account switch — gets their schedule back from /link instead of
// the app's defaults. The app pushes settings when it completes onboarding
// and whenever the user edits them. Only onboarding's first plan — generated
// before Threads is linked — still sends settings inline.

import { json, sql } from "./db.ts";

export interface GenerationSettings {
  ai_instructions: string;
  writing_samples: string[];
  /// Minutes from midnight, one post per entry each day. Absent for
  /// accounts set up by app builds that didn't sync the schedule.
  posting_times?: number[];
  /// Days a generated plan covers (1–7).
  plan_days?: number;
}

const MAX_INSTRUCTIONS = 4000;
const MAX_SAMPLES = 10;
const MAX_SAMPLE_LENGTH = 1000;
const MAX_POSTING_TIMES = 4;
const MINUTES_PER_DAY = 24 * 60;

/// Validates the app's settings payload. Returns null without a usable brief
/// — the one field nothing works without.
export function parseSettings(raw: unknown): GenerationSettings | null {
  const object = raw as Record<string, unknown> | null | undefined;
  const instructions = object?.ai_instructions;
  if (typeof instructions !== "string" || instructions.trim().length === 0) {
    return null;
  }
  const samples = Array.isArray(object?.writing_samples)
    ? object.writing_samples
      .filter((sample): sample is string =>
        typeof sample === "string" && sample.trim().length > 0
      )
      .slice(0, MAX_SAMPLES)
      .map((sample) => sample.slice(0, MAX_SAMPLE_LENGTH))
    : [];
  const settings: GenerationSettings = {
    ai_instructions: instructions.slice(0, MAX_INSTRUCTIONS),
    writing_samples: samples,
  };
  const times = Array.isArray(object?.posting_times)
    ? object.posting_times
      .filter((time): time is number =>
        Number.isInteger(time) && time >= 0 && time < MINUTES_PER_DAY
      )
      .slice(0, MAX_POSTING_TIMES)
    : [];
  if (times.length > 0) settings.posting_times = times;
  const days = object?.plan_days;
  if (Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 7) {
    settings.plan_days = days as number;
  }
  return settings;
}

export interface Account {
  threads_user_id: string;
  settings: Record<string, unknown>;
}

/// Resolves the bearer sync secret to the account it belongs to.
export async function accountForBearer(req: Request): Promise<Account | null> {
  const secret = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const isUUID = typeof secret === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(secret);
  if (!isUUID) return null;
  const rows = await sql`
    select threads_user_id, settings
    from treddy.accounts where sync_secret = ${secret}`;
  return rows.length > 0 ? (rows[0] as unknown as Account) : null;
}

export async function saveSettings(
  threadsUserID: string,
  settings: GenerationSettings,
): Promise<void> {
  // sql.json serializes once. A pre-stringified value with a ::jsonb cast
  // got JSON-encoded a second time by the driver and landed as a JSON
  // string, which parseSettings then rejected — /generate answered 409 and
  // /link told a returning user they had no setup. (Spread: the driver's
  // JSON type wants an indexable object, which an interface is not.)
  await sql`
    update treddy.accounts
    set settings = ${sql.json({ ...settings })},
        updated_at = now()
    where threads_user_id = ${threadsUserID}`;
}

export async function handleSettings(req: Request): Promise<Response> {
  const account = await accountForBearer(req);
  if (!account) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const settings = parseSettings(body?.settings ?? body);
  if (!settings) return json({ error: "ai_instructions is required" }, 400);

  await saveSettings(account.threads_user_id, settings);
  return json({ ok: true });
}
