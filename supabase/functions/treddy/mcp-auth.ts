// Shared pieces of Treddy's MCP connector: where it lives publicly, token
// hashing, and resolving an assistant's bearer token to its grant.
//
// The connector is reached through a Cloudflare Worker
// (workers/treddy-mcp) whose origin is TREDDY_MCP_PUBLIC_URL: Supabase can't
// serve the root /.well-known documents OAuth discovery needs, nor an HTML
// login page. The Worker proxies /mcp, /token and /register here; every
// rule and every row stays in this function and the treddy schema.

import { sql } from "./db.ts";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 60;
export const SCOPE = "treddy.suggest";

/// The Worker's origin, e.g. https://treddy-mcp.<account>.workers.dev —
/// null when the secret isn't set, which turns the connector off.
export function publicURL(): string | null {
  const value = Deno.env.get("TREDDY_MCP_PUBLIC_URL")?.replace(/\/+$/, "");
  return value && value.startsWith("https://") ? value : null;
}

/// The protected resource: the MCP endpoint exactly as users paste it.
export function resourceURL(base: string): string {
  return `${base}/mcp`;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(prefix: string): string {
  return prefix + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function sha256Hex(text: string): Promise<string> {
  return Array.from(await sha256(text))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/// PKCE S256: base64url(SHA-256(verifier)) must equal the challenge.
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return base64url(await sha256(verifier)) === challenge;
}

export interface Grant {
  id: string;
  threads_user_id: string;
  client_id: string;
  client_name: string;
  last_used_at: Date | null;
}

/// Resolves `Authorization: Bearer <access token>` to a live grant.
export async function grantForBearer(req: Request): Promise<Grant | null> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !token.startsWith("tmcp_") || token.length > 100) return null;
  const rows = await sql`
    select g.id, g.threads_user_id, g.client_id, c.client_name, g.last_used_at
    from treddy.mcp_grants g
    join treddy.mcp_clients c on c.client_id = g.client_id
    where g.access_token_hash = ${await sha256Hex(token)}
      and g.revoked_at is null
      and g.access_expires_at > now()`;
  if (rows.length === 0) return null;
  const grant = rows[0] as unknown as Grant;
  // "Last used" is for the app's list, not an audit log: one write per few
  // minutes is plenty.
  if (!grant.last_used_at || Date.now() - new Date(grant.last_used_at).getTime() > 5 * 60_000) {
    await sql`update treddy.mcp_grants set last_used_at = now() where id = ${grant.id}`;
  }
  return grant;
}

/// Counts one use of a daily allowance in treddy.ai_usage (the table
/// /generate's cap uses); false once the allowance is spent.
export async function withinDailyCap(caller: string, cap: number): Promise<boolean> {
  const rows = await sql`
    insert into treddy.ai_usage (caller, day, count)
    values (${caller}, current_date, 1)
    on conflict (caller, day) do update set count = treddy.ai_usage.count + 1
    returning count`;
  return Number(rows[0].count) <= cap;
}

export async function dailyCount(caller: string): Promise<number> {
  const rows = await sql`
    select count from treddy.ai_usage where caller = ${caller} and day = current_date`;
  return rows.length > 0 ? Number(rows[0].count) : 0;
}

export function isUUID(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
