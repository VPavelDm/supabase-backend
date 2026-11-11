// The app's lessons: its trail and every lesson on it, built live from the
// lingo tables by lingo.content_bundle() (migration 20261111140000), so an
// edited row reaches learners at their next launch. The app calls this on a
// splash at every launch with the version of the bundle it has on disk and
// gets `unchanged` or the whole bundle, which it keeps for the launches when
// this cannot be reached. Like every other route: the app key says which
// app's content to send, and the caller must be a signed-in user.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { callerApp, callerUserId } from "./auth.ts";

const FN = "lingo/content";

/// A short fingerprint of the bundle: the same content gives the same
/// version (jsonb orders its keys), and any edit gives a new one.
async function versionOf(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function handleContent(req: Request): Promise<Response> {
  const app = await callerApp(req);
  if (!app) return json({ error: "Unauthorized" }, 401);
  if (!await callerUserId(req)) return json({ error: "Sign-in required" }, 401);

  const request = await req.json().catch(() => null) as Record<string, unknown> | null;
  const known = typeof request?.version === "string" ? request.version : null;

  const [row] = await sql<{ bundle: { trail: { chapters: unknown[] }; lessons: Record<string, unknown> } }[]>`
    select lingo.content_bundle(${app.id}) as bundle`;
  const bundle = row.bundle;
  if (bundle.trail.chapters.length === 0) {
    console.error(JSON.stringify({ level: "error", fn: FN, event: "no_content", app: app.id }));
    return json({ error: "No content" }, 404);
  }
  const version = await versionOf(JSON.stringify(bundle));
  if (known === version) return json({ version, unchanged: true });

  console.log(JSON.stringify({ fn: FN, event: "sent", app: app.id, version, lessons: Object.keys(bundle.lessons).length }));
  return json({ version, ...bundle });
}
