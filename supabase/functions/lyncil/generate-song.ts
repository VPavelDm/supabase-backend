// Lyrics to a sung track. A song takes a minute or two, longer than an edge
// function may hold a request open (150 s), so this is two routes:
//
//   generate-song  starts a task with the provider and returns its id at once
//   song-status    asks where that task is; the app polls it every few seconds
//
// Lyria in sync mode (lyria.ts) is the exception: generate-song answers the
// app at once and makes the song itself after the response, in the
// background, storing the track when Lyria hands it over. song-status then
// only reads lyncil.song_jobs for it and never asks Google.
//
// Two providers sit behind the same routes, picked on the server by
// LYNCIL_SONG_PROVIDER: "mureka" (default, mureka.ts) or "google" (Lyria,
// lyria.ts). Each task is written to lyncil.song_jobs with its user, its
// provider and the Lyncil song it belongs to, so a caller only ever polls
// their own tasks, a task is always polled with the provider that started it
// (flipping the secret mid-song is safe), and the song allowance per plan
// (song-quota.ts) counts real starts.
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
//
// Whoever flips a job to succeeded (song-status or the sync Lyria call)
// pushes "Your song is ready" (notify.ts); the flip is conditional, so a song
// pushes once. Mureka and background Lyria only finish when the app polls
// song-status, so they push only while the app is still waiting.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callerUserId, isAppCall } from "./auth.ts";
import { notifySongReady } from "./notify.ts";
import { lyriaPolls, queryLyria, renderLyria, startLyria } from "./lyria.ts";
import { queryMureka, startMureka } from "./mureka.ts";
import { Allowance, planAllowance, PlanUnavailableError, quotaFor } from "./song-quota.ts";
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

/// A reservation's placeholder task id, swapped for the provider's once the
/// provider accepts the song.
const RESERVED = "reserved:";
/// Task ids of Lyria songs this function makes itself (sync mode).
const LYRIA_SYNC = "lyria-sync:";
/// How long a sync Lyria call may take before it's abandoned. Background work
/// ends with the worker anyway (150 s wall clock on the free plan, 400 s on
/// paid), so this only matters on paid.
const LYRIA_SYNC_LIMIT_SECONDS = 300;
/// A sync song pending longer than this is taken as lost (the worker was
/// recycled mid-song) and reported failed, under the app's 6-minute timeout.
const LYRIA_SYNC_GIVE_UP_MINUTES = 5;
const MAX_LYRICS = 5000;
const MAX_FIELD = 100;
/// A song still being made after this long is treated as abandoned, so a new
/// start for the same song makes a new track instead of waiting on it.
const PENDING_REUSE_MINUTES = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKS_BUCKET = "lyncil-tracks";
/// Long enough to download a few megabytes on a slow connection.
const SIGNED_URL_SECONDS = 60 * 60;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

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

/// Staging builds (simulator, Xcode, TestFlight: the app's AppMode, sent as
/// x-lyncil-build) get one stored sample instead of a paid track, so building
/// the app doesn't spend the provider budget. Claiming to be staging only
/// ever buys the sample, never a free real song. LYNCIL_STAGING_SONGS=real
/// sends staging to the provider too, for when the real thing needs hearing.
/// The sample is uploaded once per project to lyncil-tracks/_staging/.
const STAGING_SAMPLE = "_staging/sample.mp3";

function serviceStorage() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
    .storage.from(TRACKS_BUCKET);
}

function wantsSample(req: Request): boolean {
  return req.headers.get("x-lyncil-build") === "staging" &&
    Deno.env.get("LYNCIL_STAGING_SONGS") !== "real";
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

/// Pushes in the background, so the push never holds up an answer and a
/// failed one never fails it.
function notifyInBackground(userId: string, songId: string | null): void {
  EdgeRuntime.waitUntil(
    notifySongReady(userId, songId).catch((error) => console.error("song ready push failed", error)),
  );
}

/// Stores a finished track as <user>/<song or task>.<ext> and records it on
/// its job; returns the stored path. The caller's own storage client, so the
/// bucket's RLS keeps each user inside their folder. The first caller to
/// record it sends the push.
async function keepTrack(
  storage: ReturnType<typeof serviceStorage>,
  status: Extract<SongStatus, { status: "succeeded" }>,
  userId: string,
  taskId: string,
  songId: string | null,
): Promise<string> {
  const track = await trackBytes(status);
  const path = `${userId}/${songId ?? taskId}.${track.extension}`;
  const { error } = await storage.upload(path, track.bytes, { contentType: track.contentType, upsert: true });
  if (error) throw error;
  const flipped = await sql`
    update lyncil.song_jobs
    set status = 'succeeded', audio_path = ${path}, audio_duration = ${status.duration}
    where task_id = ${taskId} and status <> 'succeeded'
    returning task_id`;
  if (flipped.length > 0) notifyInBackground(userId, songId);
  return path;
}

/// A sync Lyria song, made after generate-song has answered: one long call,
/// then the track goes to the bucket. A failure marks the job failed, which
/// also gives the slot in the allowance back.
async function makeLyriaSong(
  req: Request,
  input: SongInput,
  userId: string,
  taskId: string,
  songId: string | null,
): Promise<void> {
  const started = Date.now();
  try {
    const status = await renderLyria(input, AbortSignal.timeout(LYRIA_SYNC_LIMIT_SECONDS * 1000));
    if (status.status !== "succeeded") throw new Error(`Lyria answered ${status.status}`);
    const storage = createSupabaseClient(req).storage.from(TRACKS_BUCKET);
    await keepTrack(storage, status, userId, taskId, songId);
    console.log("lyria song kept", taskId, `${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (error) {
    console.error("lyria song failed", taskId, `${((Date.now() - started) / 1000).toFixed(1)} s`, error);
    await sql`update lyncil.song_jobs set status = 'failed' where task_id = ${taskId}`;
  }
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

  // The plan (song-quota.ts) is a network call to Adapty, so it's made
  // before the lock below, not while holding it.
  let allowance: Allowance;
  try {
    allowance = await planAllowance(userId);
  } catch (error) {
    if (!(error instanceof PlanUnavailableError)) throw error;
    console.error("song plan lookup failed", error);
    return json({ error: "Plan unavailable" }, 503);
  }

  // One start at a time per user: the count and the reservation happen under
  // a lock held for the transaction, so requests sent together can't all see
  // the last free slot. The reservation is a row that counts like any song
  // until the provider answers; the allowance is the only limit.
  const provider = wantsSample(req) ? "staging" : configuredProvider();
  const reservation = `${RESERVED}${crypto.randomUUID()}`;
  type Outcome = { reused: string } | { exhausted: Record<string, unknown> } | { busy: true } | null;
  const outcome: Outcome = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"lyncil-song:" + userId}))`;
    // The same song is already being made (the user left and came back, or
    // tapped again): hand back that task rather than paying for a second one.
    if (songId) {
      const running = await tx`
        select task_id from lyncil.song_jobs
        where user_id = ${userId} and song_id = ${songId} and status = 'pending'
          and created_at > now() - make_interval(mins => ${PENDING_REUSE_MINUTES})
          and not (task_id like ${LYRIA_SYNC + "%"}
            and created_at < now() - make_interval(mins => ${LYRIA_SYNC_GIVE_UP_MINUTES}))
        order by created_at desc limit 1`;
      if (running.length > 0) {
        const taskId = running[0].task_id as string;
        // Still being reserved by a request a moment ago: nothing to poll yet.
        return taskId.startsWith(RESERVED) ? { busy: true } : { reused: taskId };
      }
    }
    const quota = await quotaFor(allowance, userId, tx);
    if (quota.used >= quota.limit) return { exhausted: { ...quota } };
    // A job belongs to a profile; onboarding can get here before anything
    // else made one.
    await tx`select lyncil.ensure_profile(${userId}::uuid)`;
    await tx`
      insert into lyncil.song_jobs (task_id, user_id, kind, provider, song_id)
      values (${reservation}, ${userId}, ${kind}, ${provider}, ${songId})`;
    return null;
  });
  if (outcome && "reused" in outcome) return json({ taskId: outcome.reused });
  if (outcome && "busy" in outcome) return json({ error: "Song generation unavailable" }, 503);
  if (outcome && "exhausted" in outcome) return json({ error: "quota_exhausted", ...outcome.exhausted }, 429);

  if (provider === "staging") {
    // Finished the moment it starts: the first poll finds the sample.
    const taskId = `staging:${crypto.randomUUID()}`;
    await sql`
      update lyncil.song_jobs set task_id = ${taskId}, status = 'succeeded', audio_path = ${STAGING_SAMPLE}
      where task_id = ${reservation}`;
    notifyInBackground(userId, songId);
    return json({ taskId });
  }

  if (provider === "google" && !lyriaPolls()) {
    const taskId = `${LYRIA_SYNC}${crypto.randomUUID()}`;
    await sql`update lyncil.song_jobs set task_id = ${taskId} where task_id = ${reservation}`;
    EdgeRuntime.waitUntil(makeLyriaSong(req, input, userId, taskId, songId));
    return json({ taskId });
  }

  let task: StartedTask;
  try {
    task = provider === "google" ? await startLyria(input) : await startMureka(input);
  } catch (error) {
    console.error("song start failed", provider, error);
    // Nothing was made, so the slot goes back.
    await sql`delete from lyncil.song_jobs where task_id = ${reservation}`;
    // The app shows 503 as its "busy, try again in a minute" popup.
    return json({ error: "Song generation unavailable" }, error instanceof ProviderBusyError ? 503 : 502);
  }

  await sql`update lyncil.song_jobs set task_id = ${task.taskId} where task_id = ${reservation}`;
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
      select task_id, kind, provider, song_id, audio_path, audio_duration, status, created_at from lyncil.song_jobs
      where task_id = ${taskId} and user_id = ${userId}`
    : await sql`
      select task_id, kind, provider, song_id, audio_path, audio_duration, status, created_at from lyncil.song_jobs
      where user_id = ${userId} and song_id = ${songId} and status <> 'failed'
      order by (audio_path is not null) desc, created_at desc limit 1`;
  if (rows.length === 0) {
    return taskId ? json({ error: "Unknown task" }, 404) : json({ status: "none" });
  }
  const row = rows[0];
  // A start still waiting on the provider: no task to ask about yet.
  if ((row.task_id as string).startsWith(RESERVED)) return json({ status: "pending" });
  const job: SongJob = { taskId: row.task_id as string, kind: row.kind as Kind };
  // The caller's own token writes and signs, so the bucket's RLS keeps each
  // user inside their folder. The staging sample sits outside every user's
  // folder and is signed with the service role instead.
  const storage = createSupabaseClient(req).storage.from(TRACKS_BUCKET);

  async function signed(path: string, duration: number | null): Promise<Response> {
    const signer = path === STAGING_SAMPLE ? serviceStorage() : storage;
    const { data, error } = await signer.createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data) {
      console.error("track signing failed", path, error);
      return json({ error: "Song status unavailable" }, 502);
    }
    return json({ status: "succeeded", taskId: job.taskId, audioUrl: publicUrl(data.signedUrl), duration });
  }

  if (row.audio_path) return await signed(row.audio_path as string, row.audio_duration as number | null);

  // A song this function is making itself: the job row is all there is.
  if (job.taskId.startsWith(LYRIA_SYNC)) {
    const lost = row.status === "pending" &&
      Date.now() - (row.created_at as Date).getTime() > LYRIA_SYNC_GIVE_UP_MINUTES * 60_000;
    if (lost) {
      console.error("lyria song lost", job.taskId);
      await sql`update lyncil.song_jobs set status = 'failed' where task_id = ${job.taskId} and status = 'pending'`;
    }
    if (lost || row.status === "failed") {
      return taskId ? json({ status: "failed", taskId: job.taskId }) : json({ status: "none" });
    }
    return json({ status: "pending", taskId: job.taskId });
  }

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
    path = await keepTrack(storage, status, userId, job.taskId, row.song_id as string | null);
  } catch (error) {
    // The provider still has it; the next poll tries again.
    console.error("keeping the track failed", job.taskId, error);
    return json({ error: "Song status unavailable" }, 502);
  }
  return await signed(path, status.duration);
}
