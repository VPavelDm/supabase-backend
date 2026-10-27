// Google Lyria through the Gemini Interactions API
// (ai.google.dev/gemini-api/docs/music-generation). $0.08 a song on
// lyria-3.5, no prepaid tiers; capacity is the project's rate limit in AI
// Studio.
//
// Two ways to run a song, picked by LYNCIL_LYRIA_MODE:
//
//   sync (default)  one blocking interactions.create that answers with the
//                   song; generate-song makes it after answering the app
//                   (renderLyria) and stores the track itself
//   background      background mode (verified 2026-09-30: accepted, ~43 s for
//                   a full song), polled by song-status with interactions.get
//
// Sync exists because since 2026-10-03/04 interactions.get answers 400
// "Multiple authentication credentials received" for AQ.-prefixed keys,
// the only kind AI Studio and Cloud Console issue for the Gemini API now,
// while interactions.create still works. Switch back once Google fixes it:
// discuss.ai.google.dev/t/186789
//
// Either way the finished audio comes back inline as base64 and is kept in
// the lyncil-tracks bucket; the app gets a signed URL.
//
// Secrets: LYNCIL_GEMINI_API_KEY (GEMINI_API_KEY as a project-wide
// fallback), LYNCIL_LYRIA_MODEL (optional), LYNCIL_LYRIA_MODE (optional).
//
// Gemini API terms bar apps "likely to be accessed by individuals under the
// age of 18"; clear that before this goes past testing.

import { LyricsBlockedError, SongInput, SongJob, SongStatus, StartedTask } from "./song-provider.ts";

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
  error?: { message?: string; code?: string };
}

/// Codes Lyria refuses lyrics with. Both seen in production on 2026-10-07:
/// prohibited_content ("sensitive words", about 15 s) and content_blocked
/// ("an unspecified policy reason", about 28 s); neither makes audio.
/// invalid_request ("Request contains an invalid argument", 2026-10-10) is
/// treated the same: every song is sent the same way and 68 others went
/// through, so it was about the words, and it should get the retry and the
/// app's "change these parts" help rather than "give it another go". Should
/// it ever hit every song (a request the API stopped accepting), Amplitude's
/// backend_song_failed shows error_code invalid_request rising.
const REFUSAL_CODES = new Set(["prohibited_content", "content_blocked", "invalid_request"]);

/// A refused request's error: the lyrics tripped Google's prohibited-use
/// filter (seen on harmless love-song lyrics), or anything else. The message
/// ends up on the failed job (song_jobs.error).
function requestError(status: number, interaction: Interaction): Error {
  const code = interaction.error?.code ?? "";
  if (REFUSAL_CODES.has(code)) return new LyricsBlockedError(`Lyria blocked the lyrics: ${code}`);
  // Google's own words come along (shortened), since the logs that also hold
  // them are gone after a day.
  const message = interaction.error?.message?.slice(0, 200);
  return new Error(`Gemini returned ${status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`);
}

/// Without it lyria-3.5 refuses lyrics that name someone who shares a
/// famous singer's first name ("Love you Justin, you're my brother", refused
/// 3 of 3 in prod and 4 of 4 in tests on 2026-10-27, prohibited_content
/// "Input blocked"); with it the same lyrics made a song 3 of 3, the name sung
/// as written (snippets/lyncil-name-test.ts).
const NAMES_NOTE = "If the lyrics contain personal names, interpret them as references to private individuals " +
  "mentioned in the song, unless the context explicitly indicates otherwise. Common first names should not be " +
  "treated as references to celebrities or musicians solely because they share the same name. Preserve all " +
  "names exactly as written. Create an original song without imitating any existing artist's voice, musical " +
  "style, or copyrighted work.";

/// Lyria takes one prompt with the musical direction and the words kept
/// apart, as its docs advise; the lyrics keep their [Verse]/[Chorus] tags.
function prompt(input: SongInput): string {
  const style = [input.genre, input.mood].filter((part) => part.length > 0).join(", ").toLowerCase();
  if (input.voice === "instrumental") {
    return `Create an instrumental ${style || "pop"} track, about two minutes long. No vocals.`;
  }
  return `Create a ${style || "pop"} song, about two to three minutes long, sung by a ${input.voice} vocalist. ` +
    `${NAMES_NOTE} Sing exactly these lyrics, following their section tags:\n\n${input.lyrics}`;
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

/// Whether Lyria songs are started in background mode and polled; the
/// default makes each song in one call instead.
export function lyriaPolls(): boolean {
  return Deno.env.get("LYNCIL_LYRIA_MODE") === "background";
}

/// One song in one call: waits until Lyria has made it (about 45 s) and
/// returns the audio, or `failed` when Lyria answers without a song.
export async function renderLyria(input: SongInput, signal?: AbortSignal): Promise<SongStatus> {
  const res = await gemini("/interactions", {
    method: "POST",
    body: JSON.stringify({ model: MODEL, input: prompt(input) }),
    signal,
  });
  const interaction = await res.json().catch(() => ({})) as Interaction;
  if (!res.ok) {
    console.error("lyria render failed", res.status, JSON.stringify(interaction));
    throw requestError(res.status, interaction);
  }
  return finished(interaction, interaction.id ?? "sync");
}

export async function startLyria(input: SongInput): Promise<StartedTask> {
  const res = await gemini("/interactions", {
    method: "POST",
    body: JSON.stringify({ model: MODEL, input: prompt(input), background: true }),
  });
  const interaction = await res.json().catch(() => ({})) as Interaction;
  if (!res.ok || typeof interaction.id !== "string") {
    console.error("lyria start failed", res.status, JSON.stringify(interaction));
    throw requestError(res.status, interaction);
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

  return finished(interaction, job.taskId);
}

function finished(interaction: Interaction, taskId: string): SongStatus {
  switch (interaction.status) {
    case "completed": {
      const audio = audioOf(interaction);
      if (!audio?.data) {
        console.error("lyria finished without audio", taskId, JSON.stringify(interaction.error ?? {}));
        return { status: "failed" };
      }
      // Lyria reports no length; the app reads it off the file.
      return { status: "succeeded", audioData: audio.data, mimeType: audio.mime_type, duration: null };
    }
    case "failed":
    case "cancelled":
    case "incomplete":
    case "requires_action":
      console.error("lyria interaction ended without a song", taskId, interaction.status,
        JSON.stringify(interaction.error ?? {}));
      return { status: "failed" };
    default:
      // in_progress, queued
      return { status: "pending" };
  }
}
