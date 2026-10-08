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
//
// Lyrics the provider refuses to sing (LyricsBlockedError) mark their job
// failure = 'blocked' with a fingerprint of the words (lyrics_hash). Lyria's
// filter isn't consistent (the same lyrics refused in production made a song
// on the next try, 2026-10-07), so one refusal blocks nothing. Over a sliding
// 24 hours, 3 refusals of the same lyrics, or 10 of anything for one user,
// get 422 lyrics_blocked at once without another provider call; a try opens
// up again as the oldest refusal ages out.
//
// Every failed job says why (failure, plus the provider's words in error),
// including starts the provider never took, which are kept as failed rows
// instead of being deleted; failed rows never count against the allowance.
// A sync Lyria song that was refused, cut off with its worker or lost gets
// one more go by itself: the app's next poll finds it failed, puts it back to
// pending and makes it again on whichever worker answered, so the app just
// keeps waiting. A refusal isn't billed; a cut-off may be (Lyria can finish
// a song nobody was left to receive), so a retry costs at most one more song.
// On 2026-10-07 every user who tried again by hand after one of these got a
// song.

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
  LyricsBlockedError,
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
/// Goes a sync Lyria song gets in all: the first and one retry.
const LYRIA_SYNC_ATTEMPTS = 2;
/// Failures another go can fix: Lyria's filter isn't consistent, and a
/// worker shutting down says nothing about the song.
const RETRIED_FAILURES = ["blocked", "cut_off", "lost"];
const MAX_ERROR = 500;
const MAX_LYRICS = 5000;
const MAX_FIELD = 100;
/// A song still being made after this long is treated as abandoned, so a new
/// start for the same song makes a new track instead of waiting on it.
const PENDING_REUSE_MINUTES = 15;
/// Refusals over this many hours count towards the two limits below.
const REFUSAL_WINDOW_HOURS = 24;
/// Refusals of the same lyrics before they're turned away.
const REFUSALS_PER_LYRICS = 3;
/// Refusals of any lyrics before the user is turned away, so editing a word
/// at a time can't keep sending refused prompts on our API key.
const REFUSALS_PER_USER = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKS_BUCKET = "lyncil-tracks";
/// Long enough to download a few megabytes on a slow connection.
const SIGNED_URL_SECONDS = 60 * 60;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

/// Sync Lyria songs this worker is making right now. When the runtime shuts
/// the worker down (wall clock, CPU, memory) their work dies with it and
/// nothing would ever finish their jobs, so they're marked failed on the way
/// out instead of sitting pending until LYRIA_SYNC_GIVE_UP_MINUTES. Best
/// effort: the worker may go before the update lands, and the give-up in
/// song-status still covers that.
const songsInWork = new Set<string>();

addEventListener("beforeunload", (event) => {
  if (songsInWork.size === 0) return;
  const taskIds = [...songsInWork];
  const reason = String((event as CustomEvent).detail?.reason ?? "unknown");
  console.error("lyria songs cut off", reason, taskIds.join(", "));
  sql`
    update lyncil.song_jobs
    set status = 'failed', failure = 'cut_off', error = ${`worker shut down: ${reason}`},
      request = case when attempts < ${LYRIA_SYNC_ATTEMPTS} then request end
    where task_id in ${sql(taskIds)} and status = 'pending'`
    .catch((error) => console.error("cut-off songs not marked failed", error));
});

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/// What a failed song's job records about why.
function failureOf(error: unknown): { failure: string; error: string } {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, MAX_ERROR);
  if (error instanceof LyricsBlockedError) return { failure: "blocked", error: message };
  if (error instanceof Error && error.name === "TimeoutError") return { failure: "timeout", error: message };
  return { failure: "error", error: message };
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

/// The words a song is sung with, as a fingerprint: blocked lyrics are
/// matched by it, and any edit makes a new one.
async function lyricsHash(lyrics: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lyrics));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    set status = 'succeeded', audio_path = ${path}, audio_duration = ${status.duration}, request = null
    where task_id = ${taskId} and status <> 'succeeded'
    returning task_id`;
  if (flipped.length > 0) notifyInBackground(userId, songId);
  return path;
}

/// A sync Lyria song, made after generate-song has answered (or after
/// song-status put a failed one back, `retrySyncSong`): one long call, then
/// the track goes to the bucket. A failure marks the job failed with why,
/// which also gives the slot in the allowance back. The request it was made
/// from stays on the job only while a retry is still to come.
async function makeLyriaSong(
  req: Request,
  input: SongInput,
  userId: string,
  taskId: string,
  songId: string | null,
): Promise<void> {
  const started = Date.now();
  songsInWork.add(taskId);
  try {
    const status = await renderLyria(input, AbortSignal.timeout(LYRIA_SYNC_LIMIT_SECONDS * 1000));
    if (status.status !== "succeeded") throw new Error(`Lyria answered ${status.status}`);
    const storage = createSupabaseClient(req).storage.from(TRACKS_BUCKET);
    await keepTrack(storage, status, userId, taskId, songId);
    console.log("lyria song kept", taskId, `${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (error) {
    console.error("lyria song failed", taskId, `${((Date.now() - started) / 1000).toFixed(1)} s`, error);
    const { failure, error: message } = failureOf(error);
    const retriable = RETRIED_FAILURES.includes(failure);
    await sql`
      update lyncil.song_jobs
      set status = 'failed', failure = ${failure}, error = ${message},
        request = case when ${retriable} and attempts < ${LYRIA_SYNC_ATTEMPTS} then request end
      where task_id = ${taskId}`;
  } finally {
    songsInWork.delete(taskId);
  }
}

/// Puts a sync Lyria song that failed in a way another go can fix
/// (RETRIED_FAILURES) back to pending and makes it again, in the background
/// of this request, at most once per job; whether it did. The update is the
/// claim, so of two polls arriving together only one starts the retry. This
/// request's token writes the track, as the first go's did.
async function retrySyncSong(req: Request, userId: string, taskId: string): Promise<boolean> {
  const claimed = await sql`
    update lyncil.song_jobs
    set status = 'pending', retried_after = failure, failure = null, error = null,
      attempts = attempts + 1, attempt_started_at = now()
    where task_id = ${taskId} and user_id = ${userId} and status = 'failed'
      and attempts < ${LYRIA_SYNC_ATTEMPTS} and failure in ${sql(RETRIED_FAILURES)}
      and request is not null
    returning song_id, request, retried_after`;
  if (claimed.length === 0) return false;
  const row = claimed[0];
  console.log("lyria song retried", taskId, row.retried_after);
  EdgeRuntime.waitUntil(makeLyriaSong(req, row.request as SongInput, userId, taskId, row.song_id as string | null));
  return true;
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
  const hash = kind === "song" ? await lyricsHash(input.lyrics) : null;
  const [refusals] = await sql`
    select count(*)::int as by_user,
      count(*) filter (where lyrics_hash = ${hash})::int as by_lyrics
    from lyncil.song_jobs
    where user_id = ${userId} and provider = ${provider} and failure = 'blocked'
      and created_at > now() - make_interval(hours => ${REFUSAL_WINDOW_HOURS})`;
  if (refusals.by_user >= REFUSALS_PER_USER || refusals.by_lyrics >= REFUSALS_PER_LYRICS) {
    return json({ error: "lyrics_blocked" }, 422);
  }
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
            and coalesce(attempt_started_at, created_at) < now() - make_interval(mins => ${LYRIA_SYNC_GIVE_UP_MINUTES}))
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
      insert into lyncil.song_jobs (task_id, user_id, kind, provider, song_id, lyrics_hash)
      values (${reservation}, ${userId}, ${kind}, ${provider}, ${songId}, ${hash})`;
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
    // The request stays on the job so a retry (retrySyncSong) can make it again.
    await sql`
      update lyncil.song_jobs
      set task_id = ${taskId}, request = ${sql.json(input as unknown as Parameters<typeof sql.json>[0])},
        attempt_started_at = now()
      where task_id = ${reservation}`;
    EdgeRuntime.waitUntil(makeLyriaSong(req, input, userId, taskId, songId));
    return json({ taskId });
  }

  let task: StartedTask;
  try {
    task = provider === "google" ? await startLyria(input) : await startMureka(input);
  } catch (error) {
    console.error("song start failed", provider, error);
    // Kept as a failed job: no slot taken, and the reason stays on record.
    // A refusal also counts towards turning the same lyrics away next time.
    const busy = error instanceof ProviderBusyError;
    const { failure, error: message } = failureOf(error);
    await sql`
      update lyncil.song_jobs
      set status = 'failed', failure = ${failure === "blocked" ? "blocked" : busy ? "busy" : "start_failed"},
        error = ${message}
      where task_id = ${reservation}`;
    if (failure === "blocked") return json({ error: "lyrics_blocked" }, 422);
    // The app shows 503 as its "busy, try again in a minute" popup.
    return json({ error: "Song generation unavailable" }, busy ? 503 : 502);
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
      select task_id, kind, provider, song_id, audio_path, audio_duration, status, failure, created_at, attempt_started_at
      from lyncil.song_jobs
      where task_id = ${taskId} and user_id = ${userId}`
    : await sql`
      select task_id, kind, provider, song_id, audio_path, audio_duration, status, failure, created_at, attempt_started_at
      from lyncil.song_jobs
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
    const attemptStarted = (row.attempt_started_at ?? row.created_at) as Date;
    const lost = row.status === "pending" &&
      Date.now() - attemptStarted.getTime() > LYRIA_SYNC_GIVE_UP_MINUTES * 60_000;
    if (lost) {
      console.error("lyria song lost", job.taskId);
      await sql`
        update lyncil.song_jobs
        set status = 'failed', failure = 'lost', error = 'no word from the worker',
          request = case when attempts < ${LYRIA_SYNC_ATTEMPTS} then request end
        where task_id = ${job.taskId} and status = 'pending'`;
    }
    if (lost || row.status === "failed") {
      // Only the app waiting on this very task sets off the retry: it keeps
      // polling, so it sees the song through.
      if (taskId && await retrySyncSong(req, userId, job.taskId)) {
        return json({ status: "pending", taskId: job.taskId });
      }
      // `reason: blocked` tells an app that knows it to ask for different
      // words rather than another try; the other reasons are for its
      // analytics, and older apps ignore them all.
      const failure = lost ? "lost" : row.failure as string | null;
      const reason = failure ? { reason: failure } : {};
      return taskId ? json({ status: "failed", taskId: job.taskId, ...reason }) : json({ status: "none" });
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
    await sql`
      update lyncil.song_jobs set status = 'failed', failure = 'error', error = 'the provider ended the task without a song'
      where task_id = ${job.taskId}`;
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
