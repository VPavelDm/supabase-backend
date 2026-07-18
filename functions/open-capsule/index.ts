import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { jsonResponse, errorResponse, corsResponse, methodNotAllowedResponse } from "../_shared/response.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return methodNotAllowedResponse();
  try {
    const supabase = createSupabaseClient(req);
    const params = await req.json();
    const { data, error } = await supabase.rpc("open_capsule", params);
    if (error) {
      console.error("open-capsule RPC failed:", error);
      return errorResponse("Internal server error", 500);
    }
    return jsonResponse(data);
  } catch (e) {
    console.error("open-capsule unexpected error:", e);
    return errorResponse("Internal server error", 500);
  }
});
