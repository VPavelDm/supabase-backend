// Mirrors the app's local drafts into treddy.posts and reports back what the
// server did with them. The app is the source of truth for content and
// schedule; the server is the source of truth for publish outcomes.
//
// Request (bearer = sync secret from /link):
//   { posts:      [{id, text, scheduled_at}],   — every locally scheduled draft
//     known_ids:  [uuid],                        — every draft the app still has
//     device_token?, environment?, locale? }
// Response: { posts: [{id, status, error, published_at}] }

import { json, sql } from "./db.ts";
import { accountForBearer } from "./settings.ts";

const MAX_POSTS = 500;
const MAX_TEXT_LENGTH = 500; // Threads' own limit.

interface IncomingPost {
  id: string;
  text: string;
  scheduled_at: string;
}

function isUUID(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validPost(post: unknown): post is IncomingPost {
  const p = post as IncomingPost;
  return isUUID(p?.id) &&
    typeof p.text === "string" && p.text.length > 0 &&
    p.text.length <= MAX_TEXT_LENGTH &&
    typeof p.scheduled_at === "string" &&
    !Number.isNaN(Date.parse(p.scheduled_at));
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
  const knownIDs: string[] = Array.isArray(body?.known_ids)
    ? body.known_ids.filter(isUUID).slice(0, MAX_POSTS * 2)
    : [];

  const statuses = await sql.begin(async (tx) => {
    // The server's pending set must mirror the app's scheduled set exactly:
    // a draft the app deleted (gone from known_ids) or that is no longer
    // scheduled there (published manually, back to proposed) must never be
    // autoposted. Rows already claimed or published are kept for known ids
    // so the app can learn their outcome.
    const incomingIDs = incoming.map((post) => post.id);
    await tx`
      delete from treddy.posts
      where threads_user_id = ${userID}
        and (
          not (id = any(${knownIDs}::uuid[]))
          or (status in ('scheduled', 'failed')
              and not (id = any(${incomingIDs}::uuid[])))
        )`;

    for (const post of incoming) {
      // Never downgrade a row the publisher already claimed or finished;
      // the app learns the real outcome from the response instead.
      await tx`
        insert into treddy.posts (id, threads_user_id, text, scheduled_at)
        values (${post.id}, ${userID}, ${post.text}, ${post.scheduled_at})
        on conflict (id) do update set
          text = excluded.text,
          scheduled_at = excluded.scheduled_at,
          status = 'scheduled',
          error = null,
          updated_at = now()
        where treddy.posts.threads_user_id = ${userID}
          and treddy.posts.status in ('scheduled', 'failed')`;
    }

    return await tx`
      select id, status, error, published_at
      from treddy.posts
      where threads_user_id = ${userID}`;
  });

  await upsertDevice(userID, body);

  return json({ posts: statuses });
}
