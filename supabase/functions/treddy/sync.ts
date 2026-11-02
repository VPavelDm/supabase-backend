// Merges a device's drafts into treddy.posts and hands back the account's
// whole state. One account may live on several devices and one device may
// hold several accounts, so no device is the source of truth: the server is.
// Content and schedule merge last-write-wins on the device's edit time;
// publish outcomes are the server's alone; deletions are tombstones so a
// device that still holds a deleted post drops it instead of reviving it.
//
// Request (bearer = sync secret from /link):
//   { posts: [{id, text, follow_ups?, part_media_ids?, scheduled_at, status,
//              edited_at}],
//                       — every draft the device holds except unapproved
//                         proposals; status: scheduled | published | deleted
//     device_token?, environment?, locale? }
// Response:
//   { posts: [{id, text, follow_ups, part_media_ids, scheduled_at, status,
//              error, edited_at}],
//                       — every row the server holds, tombstones included.
//                         follow_ups go out after text, each answering the
//                         one before; part_media_ids are the Threads IDs of
//                         the chain's posts that already went out.
//     settings }        — the stored setup, null when the account has none:
//                         the device must send the user through the setup
//                         questions again.

import { json, sql } from "./db.ts";
import { accountForBearer, parseSettings } from "./settings.ts";

const MAX_POSTS = 500;
const MAX_TEXT_LENGTH = 500; // Threads' own limit, per post of a chain.
const MAX_FOLLOW_UPS = 10;
const DEVICE_STATUSES = new Set(["scheduled", "published", "deleted"]);

interface IncomingPost {
  id: string;
  text: string;
  follow_ups?: string[];
  part_media_ids?: string[];
  scheduled_at: string;
  status: "scheduled" | "published" | "deleted";
  edited_at: string;
}

function isUUID(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isPostText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function validPost(post: unknown): post is IncomingPost {
  const p = post as IncomingPost;
  const followUps = p?.follow_ups ?? [];
  const partMediaIDs = p?.part_media_ids ?? [];
  return isUUID(p?.id) &&
    isPostText(p.text) &&
    Array.isArray(followUps) && followUps.length <= MAX_FOLLOW_UPS &&
    followUps.every(isPostText) &&
    Array.isArray(partMediaIDs) && partMediaIDs.length <= MAX_FOLLOW_UPS + 1 &&
    partMediaIDs.every((id) => typeof id === "string" && id.length > 0) &&
    isTimestamp(p.scheduled_at) &&
    DEVICE_STATUSES.has(p.status) &&
    isTimestamp(p.edited_at);
}

/// Shared with /link: remembers where to send the posted/failed pushes.
export async function upsertDevice(
  threadsUserID: string,
  body: Record<string, unknown> | null,
): Promise<void> {
  const token = body?.device_token;
  if (typeof token !== "string" || token.length === 0) return;
  const environment = body?.environment === "sandbox" ? "sandbox" : "production";
  const locale = typeof body?.locale === "string" ? body.locale.slice(0, 16) : "en";
  await sql`
    insert into treddy.devices (device_token, threads_user_id, environment, locale)
    values (${token}, ${threadsUserID}, ${environment}, ${locale})
    on conflict (device_token) do update set
      threads_user_id = excluded.threads_user_id,
      environment = excluded.environment,
      locale = excluded.locale,
      updated_at = now()`;
}

export async function handleSync(req: Request): Promise<Response> {
  const account = await accountForBearer(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const userID = account.threads_user_id;

  const body = await req.json().catch(() => null);
  const incoming: IncomingPost[] = Array.isArray(body?.posts)
    ? body.posts.filter(validPost).slice(0, MAX_POSTS)
    : [];

  const posts = await sql.begin(async (tx) => {
    for (const post of incoming) {
      // A row the publisher has claimed or finished is its own: a device
      // may only mark it published (it posted by hand) or deleted; never
      // back to scheduled. Tombstones never come back to life. Between
      // devices, the newer edit wins — a stale copy changes nothing. What
      // went out of a chain only ever grows: the longer record wins, so
      // neither the device nor the autoposter posts a part again.
      const publishedAt = post.status === "published" ? new Date() : null;
      const followUps = post.follow_ups ?? [];
      const partMediaIDs = post.part_media_ids ?? [];
      await tx`
        insert into treddy.posts
          (id, threads_user_id, text, follow_ups, part_media_ids, published_media_id,
           scheduled_at, status, edited_at, published_at)
        values (
          ${post.id}, ${userID}, ${post.text}, ${sql.json(followUps)}, ${sql.json(partMediaIDs)},
          ${partMediaIDs[0] ?? null}, ${post.scheduled_at},
          ${post.status}, ${post.edited_at}, ${publishedAt}
        )
        on conflict (id) do update set
          text = excluded.text,
          follow_ups = excluded.follow_ups,
          part_media_ids = case
            when jsonb_array_length(excluded.part_media_ids) > jsonb_array_length(treddy.posts.part_media_ids)
            then excluded.part_media_ids
            else treddy.posts.part_media_ids
          end,
          published_media_id = coalesce(treddy.posts.published_media_id, excluded.published_media_id),
          scheduled_at = excluded.scheduled_at,
          status = excluded.status,
          error = null,
          edited_at = excluded.edited_at,
          published_at = coalesce(treddy.posts.published_at, excluded.published_at),
          updated_at = now()
        where treddy.posts.threads_user_id = ${userID}
          and treddy.posts.status not in ('publishing', 'deleted')
          and (treddy.posts.status <> 'published'
               or excluded.status in ('published', 'deleted'))
          and excluded.edited_at > treddy.posts.edited_at`;
    }

    return await tx`
      select id, text, follow_ups, part_media_ids, scheduled_at, status, error, edited_at
      from treddy.posts
      where threads_user_id = ${userID}
      order by scheduled_at`;
  });

  await upsertDevice(userID, body);

  return json({ posts, settings: parseSettings(account.settings) });
}
