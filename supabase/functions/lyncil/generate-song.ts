// Lyrics to a sung track. A song takes a minute or two, longer than an edge
// function may hold a request open (150 s), so this is two routes:
//
//   generate-song  starts a task with the provider and returns its id at once
//   song-status    asks where that task is; the app polls it every few seconds
//
// Two providers sit behind the same routes, picked on the server by
// LYNCIL_SONG_PROVIDER: "mureka" (default, mureka.ts) or "google" (Lyria,
// lyria.ts). Each task is written to lyncil.song_jobs with its user and
// provider, so a caller only ever polls their own tasks, a task is always
// polled with the provider that started it (flipping the secret mid-song is
// safe), and the daily cap counts real starts.
//
// The artist the lyrics were "inspired by" never reaches the audio prompt: it
// shaped the writing, and a voice likeness is not ours to ask for.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callerUserId, isAppCall } from "./auth.ts";
import { queryLyria, startLyria, TrackStore } from "./lyria.ts";
import { queryMureka, startMureka } from "./mureka.ts";
import {
  Kind,
  Provider,
  ProviderBusyError,
  SongInput,
  SongJob,
  SongStatus,
  StartedTask,
  Voice,
} from "./song-provider.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// Songs cost real money per call, unlike a lyrics call, so the cap is far
// tighter than generate-lyrics' 100.
const DAILY_CAP = 10;
const MAX_LYRICS = 5000;
const MAX_FIELD = 100;
const TRACKS_BUCKET = "lyncil-tracks";
/// Long enough to download a few megabytes on a slow connection.
const SIGNED_URL_SECONDS = 60 * 60;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function voice(value: unknown): Voice {
  return value === "female" || value === "instrumental" ? value : "male";
}

function configuredProvider(): Provider {
  return Deno.env.get("LYNCIL_SONG_PROVIDER") === "google" ? "google" : "mureka";
}

/// Lyria's tracks live in Storage; the caller's own token does the writing
/// and signing, so the bucket's RLS keeps each user inside their folder.
function trackStore(req: Request): TrackStore {
  const storage = createSupabaseClient(req).storage.from(TRACKS_BUCKET);
  return {
    async upload(path, bytes, contentType) {
      const { error } = await storage.upload(path, bytes, { contentType, upsert: true });
      if (error) throw error;
    },
    async signedUrl(path) {
      const { data, error } = await storage.createSignedUrl(path, SIGNED_URL_SECONDS);
      if (error || !data) throw error ?? new Error("No signed URL");
      return data.signedUrl;
    },
    async finish(taskId, audioPath) {
      await sql`
        update lyncil.song_jobs
        set status = ${audioPath ? "succeeded" : "failed"}, audio_path = ${audioPath}
        where task_id = ${taskId}`;
    },
  };
}

/// Counts the tasks this user started in the last day. Read before a start,
/// written after the provider accepts it, so a failed start doesn't spend the
/// cap.
async function underDailyCap(userId: string): Promise<boolean> {
  const rows = await sql`
    select count(*)::int as count from lyncil.song_jobs
    where user_id = ${userId} and created_at > now() - interval '1 day'`;
  return Number(rows[0].count) < DAILY_CAP;
}

export async function handleGenerateSong(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "JSON body is required" }, 400);

  const input: SongInput = {
    lyrics: str(body.lyrics, MAX_LYRICS),
    genre: str(body.genre, MAX_FIELD),
    mood: str(body.mood, MAX_FIELD),
    voice: voice(body.voice),
  };
  const kind: Kind = input.voice === "instrumental" ? "instrumental" : "song";
  if (kind === "song" && !input.lyrics) return json({ error: "lyrics are required" }, 400);

  if (!await underDailyCap(userId)) {
    return json({ error: "Daily song limit reached" }, 429);
  }

  const provider = configuredProvider();
  let task: StartedTask;
  try {
    task = provider === "google"
      ? await startLyria(input, userId, trackStore(req))
      : await startMureka(input);
  } catch (error) {
    console.error("song start failed", provider, error);
    // The app shows 503 as its "busy, try again in a minute" popup.
    return json({ error: "Song generation unavailable" }, error instanceof ProviderBusyError ? 503 : 502);
  }

  await sql`
    insert into lyncil.song_jobs (task_id, user_id, kind, provider)
    values (${task.taskId}, ${userId}, ${kind}, ${provider})`;
  if (task.background) EdgeRuntime.waitUntil(task.background());

  return json({ taskId: task.taskId });
}

export async function handleSongStatus(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const taskId = str(body?.taskId, 200);
  if (!taskId) return json({ error: "taskId is required" }, 400);

  const rows = await sql`
    select kind, provider, status, audio_path from lyncil.song_jobs
    where task_id = ${taskId} and user_id = ${userId}`;
  if (rows.length === 0) return json({ error: "Unknown task" }, 404);
  const job: SongJob = {
    taskId,
    userId,
    kind: rows[0].kind as Kind,
    status: rows[0].status as SongJob["status"],
    audioPath: rows[0].audio_path as string | null,
  };

  let status: SongStatus;
  try {
    status = rows[0].provider === "google"
      ? await queryLyria(job, trackStore(req))
      : await queryMureka(job);
  } catch (error) {
    console.error("song status failed", rows[0].provider, taskId, error);
    return json({ error: "Song status unavailable" }, 502);
  }

  if (rows[0].provider === "mureka" && status.status !== "pending") {
    await sql`update lyncil.song_jobs set status = ${status.status} where task_id = ${taskId}`;
  }
  return json(status);
}
