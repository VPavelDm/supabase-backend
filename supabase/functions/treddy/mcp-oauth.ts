// OAuth 2.1 authorization server for Treddy's MCP connector (Claude,
// ChatGPT). Public clients only, PKCE S256 required, opaque tokens stored as
// SHA-256 hashes.
//
// Clients identify themselves either with a Client ID Metadata Document (an
// https client_id we fetch — its host, e.g. claude.ai, is "verified") or by
// Dynamic Client Registration (anyone may register and pick any name, so
// those are shown to the user as unverified, by redirect host).
//
// Login is a pairing instead of a password: authorize-start (called by the
// Worker's /authorize page) creates a pairing with a short code, the user
// types the code into Treddy, which approves it (mcp-pair.ts), and the
// page — polling authorize-status — then sends the browser back to the
// client with an authorization code.
//
// Routes (the Worker proxies its public paths here):
//   POST oauth/register          ← /register   (RFC 7591)
//   POST oauth/authorize-start   ← /authorize  (the Worker renders the page)
//   POST oauth/authorize-status  ← /authorize/status (the page polls it)
//   POST oauth/token             ← /token

import { sql } from "./db.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  isUUID,
  pkceMatches,
  publicURL,
  randomToken,
  REFRESH_TOKEN_TTL_DAYS,
  resourceURL,
  SCOPE,
  sha256Hex,
  clientIP,
  withinDailyCap,
} from "./mcp-auth.ts";

const PAIRING_MINUTES = 10;
const AUTH_CODE_SECONDS = 60;
/// A client that races two refreshes with the same token gets a plain error
/// for the loser inside this window; outside it, a reused refresh token
/// means a copy leaked and the grant is revoked.
const REFRESH_REUSE_GRACE_SECONDS = 120;
const MAX_REGISTRATIONS_PER_IP_PER_DAY = 20;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface Client {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  verified_host: string | null;
}

function oauthJSON(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return oauthJSON({ error, error_description: description }, status);
}

function safeURL(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/// https anywhere, or http on a loopback host (CLI clients); never a
/// fragment.
function acceptableRedirect(value: unknown): value is string {
  const url = safeURL(value);
  if (!url || url.hash) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
}

/// Exact match, except that a loopback redirect may use any port (native
/// clients pick a free one).
function redirectAllowed(registered: string[], given: string): boolean {
  if (registered.includes(given)) return true;
  const wanted = safeURL(given);
  if (!wanted || wanted.protocol !== "http:" || !LOOPBACK.has(wanted.hostname)) return false;
  return registered.some((entry) => {
    const url = safeURL(entry);
    return url !== null && url.protocol === "http:" && url.hostname === wanted.hostname &&
      url.pathname === wanted.pathname && url.search === wanted.search;
  });
}

/// Users paste the MCP URL by hand; a trailing slash is the same resource.
function sameResource(given: unknown, resource: string): boolean {
  return typeof given === "string" && given.replace(/\/+$/, "") === resource;
}

// MARK: - Clients

/// A Client ID Metadata Document lives at an https URL that is its own
/// client_id. Fetching a URL a stranger chose is an SSRF risk, so: https
/// only, default port, no IP literals or local names, no redirects, 5 s and
/// 20 KB at most.
async function fetchMetadataDocument(clientID: string): Promise<Client | null> {
  const url = safeURL(clientID);
  if (!url || url.protocol !== "https:" || url.port !== "" || url.pathname === "/") return null;
  const host = url.hostname;
  if (
    /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.startsWith("[") ||
    host === "localhost" || !host.includes(".") ||
    /\.(local|internal|localhost)$/.test(host)
  ) return null;

  let doc: Record<string, unknown>;
  try {
    const response = await fetch(url, {
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 20_000) return null;
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (doc?.client_id !== clientID) return null;
  const redirects = Array.isArray(doc.redirect_uris)
    ? doc.redirect_uris.filter((uri): uri is string => typeof uri === "string").slice(0, 10)
    : [];
  if (redirects.length === 0) return null;
  // ChatGPT prefers private_key_jwt but lists "none" among the methods it
  // supports; this server only offers "none", so that is what it will use.
  const method = doc.token_endpoint_auth_method;
  const supported = doc.token_endpoint_auth_methods_supported;
  const canBePublic = method === undefined || method === "none" ||
    (Array.isArray(supported) && supported.includes("none"));
  if (!canBePublic) return null;
  const name = typeof doc.client_name === "string" && doc.client_name.trim().length > 0
    ? doc.client_name.trim().slice(0, 100)
    : host;
  return { client_id: clientID, client_name: name, redirect_uris: redirects, verified_host: host };
}

async function resolveClient(clientID: unknown): Promise<Client | null> {
  if (typeof clientID !== "string" || clientID.length === 0 || clientID.length > 500) return null;
  const rows = await sql`
    select client_id, client_name, redirect_uris, verified_host,
           updated_at < now() - interval '1 day' as stale
    from treddy.mcp_clients where client_id = ${clientID}`;
  const cached = rows[0];
  const isDocument = clientID.startsWith("https://");
  if (cached && !(isDocument && cached.stale)) return cached as unknown as Client;
  if (!isDocument) return null;

  const fresh = await fetchMetadataDocument(clientID);
  if (!fresh) return cached ? (cached as unknown as Client) : null;
  await sql`
    insert into treddy.mcp_clients (client_id, client_name, redirect_uris, verified_host)
    values (${fresh.client_id}, ${fresh.client_name}, ${sql.json(fresh.redirect_uris)},
            ${fresh.verified_host})
    on conflict (client_id) do update set
      client_name = excluded.client_name,
      redirect_uris = excluded.redirect_uris,
      verified_host = excluded.verified_host,
      updated_at = now()`;
  return fresh;
}

/// RFC 7591. Public clients only: no secrets are issued.
export async function handleRegister(req: Request): Promise<Response> {
  if (!publicURL()) return oauthError("temporarily_unavailable", "Connector is off", 503);
  const ip = await clientIP(req);
  if (!(await withinDailyCap(`mcp-register:${ip}`, MAX_REGISTRATIONS_PER_IP_PER_DAY))) {
    return oauthError("invalid_client_metadata", "Too many registrations", 429);
  }

  const body = await req.json().catch(() => null);
  const redirects: unknown[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (redirects.length === 0 || redirects.length > 5 || !redirects.every(acceptableRedirect)) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be 1–5 https (or loopback http) URLs");
  }
  const method = body?.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return oauthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method none)");
  }
  const name = typeof body?.client_name === "string" && body.client_name.trim().length > 0
    ? body.client_name.trim().slice(0, 100)
    : "Unnamed app";
  const clientID = randomToken("dcr_");

  await sql`
    insert into treddy.mcp_clients (client_id, client_name, redirect_uris)
    values (${clientID}, ${name}, ${sql.json(redirects as string[])})`;

  return oauthJSON({
    client_id: clientID,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: redirects,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }, 201);
}

// MARK: - Authorization (pairing)

function userCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function withParams(uri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

/// The Worker forwards /authorize's query parameters as JSON. Answers with
/// what the page should do: show the pairing code, show an error (the
/// client or its redirect can't be trusted, so no redirect), or send the
/// browser back to the client with an OAuth error.
export async function handleAuthorizeStart(req: Request): Promise<Response> {
  const base = publicURL();
  if (!base) return oauthJSON({ page: "error", error_description: "The connector is off." }, 503);
  const params = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const client = await resolveClient(params?.client_id);
  if (!client) {
    return oauthJSON({ page: "error", error_description: "Unknown app. Remove the connector and add it again." }, 400);
  }
  const redirect = params?.redirect_uri;
  if (typeof redirect !== "string" || !redirectAllowed(client.redirect_uris, redirect)) {
    return oauthJSON({ page: "error", error_description: "This app's return address isn't registered." }, 400);
  }
  const state = typeof params?.state === "string" ? params.state.slice(0, 500) : null;
  const back = (error: string, description: string) =>
    oauthJSON({
      page: "redirect",
      redirect: withParams(redirect, { error, error_description: description, state }),
    });

  if (params?.response_type !== "code") return back("unsupported_response_type", "Only code");
  const challenge = params?.code_challenge;
  if (
    params?.code_challenge_method !== "S256" || typeof challenge !== "string" ||
    !/^[A-Za-z0-9\-_]{43,128}$/.test(challenge)
  ) {
    return back("invalid_request", "PKCE with S256 is required");
  }
  const resource = resourceURL(base);
  if (params?.resource !== undefined && !sameResource(params.resource, resource)) {
    return back("invalid_target", "Unknown resource");
  }

  const pollSecret = randomToken("poll_");
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = userCode();
    try {
      const rows = await sql`
        insert into treddy.mcp_pairings
          (user_code, poll_secret_hash, client_id, redirect_uri, code_challenge, state,
           resource, expires_at)
        values (${code}, ${await sha256Hex(pollSecret)}, ${client.client_id}, ${redirect},
                ${challenge}, ${state}, ${resource},
                now() + make_interval(mins => ${PAIRING_MINUTES}))
        returning id`;
      return oauthJSON({
        page: "code",
        pairing_id: rows[0].id,
        poll_secret: pollSecret,
        user_code: `${code.slice(0, 3)}-${code.slice(3)}`,
        client_name: client.client_name,
        verified_host: client.verified_host,
        redirect_host: new URL(redirect).host,
        expires_in: PAIRING_MINUTES * 60,
      });
    } catch (error) {
      // A pending pairing already holds this code: draw another.
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  return oauthJSON({ page: "error", error_description: "Please try again." }, 500);
}

/// Polled by the login page. Once the user allowed the pairing in the app,
/// the first poll mints the single-use authorization code and hands back
/// the redirect that carries it.
export async function handleAuthorizeStatus(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!isUUID(body?.pairing_id) || typeof body?.poll_secret !== "string") {
    return oauthJSON({ status: "expired" }, 400);
  }
  const rows = await sql`
    select status, redirect_uri, state, expires_at < now() as expired
    from treddy.mcp_pairings
    where id = ${body.pairing_id} and poll_secret_hash = ${await sha256Hex(body.poll_secret)}`;
  const pairing = rows[0];
  if (!pairing) return oauthJSON({ status: "expired" }, 404);

  switch (pairing.status) {
    case "pending":
      return oauthJSON({ status: pairing.expired ? "expired" : "pending" });
    case "denied":
      return oauthJSON({
        status: "denied",
        redirect: withParams(pairing.redirect_uri, {
          error: "access_denied",
          error_description: "Declined in Treddy",
          state: pairing.state,
        }),
      });
    case "approved": {
      const code = randomToken("code_");
      const issued = await sql`
        update treddy.mcp_pairings
        set status = 'issued',
            auth_code_hash = ${await sha256Hex(code)},
            auth_code_expires_at = now() + make_interval(secs => ${AUTH_CODE_SECONDS})
        where id = ${body.pairing_id} and status = 'approved'
        returning redirect_uri, state`;
      if (issued.length === 0) return oauthJSON({ status: "done" });
      return oauthJSON({
        status: "approved",
        redirect: withParams(issued[0].redirect_uri, { code, state: issued[0].state }),
      });
    }
    default:
      return oauthJSON({ status: "done" });
  }
}

// MARK: - Token

async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body ?? {})) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await req.text().catch(() => ""));
}

/// Public clients send client_id as a parameter; tolerate one that uses
/// HTTP Basic with an empty secret.
function clientIDFrom(req: Request, params: URLSearchParams): string | null {
  const given = params.get("client_id");
  if (given) return given;
  // A private_key_jwt client may name itself only inside its assertion. The
  // signature isn't checked: as for any public client, PKCE and the exact
  // redirect_uri are what bind the code to it.
  const assertion = params.get("client_assertion");
  if (assertion) {
    try {
      const payload = JSON.parse(atob(assertion.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (typeof payload?.sub === "string") return payload.sub;
    } catch {
      return null;
    }
  }
  const basic = req.headers.get("Authorization")?.match(/^Basic\s+(.+)$/i)?.[1];
  if (!basic) return null;
  try {
    return decodeURIComponent(atob(basic).split(":")[0]);
  } catch {
    return null;
  }
}

async function issueTokens(): Promise<{
  access: string;
  refresh: string;
  accessHash: string;
  refreshHash: string;
}> {
  const access = randomToken("tmcp_");
  const refresh = randomToken("tmcr_");
  return { access, refresh, accessHash: await sha256Hex(access), refreshHash: await sha256Hex(refresh) };
}

function tokenResponse(access: string, refresh: string): Response {
  return oauthJSON({
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
    scope: SCOPE,
  });
}

export async function handleToken(req: Request): Promise<Response> {
  const base = publicURL();
  if (!base) return oauthError("temporarily_unavailable", "Connector is off", 503);
  const params = await readParams(req);
  const clientID = clientIDFrom(req, params);
  if (!clientID) return oauthError("invalid_client", "client_id is required", 401);

  switch (params.get("grant_type")) {
    case "authorization_code":
      return await exchangeCode(params, clientID, base);
    case "refresh_token":
      return await refresh(params, clientID);
    default:
      return oauthError("unsupported_grant_type", "authorization_code or refresh_token");
  }
}

async function exchangeCode(params: URLSearchParams, clientID: string, base: string): Promise<Response> {
  const code = params.get("code");
  const verifier = params.get("code_verifier");
  if (!code || !verifier) return oauthError("invalid_request", "code and code_verifier are required");
  const codeHash = await sha256Hex(code);

  // Spending the code first: whatever fails below, it can't be tried twice.
  const rows = await sql`
    update treddy.mcp_pairings set status = 'used'
    where auth_code_hash = ${codeHash} and status = 'issued' and auth_code_expires_at > now()
    returning id, client_id, redirect_uri, code_challenge, resource, threads_user_id`;
  const pairing = rows[0];
  if (!pairing) {
    // A code presented again was intercepted somewhere: the grant it
    // already bought is cut off (RFC 6749 §4.1.2).
    await sql`
      update treddy.mcp_grants set revoked_at = now()
      where revoked_at is null and id = (
        select grant_id from treddy.mcp_pairings
        where auth_code_hash = ${codeHash} and status = 'used')`;
    return oauthError("invalid_grant", "Code is invalid, expired or already used");
  }
  const resource = params.get("resource");
  if (
    pairing.client_id !== clientID ||
    pairing.redirect_uri !== params.get("redirect_uri") ||
    (resource !== null && !sameResource(resource, resourceURL(base))) ||
    !(await pkceMatches(verifier, pairing.code_challenge))
  ) {
    return oauthError("invalid_grant", "Code does not match this request");
  }

  const tokens = await issueTokens();
  const grant = await sql`
    insert into treddy.mcp_grants
      (threads_user_id, client_id, resource, access_token_hash, access_expires_at,
       refresh_token_hash, refresh_expires_at)
    values (${pairing.threads_user_id}, ${clientID}, ${pairing.resource}, ${tokens.accessHash},
            now() + make_interval(secs => ${ACCESS_TOKEN_TTL_SECONDS}), ${tokens.refreshHash},
            now() + make_interval(days => ${REFRESH_TOKEN_TTL_DAYS}))
    returning id`;
  await sql`update treddy.mcp_pairings set grant_id = ${grant[0].id} where id = ${pairing.id}`;
  return tokenResponse(tokens.access, tokens.refresh);
}

async function refresh(params: URLSearchParams, clientID: string): Promise<Response> {
  const token = params.get("refresh_token");
  if (!token) return oauthError("invalid_request", "refresh_token is required");
  const hash = await sha256Hex(token);
  const tokens = await issueTokens();

  const rotated = await sql`
    update treddy.mcp_grants set
      access_token_hash = ${tokens.accessHash},
      access_expires_at = now() + make_interval(secs => ${ACCESS_TOKEN_TTL_SECONDS}),
      previous_refresh_hash = refresh_token_hash,
      refresh_token_hash = ${tokens.refreshHash},
      refresh_expires_at = now() + make_interval(days => ${REFRESH_TOKEN_TTL_DAYS}),
      refreshed_at = now()
    where refresh_token_hash = ${hash}
      and client_id = ${clientID}
      and revoked_at is null
      and refresh_expires_at > now()
    returning id`;
  if (rotated.length > 0) return tokenResponse(tokens.access, tokens.refresh);

  // An already-rotated token: a racing duplicate request just fails; later
  // than that, someone else is holding a copy — cut the grant off.
  await sql`
    update treddy.mcp_grants set revoked_at = now()
    where previous_refresh_hash = ${hash}
      and revoked_at is null
      and refreshed_at < now() - make_interval(secs => ${REFRESH_REUSE_GRACE_SECONDS})`;
  return oauthError("invalid_grant", "Refresh token is invalid, expired or revoked");
}
