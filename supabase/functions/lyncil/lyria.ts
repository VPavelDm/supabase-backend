// Google Lyria through the Gemini Interactions API
// (ai.google.dev/gemini-api/docs/music-generation). $0.08 a song on
// lyria-3.5, no prepaid tiers; capacity is the project's rate limit in AI
// Studio. Lyria hands the track back inline as base64 rather than as a link,
// so it is kept in the private `lyncil-tracks` bucket under the user's folder
// and the app gets a short-lived signed URL.
//
// A task is started in background mode and polled with interactions.get. The
// Lyria docs only show synchronous calls, so if Google refuses `background`
// for this model the route falls back to one synchronous call that keeps
// running after the response (EdgeRuntime.waitUntil) and writes the file
// itself; song-status then just waits for the job row to say it's there.
//
// Secrets: LYNCIL_GEMINI_API_KEY (GEMINI_API_KEY as a project-wide
// fallback), LYNCIL_LYRIA_MODEL (optional).
//
// Gemini API terms bar apps "likely to be accessed by individuals under the
// age of 18"; clear that before this goes past testing.

import { SongInput, SongJob, SongStatus, StartedTask } from "./song-provider.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = Deno.env.get("LYNCIL_LYRIA_MODEL") ?? "lyria-3.5";
/// Prefix for tasks run synchronously in the background, so song-status knows
/// there is no Google interaction to ask about.
const SYNC_PREFIX = "sync-";

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

/// Where a finished Lyria track is kept, bound to the caller's own token so
/// storage RLS keeps each user in their folder.
export interface TrackStore {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  signedUrl(path: string): Promise<string>;
  /// Marks the job finished with the stored path, or failed with null.
  finish(taskId: string, audioPath: string | null): Promise<void>;
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

function extensionFor(mimeType: string | undefined): string {
  return mimeType === "audio/wav" ? "wav" : "mp3";
}

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keep(
  interaction: Interaction,
  taskId: string,
  userId: string,
  store: TrackStore,
): Promise<string | null> {
  const audio = audioOf(interaction);
  if (!audio?.data) {
    console.error("lyria finished without audio", taskId, JSON.stringify(interaction.error ?? {}));
    return null;
  }
  const extension = extensionFor(audio.mime_type);
  const path = `${userId}/${taskId}.${extension}`;
  await store.upload(path, decode(audio.data), extension === "wav" ? "audio/wav" : "audio/mpeg");
  return path;
}

export async function startLyria(input: SongInput, userId: string, store: TrackStore): Promise<StartedTask> {
  const body = { model: MODEL, input: prompt(input) };
  const res = await gemini("/interactions", {
    method: "POST",
    body: JSON.stringify({ ...body, background: true }),
  });
  const interaction = await res.json().catch(() => ({})) as Interaction;
  if (res.ok && typeof interaction.id === "string") {
    return { taskId: interaction.id };
  }
  if (res.status !== 400) {
    console.error("lyria start failed", res.status, JSON.stringify(interaction));
    throw new Error(`Gemini returned ${res.status}`);
  }

  // Background mode refused: make the one synchronous call after the
  // response has gone out.
  console.warn("lyria background mode refused, running synchronously", JSON.stringify(interaction.error ?? {}));
  const taskId = `${SYNC_PREFIX}${crypto.randomUUID()}`;
  return {
    taskId,
    background: async () => {
      try {
        const res = await gemini("/interactions", { method: "POST", body: JSON.stringify(body) });
        const done = await res.json().catch(() => ({})) as Interaction;
        if (!res.ok) {
          console.error("lyria sync call failed", res.status, JSON.stringify(done));
          await store.finish(taskId, null);
          return;
        }
        await store.finish(taskId, await keep(done, taskId, userId, store));
      } catch (error) {
        console.error("lyria sync call threw", error);
        await store.finish(taskId, null);
      }
    },
  };
}

export async function queryLyria(job: SongJob, store: TrackStore): Promise<SongStatus> {
  if (job.audioPath) {
    // Lyria reports no length; the app reads it off the file.
    return { status: "succeeded", audioUrl: await store.signedUrl(job.audioPath), duration: null };
  }
  if (job.status === "failed") return { status: "failed" };
  if (job.taskId.startsWith(SYNC_PREFIX)) return { status: "pending" };

  const res = await gemini(`/interactions/${encodeURIComponent(job.taskId)}`);
  const interaction = await res.json().catch(() => ({})) as Interaction;
  if (!res.ok) {
    console.error("lyria query failed", res.status, JSON.stringify(interaction));
    throw new Error(`Gemini returned ${res.status}`);
  }

  switch (interaction.status) {
    case "completed": {
      const path = await keep(interaction, job.taskId, job.userId, store);
      await store.finish(job.taskId, path);
      if (!path) return { status: "failed" };
      return { status: "succeeded", audioUrl: await store.signedUrl(path), duration: null };
    }
    case "failed":
    case "cancelled":
    case "incomplete":
    case "requires_action":
      console.error("lyria interaction ended without a song", job.taskId, interaction.status,
        JSON.stringify(interaction.error ?? {}));
      await store.finish(job.taskId, null);
      return { status: "failed" };
    default:
      // in_progress, queued
      return { status: "pending" };
  }
}
