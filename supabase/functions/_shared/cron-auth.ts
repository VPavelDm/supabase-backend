// pg_cron proves itself to an app's cron-only routes (reachable from the
// public internet — app functions deploy with JWT verification off) with a
// Vault secret the app's migration generated inside Postgres. The check
// caches the Vault value briefly to spare a query per call, and compares
// SHA-256 digests so string-comparison timing reveals nothing.

import { sql } from "./db.ts";

const cache = new Map<string, { value: string; at: number }>();
const TTL_MS = 10 * 60 * 1000;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function cronGuard(
  header: string,
  vaultSecret: string,
): (req: Request) => Promise<boolean> {
  return async (req) => {
    const given = req.headers.get(header);
    if (!given) return false;
    let cached = cache.get(vaultSecret);
    if (!cached || Date.now() - cached.at > TTL_MS) {
      const rows = await sql`
        select decrypted_secret from vault.decrypted_secrets
        where name = ${vaultSecret}`;
      if (rows.length === 0) return false;
      cached = { value: rows[0].decrypted_secret, at: Date.now() };
      cache.set(vaultSecret, cached);
    }
    return (await sha256(given)) === (await sha256(cached.value));
  };
}
