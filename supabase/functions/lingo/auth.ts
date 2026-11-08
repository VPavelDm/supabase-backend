// Who is calling a Lingo route. Every route needs both: a key baked into one
// of the apps' binaries (x-lingo-app-key), which also says which app is
// calling, and a signed-in Supabase user (the apps sign every install in
// anonymously). The daily caps are per user, which a reinstall doesn't
// reset: the anonymous session lives in the Keychain and comes back.

import { sql } from "../_shared/db.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { APPS, LingoApp } from "./apps.ts";

export const APP_KEY_HEADER = "x-lingo-app-key";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/// The app behind the key in x-lingo-app-key, or null when no app's secret
/// matches. Each app has its own secret (LINGO_HUTARKA_APP_KEY,
/// LINGO_HEJKA_APP_KEY, …); an app whose secret is unset cannot call yet. Not
/// a user credential — it keeps the ElevenLabs key from being spendable by
/// anyone who reads the publishable key out of an app.
export async function callerApp(req: Request): Promise<LingoApp | null> {
  const given = req.headers.get(APP_KEY_HEADER);
  if (!given) return null;
  const givenHash = await sha256(given);
  for (const app of Object.values(APPS)) {
    const expected = Deno.env.get(`LINGO_${app.id.toUpperCase()}_APP_KEY`);
    if (expected && await sha256(expected) === givenHash) return app;
  }
  return null;
}

/// The user behind the bearer token, or null when there is none, it is the
/// publishable key rather than a user token, or the auth server rejects it.
export async function callerUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const { data, error } = await createSupabaseClient(req).auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

export interface Usage {
  count: number;
  characters: number;
}

/// Adds one call and `characters` to today's counters, both the user's and
/// the app's as a whole, and returns the new totals of each.
export async function recordUsage(
  app: string,
  userId: string,
  route: string,
  characters = 0,
): Promise<{ user: Usage; app: Usage }> {
  const rows = await sql`
    insert into lingo.ai_usage (app, caller, route, day, count, characters)
    values (${app}, ${`user:${userId}`}, ${route}, current_date, 1, ${characters}),
           (${app}, 'app', ${route}, current_date, 1, ${characters})
    on conflict (app, caller, route, day) do update set
      count = lingo.ai_usage.count + 1,
      characters = lingo.ai_usage.characters + excluded.characters
    returning caller, count, characters`;
  const usage = (caller: string): Usage => {
    const row = rows.find((r) => r.caller === caller);
    return { count: Number(row?.count ?? 0), characters: Number(row?.characters ?? 0) };
  };
  return { user: usage(`user:${userId}`), app: usage("app") };
}
