// The app's lessons: its trail and every lesson file, as published to
// lingo.lesson_content from content/lingo/<app>/ (publish.ts). The app asks
// on a splash at every launch with the version it has on disk and gets
// either `unchanged` or the whole bundle; the bundle on disk is its fallback
// when this cannot be reached. Like every other route: the app key says
// which app's content to send, and the caller must be a signed-in user.

import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { callerApp, callerUserId } from "./auth.ts";

const FN = "lingo/content";
const TRAIL_ID = "trail";

/// A short fingerprint of an app's published rows: the same rows give the
/// same version on every call, and any published change gives a new one.
async function versionOf(rows: { id: string; checksum: string }[]): Promise<string> {
  const joined = rows.map((row) => `${row.id}:${row.checksum}`).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joined));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function handleContent(req: Request): Promise<Response> {
  const app = await callerApp(req);
  if (!app) return json({ error: "Unauthorized" }, 401);
  if (!await callerUserId(req)) return json({ error: "Sign-in required" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const known = typeof body?.version === "string" ? body.version : null;

  const index = await sql<{ id: string; checksum: string }[]>`
    select id, checksum from lingo.lesson_content where app = ${app.id} order by id`;
  if (!index.some((row) => row.id === TRAIL_ID)) {
    console.error(JSON.stringify({ level: "error", fn: FN, event: "no_content", app: app.id }));
    return json({ error: "No content published" }, 404);
  }
  const version = await versionOf(index);
  if (known === version) return json({ version, unchanged: true });

  const rows = await sql<{ id: string; body: unknown }[]>`
    select id, body from lingo.lesson_content where app = ${app.id}`;
  const lessons: Record<string, unknown> = {};
  let trail: unknown = null;
  for (const row of rows) {
    if (row.id === TRAIL_ID) trail = row.body;
    else lessons[row.id] = row.body;
  }
  console.log(JSON.stringify({ fn: FN, event: "sent", app: app.id, version, lessons: rows.length - 1 }));
  return json({ version, trail, lessons });
}
