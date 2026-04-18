import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { jsonResponse, errorResponse, corsResponse, methodNotAllowedResponse } from "../_shared/response.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return methodNotAllowedResponse();
  try {
    const supabase = createSupabaseClient(req);
    const body = await req.json();
    const params = {
      p_name: body.p_name ?? null,
      p_birthday: body.p_birthday ?? null,
      p_timezone: body.p_timezone ?? null,
      p_passed_onboarding: body.p_passed_onboarding ?? null,
    };
    const { data, error } = await supabase.rpc("update_profile", params);
    if (error) {
      console.error("update-profile RPC failed:", error);
      return errorResponse("Internal server error", 500);
    }
    return jsonResponse(data);
  } catch (e) {
    console.error("update-profile unexpected error:", e);
    return errorResponse("Internal server error", 500);
  }
});
