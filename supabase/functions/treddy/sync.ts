// Merges a device's drafts into treddy.posts and hands back the account's
// whole state. One account may live on several devices and one device may
// hold several accounts, so no device is the source of truth: the server is.
// Content and schedule merge last-write-wins on the device's edit time;
// publish outcomes are the server's alone; deletions are tombstones so a
// device that still holds a deleted post drops it instead of reviving it.
//
// Request (bearer = sync secret from /link):
//   { posts: [{id, text, scheduled_at, status, edited_at}],
//                       — every draft the device holds except unapproved
//                         proposals; status: scheduled | published | deleted
//     device_token?, environment?, locale? }
// Response:
//   { posts: [{id, text, scheduled_at, status, error, edited_at}],
//                       — every row the server holds, tombstones included
//     settings }        — the stored setup, null when the account has none:
//                         the device must send the user through the setup
//                         questions again.

import { json, sql } from "./db.ts";
import { accountForBearer, parseSettings } from "./settings.ts";

const MAX_POSTS = 500;
const MAX_TEXT_LENGTH = 500; // Threads' own limit.
const DEVICE_STATUSES = new Set(["scheduled", "published", "deleted"]);

interface IncomingPost {
  id: string;
  text: string;
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

function validPost(post: unknown): post is IncomingPost {
  const p = post as IncomingPost;
  return isUUID(p?.id) &&
    typeof p.text === "string" && p.text.length > 0 &&
    p.text.length <= MAX_TEXT_LENGTH &&
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
      // devices, the newer edit wins — a stale copy changes nothing.
      const publishedAt = post.status === "published" ? new Date() : null;
      await tx`
        insert into treddy.posts
          (id, threads_user_id, text, scheduled_at, status, edited_at, published_at)
        values (
          ${post.id}, ${userID}, ${post.text}, ${post.scheduled_at},
          ${post.status}, ${post.edited_at}, ${publishedAt}
        )
        on conflict (id) do update set
          text = excluded.text,
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
      select id, text, scheduled_at, status, error, edited_at
      from treddy.posts
      where threads_user_id = ${userID}
      order by scheduled_at`;
  });

  await upsertDevice(userID, body);

  return json({ posts, settings: parseSettings(account.settings) });
}
