// Tiny fetch router shared by the per-app edge functions. Each app deploys
// one function whose routes live under /functions/v1/<slug>/<route>; routes
// are exact path matches with per-method handlers. The legacy single-route
// Futura functions reuse `serve` so old and new entry points share the same
// plumbing: CORS preflight, method checks, and a top-level error boundary.

import { corsHeaders } from "./cors.ts";

export type Handler = (req: Request) => Response | Promise<Response>;
export type MethodHandlers = Partial<Record<"GET" | "POST" | "DELETE", Handler>>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/// Wraps one route's method handlers with the common plumbing. Also the
/// entry point for the legacy single-route functions.
export function serve(methods: MethodHandlers): Handler {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const handler = methods[req.method as keyof MethodHandlers];
    if (!handler) return json({ error: "Method not allowed" }, 405);
    try {
      return await handler(req);
    } catch (error) {
      console.error("unhandled error", req.method, new URL(req.url).pathname, error);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

export function router(slug: string, routes: Record<string, MethodHandlers>): Handler {
  return (req) => {
    const segments = new URL(req.url).pathname.split("/").filter(Boolean);
    if (segments[0] === slug) segments.shift();
    const methods = routes[segments.join("/")];
    if (!methods) return json({ error: "Unknown route" }, 404);
    return serve(methods)(req);
  };
}
