import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { jsonResponse, errorResponse, corsResponse, methodNotAllowedResponse } from "../_shared/response.ts";

const UUID_SEGMENT = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const PHOTO_PATH_REGEX = new RegExp(`^${UUID_SEGMENT}\/${UUID_SEGMENT}\/${UUID_SEGMENT}\\.jpg$`);
const VOICE_PATH_REGEX = new RegExp(`^${UUID_SEGMENT}\/${UUID_SEGMENT}\/${UUID_SEGMENT}\\.m4a$`);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return methodNotAllowedResponse();
  try {
    const supabase = createSupabaseClient(req);

    const params = await req.json();
    const { p_type, p_capsule_id, p_storage_path, p_duration_seconds, p_sort_order } = params;

    if (!p_capsule_id || !p_storage_path) {
      return errorResponse("p_capsule_id and p_storage_path are required", 422);
    }
    if (p_type !== "photo" && p_type !== "voice_note") {
      return errorResponse("p_type must be 'photo' or 'voice_note'", 422);
    }

    const pathRegex = p_type === "photo" ? PHOTO_PATH_REGEX : VOICE_PATH_REGEX;
    if (!pathRegex.test(p_storage_path)) {
      return errorResponse("Invalid storage_path format", 422);
    }

    const rpcName = p_type === "photo" ? "add_capsule_photo" : "add_capsule_voice_note";
    const rpcParams = p_type === "photo"
      ? { p_capsule_id, p_storage_path, p_sort_order }
      : { p_capsule_id, p_storage_path, p_duration_seconds, p_sort_order };

    const { data, error } = await supabase.rpc(rpcName, rpcParams);
    if (error) {
      console.error("add-capsule-media RPC failed:", error);
      return errorResponse("Internal server error", 500);
    }

    return jsonResponse(data, 201);
  } catch (e) {
    console.error("add-capsule-media unexpected error:", e);
    return errorResponse("Internal server error", 500);
  }
});
