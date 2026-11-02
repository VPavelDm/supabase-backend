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
  templateFor,
  THREAD_SEPARATOR,
  type VoiceTemplate,
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

// Prompt fragments for the structured answers. English regardless of the
// user's UI language: the model follows the brief; the user never reads it.
const MARKET_TEXT: Record<string, string> = {
  us: "The readers are in the United States: use pounds, feet and inches, " +
    "Fahrenheit, dollars, US spelling and month-day dates.",
  uk: "The readers are in the United Kingdom: use British spelling, pounds " +
    "sterling and day-month dates; metric units, with stone for body weight.",
  europe: "The readers are in Europe: use kilograms, centimetres, Celsius, " +
    "euros and day-month dates.",
};
const FORMAT_TEXT: Record<string, string> = {
  tips: "quick practical tips",
  questions: "questions that invite replies",
  hotTakes: "hot takes",
  stories: "relatable personal stories",
  challenges: "mini challenges",
  behindTheScenes: "behind-the-scenes moments",
  howTo: "step-by-step how-tos that get the reader to one result",
  lists: "short lists and checklists",
  myths: "myths people in the topic believe, busted",
  mistakes: "common mistakes and what to do instead",
  results: "real results and cases, with the numbers the user gave",
  series: "a numbered series on one theme, each post opening with its number " +
    "(\"Day 1.\", \"Day 2.\") and counting up in order, from 1 unless the " +
    "user's instructions say where to start",
};

/// "a", "a and b", "a, b and c".
function naturalJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function numbered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

/// The standing brief, composed from one voice template. An answer left
/// empty is left out, never filled with a default, so it can't contradict
/// what the user wrote in their notes ("always end with a question" next to
/// a tone they never picked). Audience, goals and reference posts are still
/// stored for older app builds but no longer shape the posts: the user's
/// own posts say more than all three.
function brief(template: VoiceTemplate): string {
  const sentences: string[] = [];
  sentences.push(
    template.topic
      ? `You write Threads posts for a creator building an audience around ${template.topic}.`
      : "You write Threads posts for a creator building an audience.",
  );
  sentences.push("Keep each post under 400 characters.");
  if (template.tones.length > 0) sentences.push(`Tone: ${naturalJoin(template.tones)}.`);
  const formats = template.formats.map((format) => FORMAT_TEXT[format]).filter(Boolean);
  if (formats.length > 0) sentences.push(`Mix formats: ${naturalJoin(formats)}.`);
  if (template.language) sentences.push(`Write in ${template.language}.`);
  const market = MARKET_TEXT[template.market];
  if (market) sentences.push(market);
  return sentences.join(" ");
}

/// A writing sample as the model reads it: a single post as is, a thread
/// spelled out post by post so it isn't taken for one long post.
function sampleText(sample: string): string {
  const posts = sample.split(THREAD_SEPARATOR);
  if (posts.length === 1) return sample;
  return `A thread of ${posts.length} posts, each replying to the one before:\n` +
    posts.map((post, index) => `   Post ${index + 1}: ${post}`).join("\n");
}

function systemPrompt(template: VoiceTemplate): string {
  const parts = [brief(template)];
  if (template.notes) {
    parts.push(`Additional instructions from the user:\n${template.notes}`);
  }
  parts.push(HARD_STYLE_RULES);
  if (template.writing_samples.length > 0) {
    parts.push(
      `Posts written by the user — match their voice, rhythm, and formatting:\n${numbered(template.writing_samples.map(sampleText))}`,
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
      `one per slot, no numbering, no hashtags unless natural. ` +
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

// One planned post: with `text`, edits it as `note` says (or makes it
// stronger without one); with no text, writes it, steered by `note`. In a
// chain, `earlier_posts` are the posts before this one, which it continues.
function rewriteCompletion(body: Record<string, unknown>): Completion {
  const text = str(body.text, 1000).trim();
  const note = str(body.note, 500).trim();
  const earlierPosts = Array.isArray(body.earlier_posts)
    ? body.earlier_posts.slice(0, 10).map((post) => str(post, 1000)).filter((post) => post)
    : [];
  const earlierSection = earlierPosts.length === 0 ? "" : `\n
This post goes out as post ${earlierPosts.length + 1} of a chain, each one ` +
    `answering the one before. The ones before it say, in order:
${earlierPosts.map((post, index) => `${index + 1}. ${post}`).join("\n")}
It continues from them: don't repeat what they say.
`;
  if (!text) {
    const direction = note ? `\nDirection from me: ${note}` : "";
    return {
      user: `Write one Threads post for me, in my voice. Keep it under 500 ` +
        `characters. Return only the post text, nothing else.\n` +
        `${earlierSection}${direction}`,
      maxTokens: 4000,
    };
  }
  if (note) {
    return {
      user: `Edit this planned Threads post of mine, following my instruction ` +
        `exactly. Keep my voice and the language of the post unless the ` +
        `instruction says otherwise. Change only what the instruction asks ` +
        `for. Keep it under 500 characters. Return only the post text, ` +
        `nothing else.\n${earlierSection}\n` +
        `My post: ${text}\n\nMy instruction: ${note}`,
      maxTokens: 4000,
    };
  }
  return {
    user: `Rewrite this planned Threads post of mine. Keep my voice and the ` +
      `core idea. Make it stronger and more engaging. Keep it under 500 ` +
      `characters. Return only the post text, nothing else.\n` +
      `${earlierSection}\nCurrent draft: ${text}`,
    maxTokens: 4000,
  };
}

// With a `draft` the user already wrote something (their own text, notes, or
// an earlier AI version) and `instruction` says how to edit it; without one
// the reply is written fresh. A reply can go out as several posts in a row;
// `earlier_posts` are the user's posts before this one, which it continues.
function replyCompletion(body: Record<string, unknown>): Completion | null {
  const theirText = str(body.their_text, 1000);
  if (!theirText) return null;
  const username = str(body.their_username, 100);
  const draft = str(body.draft, 1000).trim();
  const instruction = str(body.instruction, 500).trim();
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
  const earlierPosts = Array.isArray(body.earlier_posts)
    ? body.earlier_posts.slice(0, 10).map((post) => str(post, 1000)).filter((post) => post)
    : [];
  const earlierSection = earlierPosts.length === 0 ? "" : `\n
My response goes out as several posts in a row. This is post ` +
    `${earlierPosts.length + 1}; the ones before it say, in order:
${earlierPosts.map((post, index) => `${index + 1}. ${post}`).join("\n")}
It continues from them: don't repeat what they say or greet again.
`;
  const theirLine = `Their message (@${username}): ${theirText}`;
  if (draft) {
    return {
      user: `I'm answering a message in a Threads conversation and already have ` +
        `a draft of my response. Edit my draft, following my instruction ` +
        `exactly. Keep my voice and the language of my draft unless the ` +
        `instruction says otherwise. Change only what the instruction asks ` +
        `for. Keep it under 500 characters. Return only the edited response ` +
        `text, nothing else.\n` +
        `${conversationSection}\n${theirLine}\n${earlierSection}\n` +
        `My draft: ${draft}\n\n` +
        `My instruction: ${instruction || "Improve it, keeping what I meant."}`,
      maxTokens: 4000,
    };
  }
  const instructionLine = instruction ? `\nDirection from me: ${instruction}` : "";
  const lengthRule = earlierPosts.length === 0
    ? "Keep it under 280 characters, friendly, and conversational."
    : "Keep it under 500 characters, in the same tone as the posts before it.";
  return {
    user: `Write my response to this message in a Threads conversation. ` +
      `${lengthRule} Return only the response text, nothing else.\n` +
      `${conversationSection}\n${theirLine}${earlierSection}${instructionLine}`,
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
    if (!settings) return json({ error: "settings need a template with a topic or notes" }, 400);
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

  const content = await complete(systemPrompt(templateFor(settings, body.template_id)), completion);

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
