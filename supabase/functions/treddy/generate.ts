// Purpose-built generation: the server owns the prompt templates, the hard
// style rules, the model choice, and the output caps — the app sends only the
// per-action input (a hint, a note, a conversation). Replaces the old raw
// OpenAI proxy, which anyone could call with any model on our key.
//
// Auth: a linked app authenticates with its sync secret and the server uses
// the settings stored on the account. The one pre-link call — onboarding's
// first plan — authenticates with the app key and sends settings inline.
// Every caller is capped per day via treddy.ai_usage.

import { json, sql } from "./db.ts";
import {
  accountForBearer,
  type GenerationSettings,
  parseSettings,
} from "./settings.ts";

const MODEL = Deno.env.get("TREDDY_OPENAI_MODEL") ?? "gpt-5.6-terra";
const DAILY_CAP = 300;
const MAX_PLAN_POSTS = 28;

// Ported from the app's Preferences.generationSystemPrompt: standing rules
// that live outside the user's editable brief so they can't be lost — and
// now outside the app binary so they can be iterated without a release.
const HARD_STYLE_RULES = `Hard style rules, no exceptions:
- Never use an em dash or en dash. Not a single one, in any post. Where you \
would reach for a dash, write a comma, a period, or parentheses instead. A \
post containing an em dash is a failed post.
- Write like a real person typing on their phone, never like an AI \
assistant: plain words, contractions, varied sentence length, no marketing \
gloss.`;

function systemPrompt(settings: GenerationSettings): string {
  const parts = [settings.ai_instructions, HARD_STYLE_RULES];
  if (settings.writing_samples.length > 0) {
    const samples = settings.writing_samples
      .map((sample, index) => `${index + 1}. ${sample}`)
      .join("\n");
    parts.push(
      `Posts written by the user — match their voice, rhythm, and formatting:\n${samples}`,
    );
  }
  return parts.join("\n\n");
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

interface Completion {
  user: string;
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens: number;
}

function planCompletion(body: Record<string, unknown>): Completion {
  const count = Math.max(1, Math.min(Number(body.count) || 7, MAX_PLAN_POSTS));
  const hint = str(body.hint, 500);
  const hintLine = hint ? `\nDirection from me for this week: ${hint}\n` : "";
  const lastWeek = str(body.last_week, 8000) || "(no posts last week)";
  return {
    user: `Plan the next week of Threads posts: exactly ${count} posts, ` +
      `one per slot, varied in format, no numbering, no hashtags unless natural. ` +
      `Use last week's performance to lean into what worked.\n${hintLine}\n` +
      `Last week's posts and stats:\n${lastWeek}\n\n` +
      `Return JSON: {"posts": [{"text": "..."}]}`,
    schema: {
      name: "week_plan",
      schema: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
          },
        },
        required: ["posts"],
        additionalProperties: false,
      },
    },
    maxTokens: 20000,
  };
}

function rewriteCompletion(body: Record<string, unknown>): Completion | null {
  const text = str(body.text, 1000);
  if (!text) return null;
  const note = str(body.note, 500);
  const noteLine = note
    ? `Direction from me: ${note}`
    : "Make it stronger and more engaging.";
  return {
    user: `Rewrite this planned Threads post of mine. Keep my voice and the ` +
      `core idea. ${noteLine}\nReturn only the post text, nothing else.\n\n` +
      `Current draft: ${text}`,
    maxTokens: 4000,
  };
}

function replyCompletion(body: Record<string, unknown>): Completion | null {
  const theirText = str(body.their_text, 1000);
  if (!theirText) return null;
  const username = str(body.their_username, 100);
  const note = str(body.note, 500);
  const noteLine = note ? `\nDirection from me: ${note}` : "";
  const conversation = Array.isArray(body.conversation)
    ? body.conversation
      .filter((message): message is { username: unknown; text: unknown } =>
        typeof message === "object" && message !== null
      )
      .slice(0, 25)
      .map((message) => `@${str(message.username, 100)}: ${str(message.text, 1000)}`)
    : [];
  const conversationSection = conversation.length === 0 ? "" : `\n
The conversation so far, oldest first — the first message is my own post:
${conversation.join("\n")}
`;
  return {
    user: `Write my response to this message in a Threads conversation. ` +
      `Keep it under 280 characters, friendly, and conversational. ` +
      `Return only the response text, nothing else.\n${conversationSection}\n` +
      `Their message (@${username}): ${theirText}${noteLine}`,
    maxTokens: 4000,
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/// Pre-link callers (onboarding) prove they're the app with the app key.
async function isAppCall(req: Request): Promise<boolean> {
  const expected = Deno.env.get("TREDDY_APP_KEY");
  const given = req.headers.get("x-treddy-app-key");
  if (!expected || !given) return false;
  return (await sha256(given)) === (await sha256(expected));
}

/// Counts the call against the caller's daily budget; false means over cap.
async function underDailyCap(caller: string): Promise<boolean> {
  const rows = await sql`
    insert into treddy.ai_usage (caller, day, count)
    values (${caller}, current_date, 1)
    on conflict (caller, day) do update set count = treddy.ai_usage.count + 1
    returning count`;
  return Number(rows[0].count) <= DAILY_CAP;
}

async function complete(system: string, completion: Completion): Promise<string> {
  const apiKey = Deno.env.get("TREDDY_OPENAI_API_KEY") ??
    Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Missing OpenAI API key");

  const body: Record<string, unknown> = {
    model: MODEL,
    max_completion_tokens: completion.maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: completion.user },
    ],
  };
  if (completion.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { ...completion.schema, strict: true },
    };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("openai call failed", res.status, JSON.stringify(payload));
    throw new Error(`OpenAI returned ${res.status}`);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenAI returned an empty response");
  }
  return content;
}

export async function handleGenerate(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "JSON body is required" }, 400);

  // Identity and settings: linked app → stored settings; onboarding → app
  // key + inline settings.
  let settings: GenerationSettings | null;
  let caller: string;
  const account = await accountForBearer(req);
  if (account) {
    settings = parseSettings(account.settings);
    caller = `acct:${account.threads_user_id}`;
    if (!settings) {
      // Linked but never pushed settings (older app build) — accept them
      // inline rather than dead-ending the user.
      settings = parseSettings(body.settings);
    }
    if (!settings) return json({ error: "No settings stored — push settings first" }, 409);
  } else {
    if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
    settings = parseSettings(body.settings);
    if (!settings) return json({ error: "settings.ai_instructions is required" }, 400);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    caller = `anon:${(await sha256(ip)).slice(0, 16)}`;
  }

  if (!await underDailyCap(caller)) {
    return json({ error: "Daily generation limit reached" }, 429);
  }

  const task = body.task;
  const completion = task === "plan"
    ? planCompletion(body)
    : task === "rewrite"
    ? rewriteCompletion(body)
    : task === "reply"
    ? replyCompletion(body)
    : undefined;
  if (completion === undefined) {
    return json({ error: "task must be plan, rewrite, or reply" }, 400);
  }
  if (completion === null) return json({ error: "Missing task input" }, 400);

  const content = await complete(systemPrompt(settings), completion);

  if (task === "plan") {
    let posts: { text: string }[];
    try {
      const parsed = JSON.parse(content);
      posts = (parsed.posts as { text: string }[])
        .filter((post) => typeof post?.text === "string" && post.text.length > 0);
    } catch {
      console.error("plan response was not valid JSON", content.slice(0, 200));
      return json({ error: "Generation returned an unusable plan" }, 502);
    }
    return json({ posts });
  }
  return json({ text: content });
}
