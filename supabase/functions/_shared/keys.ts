// The project's API keys, as hosted Supabase hands them to edge functions.
//
// SUPABASE_PUBLISHABLE_KEYS and SUPABASE_SECRET_KEYS hold the new keys as JSON, {"<name>": "<key>"};
// the function uses the one named "default". The legacy SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are signed with the legacy JWT secret and stop working once the
// dashboard disables legacy API keys, so they are only a fallback (the local stack may provide no
// new keys), and every fallback is logged: a function still logging it in production is not ready
// for that switch.

function namedKey(variable: string): string | undefined {
  const raw = Deno.env.get(variable);
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return raw;
  }
}

function keyOrLegacy(variable: string, legacy: string): string {
  const key = namedKey(variable);
  if (key) return key;
  console.warn(`${variable} is not set; using the legacy ${legacy}`);
  return Deno.env.get(legacy)!;
}

/** For calls made with the caller's own token: the apikey the gateway wants. */
export function publishableKey(): string {
  return keyOrLegacy("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
}

/** Bypasses row-level security: only for server-side work that no caller's token covers. */
export function secretKey(): string {
  return keyOrLegacy("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
}
