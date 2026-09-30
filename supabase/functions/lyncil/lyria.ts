// Google Lyria through the Gemini Interactions API
// (ai.google.dev/gemini-api/docs/music-generation). $0.08 a song on
// lyria-3.5, no prepaid tiers; capacity is the project's rate limit in AI
// Studio.
//
// A task runs in background mode (verified 2026-09-30: accepted, ~43 s for a
// full song) and is polled with interactions.get. The finished audio comes
// back inline as base64; song-status keeps it in the lyncil-tracks bucket
// and hands the app a signed URL.
//
// Secrets: LYNCIL_GEMINI_API_KEY (GEMINI_API_KEY as a project-wide
// fallback), LYNCIL_LYRIA_MODEL (optional).
//
// Gemini API terms bar apps "likely to be accessed by individuals under the
// age of 18"; clear that before this goes past testing.

import { SongInput, SongJob, SongStatus, StartedTask } from "./song-provider.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = Deno.env.get("LYNCIL_LYRIA_MODEL") ?? "lyria-3.5";

interface AudioBlock {
  type?: string;
  data?: string;
  mime_type?: string;
}

interface Interaction {
  id?: string;
  status?: string;
  steps?: { type?: string; content?: AudioBlock[] }[];
  error?: { message?: string };
}

/// Lyria takes one prompt with the musical direction and the words kept
/// apart, as its docs advise; the lyrics keep their [Verse]/[Chorus] tags.
function prompt(input: SongInput): string {
  const style = [input.genre, input.mood].filter((part) => part.length > 0).join(", ").toLowerCase();
  if (input.voice === "instrumental") {
    return `Create an instrumental ${style || "pop"} track, about two minutes long. No vocals.`;
  }
  return `Create a ${style || "pop"} song, about two to three minutes long, sung by a ${input.voice} vocalist. ` +
    `Sing exactly these lyrics, following their section tags:\n\n${input.lyrics}`;
}

async function gemini(path: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = Deno.env.get("LYNCIL_GEMINI_API_KEY") ??
    Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing Gemini API key");
  return await fetch(`${GEMINI_URL}${path}`, {
    ...init,
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function audioOf(interaction: Interaction): AudioBlock | null {
  const blocks = (interaction.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((block) => block.type === "audio" && typeof block.data === "string");
  return blocks.at(-1) ?? null;
}

export async function startLyria(input: SongInput): Promise<StartedTask> {
  const res = await gemini("/interactions", {
    method: "POST",
    body: JSON.stringify({ model: MODEL, input: prompt(input), background: true }),
  });
  const interaction = await res.json().catch(() => ({})) as Interaction;
  if (!res.ok || typeof interaction.id !== "string") {
    console.error("lyria start failed", res.status, JSON.stringify(interaction));
    throw new Error(`Gemini returned ${res.status}`);
  }
  return { taskId: interaction.id };
}

export async function queryLyria(job: SongJob): Promise<SongStatus> {
  const res = await gemini(`/interactions/${encodeURIComponent(job.taskId)}`);
  const interaction = await res.json().catch(() => ({})) as Interaction;
  if (!res.ok) {
    console.error("lyria query failed", res.status, JSON.stringify(interaction));
    throw new Error(`Gemini returned ${res.status}`);
  }

  switch (interaction.status) {
    case "completed": {
      const audio = audioOf(interaction);
      if (!audio?.data) {
        console.error("lyria finished without audio", job.taskId, JSON.stringify(interaction.error ?? {}));
        return { status: "failed" };
      }
      // Lyria reports no length; the app reads it off the file.
      return { status: "succeeded", audioData: audio.data, mimeType: audio.mime_type, duration: null };
    }
    case "failed":
    case "cancelled":
    case "incomplete":
    case "requires_action":
      console.error("lyria interaction ended without a song", job.taskId, interaction.status,
        JSON.stringify(interaction.error ?? {}));
      return { status: "failed" };
    default:
      // in_progress, queued
      return { status: "pending" };
  }
}
