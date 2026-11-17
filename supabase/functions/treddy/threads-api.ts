// Server-side Threads Graph API calls — the same endpoints the app uses,
// needed here so the cron jobs can publish and refresh without the app.

const GRAPH = "https://graph.threads.net/v1.0";

/// The token goes in a header, never the URL: URLs end up in logs.
function authorized(token: string, method = "GET"): RequestInit {
  return { method, headers: { Authorization: `Bearer ${token}` } };
}

/// Threads wraps failures as {error: {message, code}}; code 190 means the
/// token is dead and the account needs a fresh sign-in.
export class ThreadsAPIError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message);
  }
  get isAuthError(): boolean {
    return this.code === 190;
  }
}

async function parseOrThrow(res: Response): Promise<Record<string, unknown>> {
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const error = body?.error ?? {};
  throw new ThreadsAPIError(
    String(error.message ?? `Threads returned ${res.status}`),
    typeof error.code === "number" ? error.code : null,
  );
}

export async function fetchProfile(
  token: string,
): Promise<{ id: string; username: string }> {
  const url = new URL(`${GRAPH}/me`);
  url.searchParams.set("fields", "id,username");
  const body = await parseOrThrow(await fetch(url, authorized(token)));
  return { id: String(body.id), username: String(body.username ?? "") };
}

/// Meta needs a moment before something it just took from us is usable,
/// and says so in two ways: the container isn't ready yet, or — while it is
/// still propagating — that the resource doesn't exist at all. The second
/// wording is what most failed autoposts turn out to be.
const NOT_READY_YET = /not ready|not available|try again|does not exist|unknown error/i;

function isTransient(error: unknown): boolean {
  if (error instanceof ThreadsAPIError && error.isAuthError) return false;
  const message = error instanceof Error ? error.message : String(error);
  return NOT_READY_YET.test(message) ||
    (error instanceof ThreadsAPIError && error.code === null);
}

/// Repeats one publish step while Meta says what it needs isn't there yet,
/// pausing longer before each attempt.
async function retryingWhileNotReady<T>(step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await step();
    } catch (error) {
      if (!isTransient(error) || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
}

/// Two-step publish: create a TEXT container, then publish it.
/// Returns the published media ID.
/// Publishes one text post; with `replyToID` it answers that post, which is
/// how a chain's posts hang one under the other.
export async function publishPost(
  token: string,
  text: string,
  replyToID: string | null = null,
): Promise<string> {
  const create = new URL(`${GRAPH}/me/threads`);
  create.searchParams.set("media_type", "TEXT");
  create.searchParams.set("text", text);
  if (replyToID) create.searchParams.set("reply_to_id", replyToID);
  // A container publishes nothing on its own, so this step may be retried
  // freely; an abandoned container expires on Meta's side.
  const container = await retryingWhileNotReady(async () =>
    await parseOrThrow(await fetch(create, authorized(token, "POST")))
  );

  const publish = new URL(`${GRAPH}/me/threads_publish`);
  publish.searchParams.set("creation_id", String(container.id));

  // Retrying the publish step is safe: it targets the container we already
  // created, so it can never produce a second post.
  const published = await retryingWhileNotReady(async () =>
    await parseOrThrow(await fetch(publish, authorized(token, "POST")))
  );
  return String(published.id);
}

export async function refreshToken(
  token: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  const body = await parseOrThrow(await fetch(url, authorized(token)));
  return {
    accessToken: String(body.access_token),
    expiresInSeconds: Number(body.expires_in ?? 60 * 60 * 24 * 60),
  };
}

// MARK: - Reading the user's own posts and their numbers (the MCP stats tool)

export interface OwnPost {
  id: string;
  text: string;
  timestamp: string;
  permalink: string | null;
  media_type: string;
  is_quote_post: boolean;
}

/// The user's own top-level posts since `since`, newest first, at most
/// `limit` of them. Replies (and so the follow-ups of a chain) aren't here:
/// Threads lists those under /me/replies.
export async function fetchOwnPosts(token: string, since: Date, limit: number): Promise<OwnPost[]> {
  const posts: OwnPost[] = [];
  let after: string | null = null;
  while (posts.length < limit) {
    const url = new URL(`${GRAPH}/me/threads`);
    url.searchParams.set("fields", "id,text,timestamp,permalink,media_type,is_quote_post");
    url.searchParams.set("since", String(Math.floor(since.getTime() / 1000)));
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const body = await parseOrThrow(await fetch(url, authorized(token)));
    const page = Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
    for (const item of page) {
      posts.push({
        id: String(item.id),
        text: typeof item.text === "string" ? item.text : "",
        timestamp: String(item.timestamp ?? ""),
        permalink: typeof item.permalink === "string" ? item.permalink : null,
        media_type: String(item.media_type ?? ""),
        is_quote_post: item.is_quote_post === true,
      });
    }
    const paging = body.paging as { next?: string; cursors?: { after?: string } } | undefined;
    after = paging?.next ? paging.cursors?.after ?? null : null;
    if (!after || page.length === 0) break;
  }
  return posts.slice(0, limit);
}

/// Reads `{data: [{name, values: [{value}]} | {name, total_value: {value}}]}`
/// into name → number; a series (one value per day) is summed.
function insightNumbers(body: Record<string, unknown>): Record<string, number> {
  const numbers: Record<string, number> = {};
  for (const item of Array.isArray(body.data) ? body.data as Record<string, unknown>[] : []) {
    const name = String(item.name);
    const total = (item.total_value as { value?: unknown } | undefined)?.value;
    if (typeof total === "number") {
      numbers[name] = total;
    } else if (Array.isArray(item.values)) {
      numbers[name] = (item.values as { value?: unknown }[])
        .reduce((sum, entry) => sum + (typeof entry.value === "number" ? entry.value : 0), 0);
    }
  }
  return numbers;
}

export const POST_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;

/// Lifetime numbers of one of the user's posts (needs threads_manage_insights).
export async function fetchPostInsights(token: string, mediaID: string): Promise<Record<string, number>> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(mediaID)}/insights`);
  url.searchParams.set("metric", POST_METRICS.join(","));
  return insightNumbers(await parseOrThrow(await fetch(url, authorized(token))));
}

/// Account-wide numbers between two times: `views` here is profile views,
/// and the others count interactions on any of the user's posts during the
/// window, old ones included.
export async function fetchAccountInsights(
  token: string,
  since: Date,
  until: Date,
): Promise<Record<string, number>> {
  const url = new URL(`${GRAPH}/me/threads_insights`);
  url.searchParams.set("metric", "views,likes,replies,reposts,quotes");
  url.searchParams.set("since", String(Math.floor(since.getTime() / 1000)));
  url.searchParams.set("until", String(Math.floor(until.getTime() / 1000)));
  return insightNumbers(await parseOrThrow(await fetch(url, authorized(token))));
}

/// Today's follower count; this metric takes no time range.
export async function fetchFollowerCount(token: string): Promise<number | null> {
  const url = new URL(`${GRAPH}/me/threads_insights`);
  url.searchParams.set("metric", "followers_count");
  const numbers = insightNumbers(await parseOrThrow(await fetch(url, authorized(token))));
  return numbers.followers_count ?? null;
}
