// apple-token: keeps the caller's Sign in with Apple refresh token so that
// delete-my-data can revoke it (App Store guideline 5.1.1(v)). The app calls
// this right after Apple is linked to the user, or after it switched to an
// account that already had Apple, with the authorization code Apple's sheet
// returned.
//
// POST `{ "authorization_code": "..." }`, user token + app key. 204 once
// stored; the token never leaves the server (affirmations.apple_tokens, which
// no app token can read).
//   400  no code, or Apple refused it (expired after five minutes, used, another client)
//   401  no app key, or a missing or invalid user token
//   403  the code belongs to an Apple account that is not linked to the caller
//   503  the AFFIRMATIONS_APPLE_SIGN_IN_* secrets are not set (_shared/apple-sign-in.ts)

import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { sql } from "../_shared/db.ts";
import { json } from "../_shared/router.ts";
import { secretKey } from "../_shared/keys.ts";
import { verifiedUserId } from "../_shared/erase-user.ts";
import { AppleCodeRejected, appleConfig, exchangeCode } from "../_shared/apple-sign-in.ts";
import { isAppCall } from "./auth.ts";

const FN = "affirmations/apple-token";

const log = (level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) =>
  console[level === "info" ? "log" : level](JSON.stringify({ level, fn: FN, event, ...fields }));

export async function handleAppleToken(req: Request): Promise<Response> {
  if (!await isAppCall(req)) return json({ error: "Unauthorized" }, 401);
  const userId = await verifiedUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null) as { authorization_code?: unknown } | null;
  const code = body?.authorization_code;
  if (typeof code !== "string" || code.length === 0 || code.length > 4096) {
    return json({ error: "authorization_code is required" }, 400);
  }

  const config = appleConfig("affirmations");
  if (!config) {
    log("warn", "not_configured");
    return json({ error: "Sign in with Apple is not configured" }, 503);
  }

  try {
    const grant = await exchangeCode(config, code);

    // Only an Apple account linked to this user: otherwise anyone holding a
    // fresh code for someone else's Apple account could park it here, and
    // deleting their own data would revoke that person's sign-in.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) throw new Error(`user read: ${error?.message ?? "no user"}`);
    const linked = (data.user.identities ?? []).some((identity) =>
      identity.provider === "apple" && (identity.id === grant.sub || identity.identity_data?.sub === grant.sub)
    );
    if (!linked) {
      log("warn", "not_linked");
      return json({ error: "This Apple account is not linked to the caller" }, 403);
    }

    await sql`
      insert into affirmations.apple_tokens (user_id, apple_sub, refresh_token, updated_at)
      values (${userId}::uuid, ${grant.sub}, ${grant.refreshToken}, now())
      on conflict (user_id) do update set
        apple_sub = excluded.apple_sub,
        refresh_token = excluded.refresh_token,
        updated_at = excluded.updated_at`;

    log("info", "stored");
    return new Response(null, { status: 204 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof AppleCodeRejected) {
      log("warn", "code_rejected", { message });
      return json({ error: "Apple rejected the authorization code" }, 400);
    }
    log("error", "failed", { message });
    return json({ error: "Internal error" }, 500);
  }
}
