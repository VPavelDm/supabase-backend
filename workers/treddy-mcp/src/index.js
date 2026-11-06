// Treddy MCP connector — public front (see ../wrangler.toml).
//
//   GET  /.well-known/oauth-protected-resource[/mcp]  RFC 9728
//   GET  /.well-known/oauth-authorization-server       RFC 8414
//   GET  /authorize          login page: shows the pairing code, polls
//   POST /authorize/status   → treddy/oauth/authorize-status
//   POST /token              → treddy/oauth/token
//   POST /register           → treddy/oauth/register
//   POST /mcp                → treddy/mcp
//
// All decisions (clients, redirects, PKCE, tokens, caps) are made by the
// edge function; this Worker only routes, renders and adds headers.

const SCOPE = "treddy.suggest";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate, mcp-session-id",
};

function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}

function protectedResource(origin) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Treddy",
  };
}

function authorizationServer(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE, "offline_access"],
    client_id_metadata_document_supported: true,
  };
}

/// The function issues access tokens as `tmcp_` + 43 base64url characters.
function hasAccessToken(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return typeof token === "string" && /^tmcp_[A-Za-z0-9_-]{20,95}$/.test(token);
}

/// The same 401 the function sends, so clients start OAuth from it.
function unauthorized(origin) {
  return jsonResponse({ error: "invalid_token" }, 401, {
    "WWW-Authenticate":
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${SCOPE}"`,
  });
}

/// Forwards a request to a treddy route, keeping only the headers the
/// function reads.
async function proxy(request, env, route, extraHeaders = {}) {
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "accept", "mcp-protocol-version"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  const upstream = await fetch(`${env.FUNCTION_URL}/${route}`, {
    method: request.method,
    headers,
    body: request.method === "GET" ? undefined : await request.arrayBuffer(),
  });
  const out = new Headers(CORS);
  for (const name of ["content-type", "www-authenticate", "cache-control", "pragma"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

// MARK: - Login page

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

const STYLE = `
  :root { color-scheme: dark; --bg: #07080d; --card: rgba(255,255,255,.06); --line: rgba(255,255,255,.12);
          --text: #f4f5f8; --muted: rgba(244,245,248,.62); --accent: #5A7AFF; --warn: #ffb547; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         color: var(--text); background: radial-gradient(120% 80% at 50% 0%, #1a2250 0%, var(--bg) 60%); }
  main { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--line);
         border-radius: 28px; padding: 28px 24px; backdrop-filter: blur(20px); }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p { margin: 0 0 14px; color: var(--muted); }
  .who { display: inline-flex; gap: 6px; align-items: center; font-size: 14px; padding: 4px 10px;
         border-radius: 999px; border: 1px solid var(--line); margin-bottom: 18px; }
  .verified { color: #7ee2a8; } .unverified { color: var(--warn); }
  .code { font: 600 40px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em;
          text-align: center; padding: 22px 0; margin: 6px 0 18px; border-radius: 20px;
          background: rgba(90,122,255,.14); border: 1px solid rgba(90,122,255,.45); user-select: all; }
  ol { margin: 0 0 18px; padding-left: 20px; color: var(--muted); } li { margin: 4px 0; }
  .status { font-size: 14px; color: var(--muted); display: flex; gap: 8px; align-items: center; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.4s infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  .note { font-size: 13px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
`;

function page(title, body, nonce, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHTML(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

function htmlResponse(html, nonce, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; ` +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

function errorPage(message, nonce, status = 400) {
  return htmlResponse(
    page("Treddy", `<h1>Can't connect</h1><p>${escapeHTML(message)}</p>`, nonce),
    nonce,
    status,
  );
}

async function authorize(env, url) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const params = Object.fromEntries(url.searchParams);
  let start;
  try {
    const response = await fetch(`${env.FUNCTION_URL}/oauth/authorize-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    start = await response.json();
  } catch {
    return errorPage("Treddy is unreachable right now. Try again in a minute.", nonce, 502);
  }
  if (start.page === "redirect") return Response.redirect(start.redirect, 302);
  if (start.page !== "code") return errorPage(start.error_description ?? "Something went wrong.", nonce);

  const who = start.verified_host
    ? `<span class="who verified">✓ ${escapeHTML(start.client_name)} · ${escapeHTML(start.verified_host)}</span>`
    : `<span class="who unverified">Unverified app “${escapeHTML(start.client_name)}” · returns to ${escapeHTML(start.redirect_host)}</span>`;
  const body = `
    <h1>Connect to Treddy</h1>
    <p>This lets the app read your planning context and suggest posts. Nothing is posted until you approve it in Treddy.</p>
    ${who}
    <div class="code" id="code">${escapeHTML(start.user_code)}</div>
    <ol>
      <li>Open <b>Treddy</b> on your iPhone.</li>
      <li>Go to <b>Settings → Assistants → Connect</b>.</li>
      <li>Enter this code and tap <b>Allow</b>.</li>
    </ol>
    <div class="status" id="status"><span class="dot"></span><span>Waiting for you in Treddy…</span></div>
    <p class="note">Didn't start this yourself just now? Close this page and don't enter the code.</p>`;

  const poll = JSON.stringify({ pairing_id: start.pairing_id, poll_secret: start.poll_secret })
    .replace(/</g, "\\u003c");
  const script = `
    const poll = ${poll};
    const status = document.getElementById("status");
    const deadline = Date.now() + ${Number(start.expires_in) || 600} * 1000;
    // Every poll is a function run: every 3 s, and none while the tab is in
    // the background — coming back to it checks at once.
    const INTERVAL = 3000;
    let timer = null;
    function schedule(delay) {
      clearTimeout(timer);
      timer = document.hidden ? null : setTimeout(tick, delay);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearTimeout(timer); timer = null; } else if (!timer) schedule(0);
    });
    async function tick() {
      timer = null;
      if (Date.now() > deadline) return expired();
      try {
        const r = await fetch("/authorize/status", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(poll) });
        const s = await r.json();
        if ((s.status === "approved" || s.status === "denied") && s.redirect) {
          status.textContent = s.status === "approved" ? "Connected. Returning…" : "Declined. Returning…";
          return location.replace(s.redirect);
        }
        if (s.status === "expired" || s.status === "done") return expired();
      } catch {}
      schedule(INTERVAL);
    }
    function expired() {
      clearTimeout(timer);
      timer = -1;
      status.textContent = "This code expired. Start connecting again from Claude or ChatGPT.";
      document.getElementById("code").style.opacity = ".35";
    }
    schedule(INTERVAL);`;
  return htmlResponse(page("Connect to Treddy", body, nonce, script), nonce);
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "GET") {
      if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
        return jsonResponse(protectedResource(origin), 200, { "Cache-Control": "max-age=3600" });
      }
      if (path === "/.well-known/oauth-authorization-server") {
        return jsonResponse(authorizationServer(origin), 200, { "Cache-Control": "max-age=3600" });
      }
      if (path === "/authorize") return authorize(env, url);
      if (path === "/") {
        return new Response(`Treddy MCP connector. Add ${origin}/mcp as a custom connector in Claude or ChatGPT.\n`, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }

    if (request.method === "POST") {
      if (path === "/mcp") {
        // Only something shaped like an access token is worth a function
        // run: scanners and clients before OAuth get their 401 here.
        return hasAccessToken(request) ? proxy(request, env, "mcp") : unauthorized(origin);
      }
      if (path === "/token") return proxy(request, env, "oauth/token");
      if (path === "/authorize/status") return proxy(request, env, "oauth/authorize-status");
      if (path === "/register") {
        return proxy(request, env, "oauth/register", {
          "x-treddy-client-ip": request.headers.get("cf-connecting-ip") ?? "unknown",
        });
      }
    }

    if (path === "/mcp") {
      // No server-initiated stream and no sessions: Streamable HTTP says 405.
      return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
    }
    return jsonResponse({ error: "Not found" }, 404);
  },
};
