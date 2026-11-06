// One spoken clip from ElevenLabs, cached in storage by a hash of everything
// that shapes the audio, so replaying an affirmation costs nothing. Only the
// app's own voices and models are accepted, the text is capped at a few
// sentences, and each user's daily budget counts the characters sent to
// ElevenLabs on a cache miss, which is what it bills.

import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders } from "../_shared/cors.ts";
import { json } from "../_shared/router.ts";
import { callerUserId, isAppCall, recordUsage } from "./auth.ts";

const CACHE_BUCKET = "affirmations-tts-cache";
const OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_MODEL_ID = "eleven_turbo_v2_5";
const MODEL_IDS = new Set(["eleven_turbo_v2_5", "eleven_multilingual_v2"]);
// Anna, David, Sofia, Max, Emma (VoiceOption.swift in the app).
const VOICE_IDS = new Set([
  "OsxBZB11a95XBjzhyG89",
  "KH1SQLVulwP6uG4O3nmT",
  "ckJNs7lCdIwdpXDCyKPK",
  "6B4Dj2itl1eCcXki9qYL",
  "Qggl4b0xRMiqOwhPtVWT",
]);
const MAX_TEXT = 400;
// About four full sessions of fifty affirmations a day.
const DAILY_CHARACTER_CAP = 20_000;

function speed(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(1.2, Math.max(0.7, number));
}

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
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body?.voice_id === "string" ? body.voice_id.trim() : "";
  const modelId = typeof body?.model_id === "string" ? body.model_id : DEFAULT_MODEL_ID;
  const settings = body?.voice_settings as Record<string, unknown> | undefined;
  const voiceSettings = { speed: speed(settings?.speed) };

  if (!text) return json({ error: "text is required" }, 400);
  if (text.length > MAX_TEXT) return json({ error: "text is too long" }, 400);
  if (!VOICE_IDS.has(voiceId)) return json({ error: "Unknown voice" }, 400);
  if (!MODEL_IDS.has(modelId)) return json({ error: "Unknown model" }, 400);

  const cacheKey = await sha256(
    `${text}|${voiceId}|${modelId}|${OUTPUT_FORMAT}|${JSON.stringify(voiceSettings)}`,
  );
  const objectPath = `${cacheKey}.mp3`;
  const storage = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  ).storage.from(CACHE_BUCKET);

  const cached = await storage.download(objectPath);
  if (cached.data) {
    return audioResponse(await cached.data.arrayBuffer(), "HIT");
  }

  const usage = await recordUsage(userId, "text-to-speech", text.length);
  if (usage.characters > DAILY_CHARACTER_CAP) {
    return json({ error: "Daily speech limit reached" }, 429);
  }

  const apiKey = Deno.env.get("AFFIRMATIONS_ELEVENLABS_API_KEY") ??
    Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("Missing ElevenLabs API key");

  const eleven = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: modelId, voice_settings: voiceSettings }),
    },
  );
  if (!eleven.ok) {
    console.error("elevenlabs call failed", eleven.status, await eleven.text());
    return json({ error: "Text-to-speech failed" }, 502);
  }

  const audio = await eleven.arrayBuffer();
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
