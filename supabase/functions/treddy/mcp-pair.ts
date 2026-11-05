// The app's side of the MCP connector's login and its "Assistants" list.
// All routes take the sync secret as bearer, so whatever the user approves
// is tied to the account signed in on that phone.
//
//   POST   mcp-pair/lookup   {code} → {pairing_id, client_name, verified_host,
//                                       redirect_host}
//          — 404 for an unknown or expired code, 429 after too many misses
//   POST   mcp-pair/approve  {pairing_id, allow} → {ok}
//   GET    mcp-grants        → {grants: [{id, client_name, verified_host,
//                                         created_at, last_used_at}]}
//   DELETE mcp-grants        {id} (or ?id=) → {ok, dismissed}
//          — revokes the grant and turns its pending suggestions into
//            tombstones, so one tap undoes whatever it sent

import { json, sql } from "./db.ts";
import { accountForBearer } from "./settings.ts";
import { dailyCount, isUUID, withinDailyCap } from "./mcp-auth.ts";

/// Wrong codes an account may enter per day. Codes are 6 characters from 32
/// and live for 10 minutes, so guessing someone else's is hopeless anyway;
/// the cap keeps it that way.
const MAX_MISSES_PER_DAY = 10;

export async function handlePairLookup(req: Request): Promise<Response> {
  const account = await accountForBearer(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const missKey = `mcp-pair-miss:${account.threads_user_id}`;
  if ((await dailyCount(missKey)) >= MAX_MISSES_PER_DAY) {
    return json({ error: "Too many attempts" }, 429);
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string"
    ? body.code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)
    : "";
  const rows = code.length === 6
    ? await sql`
      select p.id, p.redirect_uri, c.client_name, c.verified_host
      from treddy.mcp_pairings p
      join treddy.mcp_clients c on c.client_id = p.client_id
      where p.user_code = ${code} and p.status = 'pending' and p.expires_at > now()`
    : [];
  if (rows.length === 0) {
    await withinDailyCap(missKey, MAX_MISSES_PER_DAY);
    return json({ error: "Unknown or expired code" }, 404);
  }
  return json({
    pairing_id: rows[0].id,
    client_name: rows[0].client_name,
    verified_host: rows[0].verified_host,
    redirect_host: new URL(rows[0].redirect_uri).host,
  });
}

export async function handlePairApprove(req: Request): Promise<Response> {
  const account = await accountForBearer(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  if (!isUUID(body?.pairing_id) || typeof body?.allow !== "boolean") {
    return json({ error: "pairing_id and allow are required" }, 400);
  }
  const rows = await sql`
    update treddy.mcp_pairings
    set status = ${body.allow ? "approved" : "denied"},
        threads_user_id = ${account.threads_user_id}
    where id = ${body.pairing_id} and status = 'pending' and expires_at > now()
    returning id`;
  if (rows.length === 0) return json({ error: "Unknown or expired code" }, 404);
  return json({ ok: true });
}

export async function handleListGrants(req: Request): Promise<Response> {
  const account = await accountForBearer(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const grants = await sql`
    select g.id, c.client_name, c.verified_host, g.created_at, g.last_used_at
    from treddy.mcp_grants g
    join treddy.mcp_clients c on c.client_id = g.client_id
    where g.threads_user_id = ${account.threads_user_id}
      and g.revoked_at is null
      and g.refresh_expires_at > now()
    order by g.created_at desc`;
  return json({ grants });
}

export async function handleRevokeGrant(req: Request): Promise<Response> {
  const account = await accountForBearer(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  const id = body?.id ?? new URL(req.url).searchParams.get("id");
  if (!isUUID(id)) return json({ error: "id is required" }, 400);

  const dismissed = await sql.begin(async (tx) => {
    const revoked = await tx`
      update treddy.mcp_grants set revoked_at = now()
      where id = ${id} and threads_user_id = ${account.threads_user_id} and revoked_at is null
      returning id`;
    if (revoked.length === 0) return null;
    const posts = await tx`
      update treddy.posts set status = 'deleted', edited_at = now()
      where suggested_by = ${id} and status = 'suggested'
      returning id`;
    return posts.length;
  });
  if (dismissed === null) return json({ error: "Not found" }, 404);
  return json({ ok: true, dismissed });
}
