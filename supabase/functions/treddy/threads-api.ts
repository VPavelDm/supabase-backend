// Server-side Threads Graph API calls — the same endpoints the app uses,
// needed here so the cron jobs can publish and refresh without the app.

const GRAPH = "https://graph.threads.net/v1.0";

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
  url.searchParams.set("access_token", token);
  const body = await parseOrThrow(await fetch(url));
  return { id: String(body.id), username: String(body.username ?? "") };
}

/// Two-step publish: create a TEXT container, then publish it.
/// Returns the published media ID.
export async function publishPost(token: string, text: string): Promise<string> {
  const create = new URL(`${GRAPH}/me/threads`);
  create.searchParams.set("media_type", "TEXT");
  create.searchParams.set("text", text);
  create.searchParams.set("access_token", token);
  const container = await parseOrThrow(await fetch(create, { method: "POST" }));

  const publish = new URL(`${GRAPH}/me/threads_publish`);
  publish.searchParams.set("creation_id", String(container.id));
  publish.searchParams.set("access_token", token);

  // Meta sometimes needs a moment before a fresh container is publishable
  // ("media not ready"). Retrying the publish step is safe: it targets the
  // container we already created, so it can never produce a second post.
  for (let attempt = 1; ; attempt += 1) {
    try {
      const published = await parseOrThrow(await fetch(publish, { method: "POST" }));
      return String(published.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = /not ready|not available|try again|unknown error/i.test(message) ||
        (error instanceof ThreadsAPIError && error.code === null);
      if (error instanceof ThreadsAPIError && error.isAuthError) throw error;
      if (!transient || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
}

export async function refreshToken(
  token: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", token);
  const body = await parseOrThrow(await fetch(url));
  return {
    accessToken: String(body.access_token),
    expiresInSeconds: Number(body.expires_in ?? 60 * 60 * 24 * 60),
  };
}
