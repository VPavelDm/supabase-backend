// Server-side copy of the user's generation settings (the editable AI brief
// and the writing samples), stored on the account row. The app pushes them at
// /link and whenever the user edits them; /generate reads them here so the
// app never resends the whole brief per call. Only onboarding's first plan —
// generated before Threads is linked — still sends settings inline.

import { json, sql } from "./db.ts";

export interface GenerationSettings {
  ai_instructions: string;
  writing_samples: string[];
}

const MAX_INSTRUCTIONS = 4000;
const MAX_SAMPLES = 10;
const MAX_SAMPLE_LENGTH = 1000;

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
  return {
    ai_instructions: instructions.slice(0, MAX_INSTRUCTIONS),
    writing_samples: samples,
  };
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
  await sql`
    update treddy.accounts
    set settings = ${JSON.stringify(settings)}::jsonb,
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
