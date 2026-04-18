import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { jsonResponse, errorResponse, corsResponse, methodNotAllowedResponse } from "../_shared/response.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return methodNotAllowedResponse();
  try {
    const supabase = createSupabaseClient(req);

    const params = await req.json();
    if (!params.p_capsule_id) {
      return errorResponse("p_capsule_id is required");
    }

    const { data, error } = await supabase.rpc("delete_capsule", params);
    if (error) {
      console.error("delete-capsule RPC failed:", error);
      return errorResponse("Internal server error", 500);
    }

    // Clean up storage files returned by the DB function
    const photoPaths = (data.photo_paths ?? []) as string[];
    const voicePaths = (data.voice_note_paths ?? []) as string[];

    if (photoPaths.length > 0) {
      await supabase.storage.from("capsule-photos").remove(photoPaths);
    }
    if (voicePaths.length > 0) {
      await supabase.storage.from("capsule-voice-notes").remove(voicePaths);
    }

    return jsonResponse({ success: true });
  } catch (e) {
    console.error("delete-capsule unexpected error:", e);
    return errorResponse("Internal server error", 500);
  }
});
