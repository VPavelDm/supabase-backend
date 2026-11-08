// One spoken clip from ElevenLabs, cached in storage by a hash of everything
// that shapes the audio, so a phrase is paid for once and then heard by every
// learner for free. The app sends only the text and a voice role; the
// language, model, voice and speed come from apps.ts. Two daily budgets count
// the characters sent to ElevenLabs on a cache miss, which is what it bills:
// one per user, and one for the whole app, which is what stops a leaked app
// key and a loop of fresh anonymous users from draining the shared account.

import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders } from "../_shared/cors.ts";
import { secretKey } from "../_shared/keys.ts";
import { json } from "../_shared/router.ts";
import { callerApp, callerUserId, recordUsage } from "./auth.ts";

const FN = "lingo/text-to-speech";
const CACHE_BUCKET = "lingo-tts-cache";
const OUTPUT_FORMAT = "mp3_44100_128";
// Longer than any sentence the lessons read aloud.
const MAX_TEXT = 200;
// All of Hutarka's chapter-one text is about 5,000 characters, and a learner
// only misses the cache for phrases nobody has heard yet.
const USER_DAILY_CHARACTER_CAP = 5_000;
// New lesson content lands in the cache once; a whole app burning through
// this in a day is a leaked key, not learners.
const APP_DAILY_CHARACTER_CAP = 200_000;

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function audioResponse(bytes: ArrayBuffer, cacheStatus: "HIT" | "MISS"): Response {
  return new Response(bytes, {
    headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "X-Cache": cacheStatus },
  });
}

export async function handleTextToSpeech(req: Request): Promise<Response> {
  const app = await callerApp(req);
  if (!app) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  // Whitespace differences would only split the cache.
  const text = typeof body?.text === "string" ? body.text.trim().replace(/\s+/g, " ") : "";
  const role = typeof body?.voice === "string" ? body.voice : "narrator";

  if (!text) return json({ error: "text is required" }, 400);
  if (text.length > MAX_TEXT) return json({ error: "text is too long" }, 400);
  const voiceId = app.voices[role];
  if (!voiceId) return json({ error: "Unknown voice" }, 400);

  const voiceSettings = { speed: app.speed };
  const cacheKey = await sha256(
    `${text}|${voiceId}|${app.modelId}|${OUTPUT_FORMAT}|${JSON.stringify(voiceSettings)}`,
  );
  const objectPath = `${app.id}/${cacheKey}.mp3`;
  const storage = createClient(Deno.env.get("SUPABASE_URL")!, secretKey())
    .storage.from(CACHE_BUCKET);

  const cached = await storage.download(objectPath);
  if (cached.data) {
    return audioResponse(await cached.data.arrayBuffer(), "HIT");
  }

  const usage = await recordUsage(app.id, userId, "text-to-speech", text.length);
  if (usage.user.characters > USER_DAILY_CHARACTER_CAP) {
    return json({ error: "Daily speech limit reached" }, 429);
  }
  if (usage.app.characters > APP_DAILY_CHARACTER_CAP) {
    console.error(JSON.stringify({ level: "error", fn: FN, event: "app_cap_reached", app: app.id }));
    return json({ error: "Daily speech limit reached" }, 429);
  }

  const apiKey = Deno.env.get("LINGO_ELEVENLABS_API_KEY") ?? Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("Missing ElevenLabs API key");

  // Only the v2.5 models take a language; the others reject the field.
  const languageCode = app.modelId.endsWith("_v2_5") ? { language_code: app.language } : {};
  const eleven = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: app.modelId,
        voice_settings: voiceSettings,
        ...languageCode,
      }),
    },
  );
  if (!eleven.ok) {
    console.error("elevenlabs call failed", eleven.status, await eleven.text());
    return json({ error: "Text-to-speech failed" }, 502);
  }

  const audio = await eleven.arrayBuffer();
  console.log(JSON.stringify({
    fn: FN,
    event: "synthesized",
    app: app.id,
    voice: role,
    characters: text.length,
    user_characters_today: usage.user.characters,
    app_characters_today: usage.app.characters,
  }));
  const upload = storage
    .upload(objectPath, audio, { contentType: "audio/mpeg", upsert: false })
    .then(({ error }) => {
      if (error && !error.message.includes("already exists")) {
        console.error("tts cache upload failed", error.message);
      }
    });
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: unknown) => void } })
    .EdgeRuntime;
  runtime?.waitUntil?.(upload);

  return audioResponse(audio, "MISS");
}
