// Sign in with Apple's REST endpoints, server side: trade an app's
// authorization code for a refresh token, and revoke that token when the user
// deletes their data, as App Store guideline 5.1.1(v) requires. Ported from
// Calories' _shared/apple_sign_in.ts.
//
// Both calls authenticate with a client secret: an ES256 JWT signed with a
// Sign in with Apple key (.p8) from the Apple Developer account. One key serves
// every app of the team. Secrets (`supabase secrets set`):
//   APPLE_SIGN_IN_TEAM_ID      the team id (Membership → Team ID)
//   APPLE_SIGN_IN_KEY_ID       the key's id (Keys → the key with "Sign in with Apple")
//   APPLE_SIGN_IN_PRIVATE_KEY  the .p8 file's contents, PEM lines included
// The client id is the calling app's bundle id, passed in by its route.
// appleConfig() returns null until all three are set, and callers treat that
// as "skip, with a warning".

const TOKEN_URL = "https://appleid.apple.com/auth/token";
const REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const AUDIENCE = "https://appleid.apple.com";
const TIMEOUT_MS = 10_000;

type Env = (name: string) => string | undefined;

export interface AppleConfig {
  teamId: string;
  keyId: string;
  /** Contents of the .p8 key (PEM, PKCS#8). */
  privateKey: string;
  /** The native app's bundle id: Apple issues its codes to that client. */
  clientId: string;
}

export function appleConfig(clientId: string, env: Env = (name) => Deno.env.get(name)): AppleConfig | null {
  const teamId = env("APPLE_SIGN_IN_TEAM_ID");
  const keyId = env("APPLE_SIGN_IN_KEY_ID");
  const privateKey = env("APPLE_SIGN_IN_PRIVATE_KEY");
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey, clientId };
}

// ── Client secret ──

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const utf8 = (s: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Apple allows up to six months; a secret per call lives five minutes and is never stored. */
export async function clientSecret(config: AppleConfig, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(utf8(JSON.stringify({ alg: "ES256", kid: config.keyId })));
  const claims = b64url(utf8(JSON.stringify({
    iss: config.teamId,
    iat: now,
    exp: now + 300,
    aud: AUDIENCE,
    sub: config.clientId,
  })));
  const key = await importP8(config.privateKey);
  // WebCrypto ECDSA emits the raw r||s pair — exactly the JWS ES256 form.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${header}.${claims}`)),
  );
  return `${header}.${claims}.${b64url(signature)}`;
}

// ── Code exchange ──

export interface AppleGrant {
  refreshToken: string;
  /** The Apple user id (`sub` of the ID token), to check against the caller's linked identity. */
  sub: string;
}

/** Thrown when Apple refuses the code (expired, used, or issued to another client): the caller's fault. */
export class AppleCodeRejected extends Error {}

/**
 * Trades an authorization code (valid five minutes, once) for a refresh token. The ID token in the
 * reply comes straight from Apple over TLS in answer to our signed request, so its claims are read
 * without checking its signature (OpenID Connect Core 3.1.3.7).
 */
export async function exchangeCode(
  config: AppleConfig,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<AppleGrant> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: await clientSecret(config),
      code,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 400) {
    const reason = await res.json().then((b) => b?.error).catch(() => undefined);
    throw new AppleCodeRejected(`Apple token exchange → 400 ${reason ?? ""}`.trim());
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Apple token exchange → ${res.status}`);
  }
  const body = await res.json() as { refresh_token?: string; id_token?: string };
  if (!body.refresh_token || !body.id_token) throw new Error("Apple token exchange: no refresh or ID token");

  const claims = idTokenClaims(body.id_token);
  if (claims.aud !== config.clientId || typeof claims.sub !== "string") {
    throw new Error("Apple token exchange: ID token for another client");
  }
  return { refreshToken: body.refresh_token, sub: claims.sub };
}

export function idTokenClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1] ?? "";
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ── Revocation ──

/**
 * Revokes the user's authorization of the app: Apple drops it from "Sign in with Apple" in the
 * user's Apple Account settings. Apple answers 200 for a token it already revoked, so this is safe
 * to repeat.
 */
export async function revokeRefreshToken(
  config: AppleConfig,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: await clientSecret(config),
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`Apple revoke → ${res.status}`);
}
