// Server-side copy of the user's setup, stored on the account row: the voice
// templates /generate composes prompts from (structured answers, notes, the
// user's writing samples, reference posts), which one is the default, plus
// the planning defaults (posting times, plan length) so a returning user —
// new phone, reinstall, account switch — gets everything back from /link and
// /sync. The app pushes settings when it completes onboarding and whenever
// the user edits them. Only onboarding's first plan — generated before
// Threads is linked — still sends settings inline.

import { json, sql } from "./db.ts";

/// One way the account can sound. The app collects these as structured
/// answers; the prompt is composed here (generate.ts), so it iterates
/// without an app release. Enum values are the app's raw values.
export interface VoiceTemplate {
  id: string;
  name: string;
  topic: string;
  audience: string;
  goals: string[];
  tones: string[];
  formats: string[];
  language: string;
  /// Anything the questions don't cover, in the user's own words.
  notes: string;
  /// The user's own posts — voice references every generation imitates.
  writing_samples: string[];
  /// Posts by others the user admires — what good looks like, never copied.
  references: string[];
}

export interface GenerationSettings {
  templates: VoiceTemplate[];
  default_template_id: string;
  /// Minutes from midnight, one post per entry each day. Absent for
  /// accounts set up by app builds that didn't sync the schedule.
  posting_times?: number[];
  /// Days a generated plan covers (1–7).
  plan_days?: number;
}

export const GOALS = new Set([
  "growAudience", "forFun", "authority", "buildInPublic",
  "promoteProduct", "landClients", "stayConsistent", "community",
]);
export const TONES = new Set(["warm", "witty", "bold", "casual", "educational", "inspiring"]);
export const FORMATS = new Set(["tips", "questions", "hotTakes", "stories", "challenges", "behindTheScenes"]);

const MAX_TEMPLATES = 10;
const MAX_NAME = 60;
const MAX_SHORT = 300;
const MAX_NOTES = 2000;
const MAX_SAMPLES = 10;
const MAX_SAMPLE_LENGTH = 1000;
const MAX_REFERENCES = 10;
const MAX_REFERENCE_LENGTH = 1500;
const MAX_POSTING_TIMES = 4;
const MINUTES_PER_DAY = 24 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function texts(value: unknown, max: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, max)
      .map((item) => item.trim().slice(0, maxLength))
    : [];
}

function choices(value: unknown, allowed: Set<string>): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))]
    : [];
}

/// Returns null for a template nothing can be written from — no topic and
/// no notes.
function parseTemplate(raw: unknown): VoiceTemplate | null {
  const object = raw as Record<string, unknown> | null | undefined;
  if (!object || typeof object !== "object") return null;
  const topic = text(object.topic, MAX_SHORT);
  const notes = text(object.notes, MAX_NOTES);
  if (!topic && !notes) return null;
  const id = typeof object.id === "string" && UUID.test(object.id)
    ? object.id.toUpperCase()
    : crypto.randomUUID().toUpperCase();
  return {
    id,
    name: text(object.name, MAX_NAME) || "My voice",
    topic,
    audience: text(object.audience, MAX_SHORT),
    goals: choices(object.goals, GOALS),
    tones: choices(object.tones, TONES),
    formats: choices(object.formats, FORMATS),
    language: text(object.language, 40) || "English",
    notes,
    writing_samples: texts(object.writing_samples, MAX_SAMPLES, MAX_SAMPLE_LENGTH),
    references: texts(object.references, MAX_REFERENCES, MAX_REFERENCE_LENGTH),
  };
}

/// Validates the app's settings payload. Returns null without a usable
/// template — the one thing nothing works without. Settings saved by app
/// builds from before templates (a single brief plus writing samples)
/// become one template, so nobody is sent back through onboarding for a
/// format change.
export function parseSettings(raw: unknown): GenerationSettings | null {
  const object = raw as Record<string, unknown> | null | undefined;
  if (!object || typeof object !== "object") return null;

  let templates: VoiceTemplate[];
  if (Array.isArray(object.templates)) {
    templates = object.templates
      .slice(0, MAX_TEMPLATES)
      .map(parseTemplate)
      .filter((template): template is VoiceTemplate => template !== null);
  } else {
    const legacy = parseTemplate({
      name: "My voice",
      notes: object.ai_instructions,
      writing_samples: object.writing_samples,
    });
    templates = legacy ? [legacy] : [];
  }
  if (templates.length === 0) return null;

  const wanted = typeof object.default_template_id === "string"
    ? object.default_template_id.toUpperCase()
    : "";
  const settings: GenerationSettings = {
    templates,
    default_template_id: templates.some((t) => t.id === wanted) ? wanted : templates[0].id,
  };
  const times = Array.isArray(object.posting_times)
    ? object.posting_times
      .filter((time): time is number =>
        Number.isInteger(time) && time >= 0 && time < MINUTES_PER_DAY
      )
      .slice(0, MAX_POSTING_TIMES)
    : [];
  if (times.length > 0) settings.posting_times = times;
  const days = object.plan_days;
  if (Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 7) {
    settings.plan_days = days as number;
  }
  return settings;
}

/// The template a request asked for, or the default.
export function templateFor(settings: GenerationSettings, id: unknown): VoiceTemplate {
  const wanted = typeof id === "string" ? id.toUpperCase() : "";
  return settings.templates.find((t) => t.id === wanted) ??
    settings.templates.find((t) => t.id === settings.default_template_id) ??
    settings.templates[0];
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
  // /link told a returning user they had no setup. (The cast: the driver's
  // JSON type wants an indexable object, which an interface is not.)
  await sql`
    update treddy.accounts
    set settings = ${sql.json(settings as unknown as Parameters<typeof sql.json>[0])},
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
