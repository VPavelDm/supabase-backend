// Fifty affirmations on the user's topic, in one model call. The server owns
// the prompt, the model, the JSON schema and the cap; the app sends only the
// topic. Same prompt and schema the app used on Pretzly's project, where the
// route took the anon key alone.

import { json } from "../_shared/router.ts";
import { callerUserId, isAppCall, recordUsage } from "./auth.ts";

const MODEL = Deno.env.get("AFFIRMATIONS_OPENAI_MODEL") ?? "gpt-4o-mini";
const DAILY_CAP = 30;
const MAX_TOKENS = 4000;
const MAX_TOPIC = 1000;

const SYSTEM_PROMPT = `You are an affirmation coach. Generate short, positive affirmations for the user.
Rules:
- First person, present tense ("I am…", "I have…", "I choose…").
- Each sentence is 8 to 14 words.
- Warm, calming, and believable — avoid grandiose claims.
- No quotation marks, no numbering, no emojis.
- Stay on the topic the user provides.
- Generate affirmations in the same language as the user's topic.`;

const AFFIRMATIONS_SCHEMA = {
  name: "affirmations_options",
  strict: true,
  schema: {
    type: "object",
    title: "Affirmations",
    properties: {
      affirmations: {
        type: "array",
        description:
          "Exactly 50 short, positive affirmations written in the first person, present tense.",
        items: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description:
                "A single affirmation sentence, 8 to 14 words, first person, present tense, no quotes.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },
    required: ["affirmations"],
    additionalProperties: false,
  },
};

async function complete(topic: string): Promise<string> {
  const apiKey = Deno.env.get("AFFIRMATIONS_OPENAI_API_KEY") ??
    Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Missing OpenAI API key");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Generate affirmations focused on: ${topic}.` },
      ],
      response_format: { type: "json_schema", json_schema: AFFIRMATIONS_SCHEMA },
    }),
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

export async function handleGenerateAffirmations(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, MAX_TOPIC) : "";
  if (!topic) return json({ error: "topic is required" }, 400);

  const usage = await recordUsage(userId, "generate-affirmations");
  if (usage.count > DAILY_CAP) {
    return json({ error: "Daily generation limit reached" }, 429);
  }

  const content = await complete(topic);
  let affirmations: { text: string }[] = [];
  try {
    const parsed = JSON.parse(content);
    affirmations = (Array.isArray(parsed?.affirmations) ? parsed.affirmations : [])
      .filter((item: unknown): item is { text: string } =>
        typeof (item as { text?: unknown })?.text === "string" &&
        (item as { text: string }).text.trim().length > 0
      )
      .map((item: { text: string }) => ({ text: item.text.trim() }));
  } catch {
    console.error("affirmations response was not valid JSON", content.slice(0, 200));
  }
  if (affirmations.length === 0) {
    return json({ error: "Generation returned no affirmations" }, 502);
  }

  return json({ affirmations });
}
