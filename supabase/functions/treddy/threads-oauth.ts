// Threads OAuth redirect target. Registered as the OAuth redirect URI in the
// Meta app, so Threads sends the browser here with ?code=...&state=....
// This route holds the app secret: it exchanges the code for a short-lived
// token, upgrades it to a long-lived (60-day) one, and bounces the browser
// back into the app on its custom scheme. The token travels in the URL
// fragment so it never lands in request logs.

const APP_CALLBACK = "treddy://threads-auth";

// Must exactly match the redirect_uri the app puts in the authorize URL and
// the URI registered in the Meta dashboard — pinned rather than derived from
// the request, which may carry an internal host.
const REDIRECT_URI =
  "https://ttjzshiaatqvszckjlhw.supabase.co/functions/v1/treddy/threads-oauth";

function backToApp(fragment: Record<string, string>): Response {
  const encoded = Object.entries(fragment)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return new Response(null, {
    status: 302,
    headers: { Location: `${APP_CALLBACK}#${encoded}` },
  });
}

export async function handleThreadsOAuth(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const denied = url.searchParams.get("error_description") ??
    url.searchParams.get("error");

  if (denied || !code) {
    return backToApp({ error: denied ?? "Sign-in did not complete.", state });
  }

  const clientId = Deno.env.get("TREDDY_THREADS_APP_ID");
  const clientSecret = Deno.env.get("TREDDY_THREADS_APP_SECRET");
  if (!clientId || !clientSecret) {
    return backToApp({ error: "Server is not configured for sign-in.", state });
  }

  try {
    const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    if (!shortRes.ok) {
      console.error("short-lived exchange failed", await shortRes.text());
      return backToApp({ error: "Threads rejected the sign-in.", state });
    }
    const short = await shortRes.json();

    const longURL = new URL("https://graph.threads.net/access_token");
    longURL.searchParams.set("grant_type", "th_exchange_token");
    longURL.searchParams.set("client_secret", clientSecret);
    longURL.searchParams.set("access_token", short.access_token);
    const longRes = await fetch(longURL);
    if (!longRes.ok) {
      console.error("long-lived exchange failed", await longRes.text());
      return backToApp({ error: "Threads rejected the sign-in.", state });
    }
    const long = await longRes.json();

    return backToApp({
      access_token: long.access_token,
      user_id: String(short.user_id ?? ""),
      state,
    });
  } catch (error) {
    console.error("threads-oauth failed", error);
    return backToApp({ error: "Sign-in failed. Please try again.", state });
  }
}
