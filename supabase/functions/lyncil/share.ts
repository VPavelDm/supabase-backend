// Share links: music.lyncil.com/s/<slug> plays a user's song to anyone with
// the link. Three routes:
//
//   share-song    the app, for a paid user: the song's link, made once and
//                 handed back on every later call
//   unshare-song  the app: stops the link; sharing again makes a new one
//   shared-song   the web page (the Lambda behind music.lyncil.com), never
//                 the app: the song as it is now, with a short-lived signed
//                 URL to its track
//
// A link points at the live song (lyncil.song_shares, see its migration):
// edits show, and a deleted song, a revoked link and a slug that never
// existed all answer the same 404, so a slug can't be probed for whether a
// song was ever behind it. A link outlives its owner's subscription — only
// making one needs a plan.
//
// shared-song answers only to LYNCIL_WEB_KEY (x-lyncil-web-key), a secret
// the Lambda holds and the app never ships. It hands out signed track URLs,
// so the extractable app key must not open it. The URL's path names the
// owner's user id (lyncil-tracks/<user id>/<song id>), so the Lambda streams
// the track itself and never gives the URL to a browser: two links carrying
// the same id would tell anyone they came from the same person.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { callerUserId, isAppCall, isWebCall } from "./auth.ts";
import { publicUrl, serviceStorage } from "./generate-song.ts";
import { planAllowance } from "./song-quota.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[A-Za-z0-9]{12}$/;
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/// The Lambda fetches the track with it right away, on a CloudFront miss;
/// it is never handed to a listener.
const TRACK_URL_SECONDS = 15 * 60;

function shareUrl(slug: string): string {
  const base = Deno.env.get("LYNCIL_SHARE_BASE_URL") ?? "https://music.lyncil.com";
  return `${base}/s/${slug}`;
}

/// 12 base62 characters from the CSPRNG. Bytes of 248 and up are skipped so
/// every character is equally likely (248 = 4 × 62).
function newSlug(): string {
  let slug = "";
  while (slug.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && slug.length < 12) slug += BASE62[byte % 62];
    }
  }
  return slug;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

// MARK: - Data

export type ShareResult = { slug: string } | { error: "not_found" | "no_track" };

/// The song's live link, made if it has none. Only the owner's own songs that
/// aren't deleted and have a finished track can be shared.
export async function createShare(userId: string, songId: string): Promise<ShareResult> {
  const songs = await sql`
    select exists (
      select 1 from lyncil.song_jobs j
      where j.song_id = s.id and j.user_id = s.user_id
        and j.status = 'succeeded' and j.audio_path is not null
    ) as has_track
    from lyncil.songs s
    where s.id = ${songId} and s.user_id = ${userId} and s.deleted_at is null`;
  if (songs.length === 0) return { error: "not_found" };
  if (!songs[0].has_track) return { error: "no_track" };

  for (let attempt = 0; attempt < 3; attempt++) {
    const live = await sql`
      select slug from lyncil.song_shares where song_id = ${songId} and revoked_at is null`;
    if (live.length > 0) return { slug: live[0].slug as string };
    // Any unique clash means another request shared the song first (or, once
    // in 2^71, the slug was taken): read again.
    const inserted = await sql`
      insert into lyncil.song_shares (slug, song_id, user_id)
      values (${newSlug()}, ${songId}, ${userId})
      on conflict do nothing
      returning slug`;
    if (inserted.length > 0) return { slug: inserted[0].slug as string };
  }
  throw new Error(`no share link for song ${songId} after 3 attempts`);
}

/// Stops the song's live link. False when there was none.
export async function revokeShare(userId: string, songId: string): Promise<boolean> {
  const rows = await sql`
    update lyncil.song_shares set revoked_at = now()
    where song_id = ${songId} and user_id = ${userId} and revoked_at is null
    returning slug`;
  return rows.length > 0;
}

export interface SharedSong {
  slug: string;
  title: string;
  lyrics: string;
  genre: string | null;
  duration: number | null;
  audioPath: string;
}

/// What the page shows, or null for a revoked link, a deleted song, or a slug
/// that never existed. The newest finished track is the one the app plays.
export async function sharedSong(slug: string): Promise<SharedSong | null> {
  const rows = await sql`
    select s.name, s.lyrics, s.genre, t.audio_path,
      coalesce(t.audio_duration, s.audio_duration) as duration
    from lyncil.song_shares sh
    join lyncil.songs s on s.id = sh.song_id and s.user_id = sh.user_id
    join lateral (
      select j.audio_path, j.audio_duration from lyncil.song_jobs j
      where j.song_id = s.id and j.user_id = s.user_id
        and j.status = 'succeeded' and j.audio_path is not null
      order by j.created_at desc
      limit 1
    ) t on true
    where sh.slug = ${slug} and sh.revoked_at is null and s.deleted_at is null`;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    slug,
    title: row.name as string,
    lyrics: row.lyrics as string,
    genre: (row.genre as string | null) ?? null,
    duration: row.duration === null ? null : Number(row.duration),
    audioPath: row.audio_path as string,
  };
}

// MARK: - Routes

/// POST share-song { songId } → { slug, url }. 403 without a plan.
export async function handleShareSong(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const songId = uuid(body?.songId);
  if (!songId) return json({ error: "songId is required" }, 400);

  let plan: string;
  try {
    plan = (await planAllowance(userId)).plan;
  } catch (error) {
    console.error("share: plan unavailable", error);
    return json({ error: "Plan unavailable" }, 503);
  }
  if (plan === "free") return json({ error: "Subscription required" }, 403);

  const result = await createShare(userId, songId);
  if ("error" in result) {
    return result.error === "not_found"
      ? json({ error: "Unknown song" }, 404)
      : json({ error: "Song has no track yet" }, 409);
  }
  return json({ slug: result.slug, url: shareUrl(result.slug) });
}

/// POST unshare-song { songId } → { revoked }. No plan needed to stop sharing.
export async function handleUnshareSong(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign-in required" }, 401);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const songId = uuid(body?.songId);
  if (!songId) return json({ error: "songId is required" }, 400);
  return json({ revoked: await revokeShare(userId, songId) });
}

/// GET shared-song?slug=… → { slug, title, lyrics, genre, duration, audioUrl }.
export async function handleSharedSong(req: Request): Promise<Response> {
  if (!await isWebCall(req)) return json({ error: "Unauthorized" }, 401);
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  if (!SLUG.test(slug)) return json({ error: "Not found" }, 404);

  const song = await sharedSong(slug);
  if (!song) return json({ error: "Not found" }, 404);

  const { data, error } = await serviceStorage().createSignedUrl(song.audioPath, TRACK_URL_SECONDS);
  if (error || !data) {
    console.error("share: track signing failed", song.audioPath, error);
    return json({ error: "Track unavailable" }, 502);
  }
  const { audioPath: _, ...page } = song;
  return json({ ...page, audioUrl: publicUrl(data.signedUrl) });
}
