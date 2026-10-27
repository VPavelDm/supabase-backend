// Who is calling an Affirmations route. Every route needs both: the app key
// baked into the binary (x-affirmations-app-key) and a signed-in Supabase
// user (the app signs every install in anonymously). The daily caps are per
// user, which a reinstall doesn't reset: the anonymous session lives in the
// Keychain and comes back.

import { sql } from "../_shared/db.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/// Callers prove they're the app with the key shipped in the binary. Not a
/// user credential — it keeps the OpenAI and ElevenLabs keys from being
/// spendable by anyone who reads the anon key out of the app.
export async function isAppCall(req: Request): Promise<boolean> {
  const expected = Deno.env.get("AFFIRMATIONS_APP_KEY");
  const given = req.headers.get("x-affirmations-app-key");
  if (!expected || !given) return false;
  return (await sha256(given)) === (await sha256(expected));
}

/// The user behind the bearer token, or null when there is none, it is the
/// anon key rather than a user token, or the auth server rejects it.
export async function callerUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const { data, error } = await createSupabaseClient(req).auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/// Adds one call and `characters` to the user's count for today and returns
/// the new totals.
export async function recordUsage(
  userId: string,
  route: string,
  characters = 0,
): Promise<{ count: number; characters: number }> {
  const rows = await sql`
    insert into affirmations.ai_usage (caller, route, day, count, characters)
    values (${`user:${userId}`}, ${route}, current_date, 1, ${characters})
    on conflict (caller, route, day) do update set
      count = affirmations.ai_usage.count + 1,
      characters = affirmations.ai_usage.characters + excluded.characters
    returning count, characters`;
  return { count: Number(rows[0].count), characters: Number(rows[0].characters) };
}
