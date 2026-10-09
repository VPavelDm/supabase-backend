// Who is calling a Lyncil route. Every route needs both: the app key baked
// into the binary (x-lyncil-app-key) and a signed-in Supabase user (the app
// signs every install in anonymously). generate-lyrics still carries its own
// copies of these two; move it over when that file is next touched.

import { createSupabaseClient } from "../_shared/supabase-client.ts";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/// Callers prove they're the app with the key shipped in the binary. Not a
/// user credential — it keeps the provider keys from being spendable by
/// anyone who reads the anon key out of the app.
export async function isAppCall(req: Request): Promise<boolean> {
  return await keyMatches(req.headers.get("x-lyncil-app-key"), Deno.env.get("LYNCIL_APP_KEY"));
}

/// The music.lyncil.com Lambda, with a key only it holds (LYNCIL_WEB_KEY).
/// Routes for the web page take this instead of the app key, which ships in
/// the binary and so can be read out of it.
export async function isWebCall(req: Request): Promise<boolean> {
  return await keyMatches(req.headers.get("x-lyncil-web-key"), Deno.env.get("LYNCIL_WEB_KEY"));
}

async function keyMatches(given: string | null, expected: string | undefined): Promise<boolean> {
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
