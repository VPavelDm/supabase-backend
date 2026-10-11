// Song outcomes from the backend to Amplitude, so failures can be analysed
// next to the app's own events: every app version is covered (the app only
// learned to report reasons in a later release), and the provider's own
// error, which the app never sees, comes along.
//
//   backend_song_finished  a track was stored
//   backend_song_failed    a go failed: failure (blocked, cut_off, lost,
//                          timeout, error, start_failed, busy), error_code
//                          ("400 invalid_request", "402", "prohibited_content"),
//                          error (shortened), will_retry
//
// user_id is the Supabase user id, the same string the app gives Amplitude
// (UserIdentity.swift), so these land on the user's own timeline. Lyrics
// never leave the database; only their length is sent. The insert_id makes
// a repeated report of the same outcome (song-status can see a failure more
// than once) count once. Staging samples aren't reported. Without
// LYNCIL_AMPLITUDE_API_KEY (the production project's key, the one in the
// app's LyncilAppDelegate) nothing is sent.

import { sql } from "../_shared/db.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const ENDPOINT = "https://api2.amplitude.com/2/httpapi";
const MAX_ERROR = 200;

/// Matches what failureOf and the providers write: "Error: Gemini returned 400
/// invalid_request: …", "LyricsBlockedError: Lyria blocked the lyrics:
/// prohibited_content", "Error: Mureka returned 429".
function errorCode(error: string | null): string | null {
  if (!error) return null;
  const blocked = error.match(/blocked the lyrics: (\w+)/);
  if (blocked) return blocked[1];
  const returned = error.match(/returned (\d{3})(?: (\w+))?/);
  if (returned) return returned[2] ? `${returned[1]} ${returned[2]}` : returned[1];
  return null;
}

async function send(taskId: string, retriedFailures: string[], maxAttempts: number): Promise<void> {
  const key = Deno.env.get("LYNCIL_AMPLITUDE_API_KEY");
  if (!key) return;
  const rows = await sql`
    select j.user_id, j.provider, j.kind, j.status, j.failure, j.error, j.attempts, j.retried_after,
      j.task_id, j.song_id, extract(epoch from now() - coalesce(j.attempt_started_at, j.created_at)) as seconds,
      length(s.lyrics) as lyrics_chars, s.genre, s.mood, s.voice,
      nullif(trim(s.artist), '') is not null as artist_chosen
    from lyncil.song_jobs j left join lyncil.songs s on s.id = j.song_id
    where j.task_id = ${taskId}`;
  const row = rows[0];
  if (!row || row.provider === "staging" || row.status === "pending") return;

  const failed = row.status === "failed";
  const willRetry = failed && (row.task_id as string).startsWith("lyria-sync:") &&
    retriedFailures.includes(row.failure as string) && Number(row.attempts) < maxAttempts;
  const properties: Record<string, unknown> = {
    provider: row.provider,
    kind: row.kind,
    attempt: Number(row.attempts),
    retried_after: row.retried_after ?? "none",
    seconds: Math.round(Number(row.seconds)),
    lyrics_chars: row.lyrics_chars === null ? null : Number(row.lyrics_chars),
    genre: row.genre ?? "none",
    mood: row.mood ?? "none",
    voice: row.voice ?? "none",
    artist_chosen: row.artist_chosen ?? false,
    task_id: row.task_id,
    song_id: row.song_id,
  };
  if (failed) {
    properties.failure = row.failure ?? "unknown";
    properties.error_code = errorCode(row.error as string | null) ?? "none";
    properties.error = ((row.error as string | null) ?? "").slice(0, MAX_ERROR);
    properties.will_retry = willRetry;
  }

  // A poll waits on this before a retry, so a slow Amplitude can't hold it long.
  const res = await fetch(ENDPOINT, {
    signal: AbortSignal.timeout(5000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      events: [{
        user_id: row.user_id,
        event_type: failed ? "backend_song_failed" : "backend_song_finished",
        insert_id: `${row.task_id}:${row.attempts}:${row.status}:${row.failure ?? ""}`,
        time: Date.now(),
        platform: "backend",
        event_properties: properties,
      }],
    }),
  });
  if (!res.ok) console.error("amplitude song event failed", res.status, (await res.text()).slice(0, 200));
}

/// Reports where a finished or failed task ended up, in the background: a
/// failed report never fails the request. Awaiting the returned promise is
/// for a caller about to change the row (a retry puts it back to pending).
export function reportSongOutcome(taskId: string, retriedFailures: string[], maxAttempts: number): Promise<void> {
  const sending = send(taskId, retriedFailures, maxAttempts)
    .catch((error) => console.error("amplitude song event failed", error));
  EdgeRuntime.waitUntil(sending);
  return sending;
}
