// Mureka (platform.mureka.ai): poll-only. A task is started, then queried
// until it succeeds; the finished track stays on Mureka's CDN for 30 days and
// the app downloads it from there.
//
// Secrets: LYNCIL_MUREKA_API_KEY (MUREKA_API_KEY as a project-wide
// fallback), LYNCIL_MUREKA_MODEL (optional).

import { ProviderBusyError, SongInput, SongJob, SongStatus, StartedTask } from "./song-provider.ts";

const MUREKA_URL = "https://api.mureka.ai";
// mureka-9 is $0.045 a song; mureka-9.5 is $0.15.
const MODEL = Deno.env.get("LYNCIL_MUREKA_MODEL") ?? "mureka-9";
const MAX_PROMPT = 1024;

interface MurekaTask {
  id?: string;
  status?: string;
  failed_reason?: string;
  choices?: { url?: string; duration?: number }[];
}

/// "pop, emotional, female vocal": the only say the app's pickers have over
/// the sound.
function stylePrompt(input: SongInput): string {
  const vocal = input.voice === "instrumental" ? "instrumental" : `${input.voice} vocal`;
  return [input.genre, input.mood, vocal]
    .filter((part) => part.length > 0)
    .join(", ")
    .toLowerCase()
    .slice(0, MAX_PROMPT);
}

async function mureka(path: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = Deno.env.get("LYNCIL_MUREKA_API_KEY") ??
    Deno.env.get("MUREKA_API_KEY");
  if (!apiKey) throw new Error("Missing Mureka API key");
  return await fetch(`${MUREKA_URL}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

export async function startMureka(input: SongInput): Promise<StartedTask> {
  const prompt = stylePrompt(input);
  const res = input.voice === "instrumental"
    ? await mureka("/v1/instrumental/generate", {
      method: "POST",
      body: JSON.stringify({ model: MODEL, n: 1, prompt }),
    })
    : await mureka("/v1/song/generate", {
      method: "POST",
      body: JSON.stringify({
        lyrics: input.lyrics,
        model: MODEL,
        // Mureka defaults to 2 and bills per song; the app keeps one.
        n: 1,
        prompt,
        gender: input.voice,
      }),
    });

  const task = await res.json().catch(() => ({})) as MurekaTask;
  if (!res.ok || typeof task.id !== "string") {
    console.error("mureka start failed", res.status, JSON.stringify(task));
    // Mureka sells concurrency per top-up; a 429 means every slot is busy.
    if (res.status === 429) throw new ProviderBusyError();
    throw new Error(`Mureka returned ${res.status}`);
  }
  return { taskId: task.id };
}

export async function queryMureka(job: SongJob): Promise<SongStatus> {
  const res = await mureka(`/v1/${job.kind}/query/${encodeURIComponent(job.taskId)}`);
  const task = await res.json().catch(() => ({})) as MurekaTask;
  if (!res.ok) {
    console.error("mureka query failed", res.status, JSON.stringify(task));
    throw new Error(`Mureka returned ${res.status}`);
  }

  switch (task.status) {
    case "succeeded": {
      const track = task.choices?.[0];
      if (!track?.url) {
        console.error("mureka succeeded without a track", job.taskId);
        return { status: "failed" };
      }
      return {
        status: "succeeded",
        audioUrl: track.url,
        // Mureka reports milliseconds; the app keeps seconds.
        duration: typeof track.duration === "number" ? track.duration / 1000 : null,
      };
    }
    case "failed":
    case "timeouted":
    case "cancelled":
      console.error("mureka task ended without a song", job.taskId, task.status, task.failed_reason);
      return { status: "failed" };
    default:
      // preparing, queued, running, streaming
      return { status: "pending" };
  }
}
