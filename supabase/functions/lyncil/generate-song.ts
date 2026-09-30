// Lyrics to a sung track. A song takes a minute or two, longer than an edge
// function may hold a request open (150 s), so this is two routes:
//
//   generate-song  starts a task with the provider and returns its id at once
//   song-status    asks where that task is; the app polls it every few seconds
//
// Two providers sit behind the same routes, picked on the server by
// LYNCIL_SONG_PROVIDER: "mureka" (default, mureka.ts) or "google" (Lyria,
// lyria.ts). Each task is written to lyncil.song_jobs with its user, its
// provider and the Lyncil song it belongs to, so a caller only ever polls
// their own tasks, a task is always polled with the provider that started it
// (flipping the secret mid-song is safe), and the daily cap counts real
// starts.
//
// A song stays converted: every finished track, whichever provider made it,
// is kept in the private lyncil-tracks bucket as <user id>/<song id>.<ext>
// and handed to the app as a one-hour signed URL; the phone keeps a copy.
// When the app finds a song without its file (it left the screen
// mid-generation, the download failed, a reinstall, a new phone) it asks
// song-status by song id and gets the stored track again, or learns it is
// still being made.
//
// The artist the lyrics were "inspired by" never reaches the audio prompt: it
// shaped the writing, and a voice likeness is not ours to ask for.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callerUserId, isAppCall } from "./auth.ts";
import { queryLyria, startLyria } from "./lyria.ts";
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

// Songs cost real money per call, unlike a lyrics call, so the cap is far
// tighter than generate-lyrics' 100.
const DAILY_CAP = 10;
const MAX_LYRICS = 5000;
const MAX_FIELD = 100;
/// A song still being made after this long is treated as abandoned, so a new
/// start for the same song makes a new track instead of waiting on it.
const PENDING_REUSE_MINUTES = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKS_BUCKET = "lyncil-tracks";
/// Long enough to download a few megabytes on a slow connection.
const SIGNED_URL_SECONDS = 60 * 60;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function voice(value: unknown): Voice {
  return value === "female" || value === "instrumental" ? value : "male";
}

function configuredProvider(): Provider {
  return Deno.env.get("LYNCIL_SONG_PROVIDER") === "google" ? "google" : "mureka";
}

/// Signed URLs are built from SUPABASE_URL, which under `supabase start` is
/// the Docker-internal http://kong:8000 that a simulator can't reach. Local
/// runs set LYNCIL_PUBLIC_SUPABASE_URL (http://127.0.0.1:54321) to swap the
/// origin; production leaves it unset and the URL passes through untouched.
function publicUrl(url: string): string {
  const base = Deno.env.get("LYNCIL_PUBLIC_SUPABASE_URL");
  if (!base) return url;
  const signed = new URL(url);
  const origin = new URL(base);
  signed.protocol = origin.protocol;
  signed.host = origin.host;
  return signed.toString();
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/// The finished track's bytes and type, whichever way the provider gave it:
/// inline (Lyria) or as a link (Mureka's CDN, which forgets it after 30 days).
async function trackBytes(status: Extract<SongStatus, { status: "succeeded" }>): Promise<{
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}> {
  if (status.audioData) {
    const wav = status.mimeType === "audio/wav";
    return {
      bytes: decodeBase64(status.audioData),
      contentType: wav ? "audio/wav" : "audio/mpeg",
      extension: wav ? "wav" : "mp3",
    };
  }
  if (!status.audioUrl) throw new Error("Succeeded without audio");
  const res = await fetch(status.audioUrl);
  if (!res.ok) throw new Error(`Track download returned ${res.status}`);
  const extension = new URL(status.audioUrl).pathname.split(".").pop()?.toLowerCase() ?? "mp3";
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
    extension: ["mp3", "wav", "flac", "m4a"].includes(extension) ? extension : "mp3",
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
  const songId = uuid(body.songId);

  // The same song is already being made (the user left and came back, or
  // tapped again): hand back that task rather than paying for a second one.
  if (songId) {
    const running = await sql`
      select task_id from lyncil.song_jobs
      where user_id = ${userId} and song_id = ${songId} and status = 'pending'
        and created_at > now() - make_interval(mins => ${PENDING_REUSE_MINUTES})
      order by created_at desc limit 1`;
    if (running.length > 0) return json({ taskId: running[0].task_id });
  }

  if (!await underDailyCap(userId)) {
    return json({ error: "Daily song limit reached" }, 429);
  }

  const provider = configuredProvider();
  let task: StartedTask;
  try {
    task = provider === "google" ? await startLyria(input) : await startMureka(input);
  } catch (error) {
    console.error("song start failed", provider, error);
    // The app shows 503 as its "busy, try again in a minute" popup.
    return json({ error: "Song generation unavailable" }, error instanceof ProviderBusyError ? 503 : 502);
  }

  await sql`
    insert into lyncil.song_jobs (task_id, user_id, kind, provider, song_id)
    values (${task.taskId}, ${userId}, ${kind}, ${provider}, ${songId})`;

  return json({ taskId: task.taskId });
}

/// Where a task is, asked by `taskId` (the app waiting on the song it just
/// started) or by `songId` (the app opening a song whose track it doesn't
/// have). By song, a song with nothing to recover answers `none`.
export async function handleSongStatus(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const taskId = str(body?.taskId, 200);
  const songId = uuid(body?.songId);
  if (!taskId && !songId) return json({ error: "taskId or songId is required" }, 400);

  // By song: the newest task that hasn't failed; a finished one is as good
  // as a running one, since either ends with the track.
  const rows = taskId
    ? await sql`
      select task_id, kind, provider, song_id, audio_path, audio_duration from lyncil.song_jobs
      where task_id = ${taskId} and user_id = ${userId}`
    : await sql`
      select task_id, kind, provider, song_id, audio_path, audio_duration from lyncil.song_jobs
      where user_id = ${userId} and song_id = ${songId} and status <> 'failed'
      order by (audio_path is not null) desc, created_at desc limit 1`;
  if (rows.length === 0) {
    return taskId ? json({ error: "Unknown task" }, 404) : json({ status: "none" });
  }
  const row = rows[0];
  const job: SongJob = { taskId: row.task_id as string, kind: row.kind as Kind };
  // The caller's own token writes and signs, so the bucket's RLS keeps each
  // user inside their folder.
  const storage = createSupabaseClient(req).storage.from(TRACKS_BUCKET);

  async function signed(path: string, duration: number | null): Promise<Response> {
    const { data, error } = await storage.createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data) {
      console.error("track signing failed", path, error);
      return json({ error: "Song status unavailable" }, 502);
    }
    return json({ status: "succeeded", taskId: job.taskId, audioUrl: publicUrl(data.signedUrl), duration });
  }

  if (row.audio_path) return await signed(row.audio_path as string, row.audio_duration as number | null);

  let status: SongStatus;
  try {
    status = row.provider === "google" ? await queryLyria(job) : await queryMureka(job);
  } catch (error) {
    console.error("song status failed", row.provider, job.taskId, error);
    return json({ error: "Song status unavailable" }, 502);
  }

  if (status.status === "pending") return json({ status: "pending", taskId: job.taskId });
  if (status.status === "failed") {
    await sql`update lyncil.song_jobs set status = 'failed' where task_id = ${job.taskId}`;
    // A recovery by song has nothing to give; the app turns it back into lyrics.
    return taskId ? json({ status: "failed", taskId: job.taskId }) : json({ status: "none" });
  }

  let path: string;
  try {
    const track = await trackBytes(status);
    path = `${userId}/${(row.song_id as string | null) ?? job.taskId}.${track.extension}`;
    const { error } = await storage.upload(path, track.bytes, { contentType: track.contentType, upsert: true });
    if (error) throw error;
  } catch (error) {
    // The provider still has it; the next poll tries again.
    console.error("keeping the track failed", job.taskId, error);
    return json({ error: "Song status unavailable" }, 502);
  }
  await sql`
    update lyncil.song_jobs
    set status = 'succeeded', audio_path = ${path}, audio_duration = ${status.duration}
    where task_id = ${job.taskId}`;
  return await signed(path, status.duration);
}
