// Whether a caller has Premium, from Adapty's server-side API: the apps
// identify every install in Adapty by its Supabase user id (anonymous
// sign-in), and the id asked about here is the one in the caller's token, so
// nobody can borrow someone else's Premium. Each app has its own Adapty apps,
// production and staging (Debug and TestFlight builds buy from staging), with
// their secret keys in LINGO_<APP>_ADAPTY_SECRET_KEY and
// LINGO_<APP>_ADAPTY_STAGING_SECRET_KEY. Production is asked for everyone;
// staging only for a build that says it is one (x-lingo-build: staging), so a
// free sandbox purchase never opens lessons on an App Store build that doesn't
// claim to be a test build. (Lyncil's song-quota.ts does the same.)
//
// When Adapty can't answer — no key set, unreachable, an error — the caller
// counts as having Premium: a paying learner is never locked out of lessons
// by an outage, and the error is logged.

import { LingoApp } from "./apps.ts";

const FN = "lingo/premium";
const ACCESS_LEVEL = "premium";

export function isStagingBuild(req: Request): boolean {
  return req.headers.get("x-lingo-build") === "staging";
}

export function adaptyKeys(app: LingoApp, stagingBuild: boolean): string[] {
  const prefix = `LINGO_${app.id.toUpperCase()}_ADAPTY`;
  return [
    Deno.env.get(`${prefix}_SECRET_KEY`),
    stagingBuild ? Deno.env.get(`${prefix}_STAGING_SECRET_KEY`) : undefined,
  ].filter((key): key is string => !!key);
}

interface AccessLevel {
  access_level_id: string;
  expires_at?: string | null;
}

export async function hasPremium(app: LingoApp, userId: string, stagingBuild: boolean): Promise<boolean> {
  const keys = adaptyKeys(app, stagingBuild);
  if (keys.length === 0) {
    console.error(JSON.stringify({ level: "error", fn: FN, event: "no_adapty_key", app: app.id }));
    return true;
  }
  const now = new Date();
  for (const key of keys) {
    try {
      const res = await fetch("https://api.adapty.io/api/v2/server-side-api/profile/", {
        headers: { Authorization: `Api-Key ${key}`, "adapty-customer-user-id": userId },
      });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`profile returned ${res.status}`);
      const body = await res.json();
      const levels: AccessLevel[] = body?.data?.access_levels ?? [];
      if (levels.some((level) =>
        level.access_level_id === ACCESS_LEVEL && (!level.expires_at || new Date(level.expires_at) > now)
      )) return true;
    } catch (error) {
      console.error(JSON.stringify({ level: "error", fn: FN, event: "adapty_failed", app: app.id, error: `${error}` }));
      return true;
    }
  }
  return false;
}
