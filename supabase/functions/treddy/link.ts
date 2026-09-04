// Registers a Threads account for autoposting. The app calls this right
// after sign-in with the long-lived token it just received; the token is the
// proof of ownership — we verify it against /me before storing anything.
// Returns the sync secret the app uses as its bearer credential for /sync,
// plus everything the server already knows about the account: the stored
// settings (null until the user completed onboarding on some device) and
// the posts it holds. The app uses the settings to tell a returning user
// from a new one, and the posts to avoid wiping a returning user's queue
// with its first, empty sync.
//
// Older app builds sent their settings inline here; that still works, but
// current builds push them explicitly via /settings once setup is complete,
// so signing in to an existing account never overwrites its brief with the
// app's defaults.

import { json, sql } from "./db.ts";
import { fetchProfile, ThreadsAPIError } from "./threads-api.ts";
import { upsertDevice } from "./sync.ts";
import { parseSettings, saveSettings } from "./settings.ts";

const TOKEN_LIFETIME_DAYS = 59;

export async function handleLink(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const token = body?.access_token;
  if (typeof token !== "string" || token.length === 0) {
    return json({ error: "access_token is required" }, 400);
  }

  let profile: { id: string; username: string };
  try {
    profile = await fetchProfile(token);
  } catch (error) {
    const status = error instanceof ThreadsAPIError && error.isAuthError ? 401 : 502;
    return json({ error: "Threads rejected the token" }, status);
  }

  const rows = await sql`
    insert into treddy.accounts (threads_user_id, username, access_token, token_expires_at)
    values (
      ${profile.id},
      ${profile.username},
      ${token},
      now() + make_interval(days => ${TOKEN_LIFETIME_DAYS})
    )
    on conflict (threads_user_id) do update set
      username = excluded.username,
      access_token = excluded.access_token,
      token_expires_at = excluded.token_expires_at,
      needs_reauth = false,
      updated_at = now()
    returning sync_secret, settings`;

  await upsertDevice(profile.id, body);

  let settings = parseSettings(rows[0].settings);
  const inline = parseSettings(body?.settings);
  if (inline) {
    await saveSettings(profile.id, inline);
    settings = inline;
  }

  const posts = await sql`
    select id, text, scheduled_at, status, error
    from treddy.posts
    where threads_user_id = ${profile.id}
    order by scheduled_at`;

  return json({
    sync_secret: rows[0].sync_secret,
    threads_user_id: profile.id,
    username: profile.username,
    settings,
    posts,
  });
}
