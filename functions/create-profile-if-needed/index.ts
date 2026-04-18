import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { jsonResponse, errorResponse, corsResponse, methodNotAllowedResponse } from "../_shared/response.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return methodNotAllowedResponse();
  try {
    const supabase = createSupabaseClient(req);
    const { data, error } = await supabase.rpc("create_profile_if_needed");
    if (error) {
      console.error("create-profile-if-needed RPC failed:", error);
      return errorResponse("Internal server error", 500);
    }
    return jsonResponse(data);
  } catch (e) {
    console.error("create-profile-if-needed unexpected error:", e);
    return errorResponse("Internal server error", 500);
  }
});
