// Registers a Threads account for autoposting. The app calls this right
// after sign-in with the long-lived token it just received; the token is the
// proof of ownership — we verify it against /me before storing anything.
// Returns the sync secret the app uses as its bearer credential for /sync.
// The body may carry the user's generation settings so /generate can run
// server-side from then on.

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
    returning sync_secret`;

  await upsertDevice(profile.id, body);

  const settings = parseSettings(body?.settings);
  if (settings) await saveSettings(profile.id, settings);

  return json({
    sync_secret: rows[0].sync_secret,
    threads_user_id: profile.id,
    username: profile.username,
  });
}
