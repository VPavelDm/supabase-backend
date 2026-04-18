import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { jsonResponse, errorResponse, corsResponse, methodNotAllowedResponse } from "../_shared/response.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return methodNotAllowedResponse();
  try {
    const supabase = createSupabaseClient(req);

    const params = await req.json();
    if (!params.p_title || !params.p_delivery_date) {
      return errorResponse("p_title and p_delivery_date are required");
    }

    const { data, error } = await supabase.rpc("create_capsule", params);
    if (error) {
      console.error("create-capsule RPC failed:", error);
      return errorResponse("Internal server error", 500);
    }

    return jsonResponse(data, 201);
  } catch (e) {
    console.error("create-capsule unexpected error:", e);
    return errorResponse("Internal server error", 500);
  }
});
