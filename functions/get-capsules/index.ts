import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { jsonResponse, errorResponse, corsResponse, methodNotAllowedResponse } from "../_shared/response.ts";

const SIGNED_URL_EXPIRY_SECONDS = 24 * 60 * 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return methodNotAllowedResponse();
  try {
    const supabase = createSupabaseClient(req);

    let params: { limit?: number; offset?: number; ascending?: boolean } = {};
    try {
      params = await req.json();
    } catch {
      // No body — keep defaults for backwards compatibility with older clients.
    }

    const { data, error } = await supabase.rpc("get_capsules", {
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
      p_ascending: params.ascending ?? true,
    });
    if (error) {
      console.error("get-capsules RPC failed:", error);
      return errorResponse("Internal server error", 500);
    }

    // Generate signed URLs for photos and voice notes
    // Edge functions run inside Docker where storage URLs use http://kong:8000.
    // Replace with the external URL so the iOS client can reach storage.
    function fixUrl(url: string | undefined | null): string | null {
      if (!url) return null;
      return url.replace("http://kong:8000", "http://127.0.0.1:54321");
    }
    const capsules = await Promise.all(
      (data ?? []).map(async (capsule: Record<string, unknown>) => {
        const photos = await Promise.all(
          ((capsule.photos as Record<string, unknown>[]) ?? []).map(async (p) => {
            const { data: signed } = await supabase.storage
              .from("capsule-photos")
              .createSignedUrl(p.storage_path as string, SIGNED_URL_EXPIRY_SECONDS);
            return {
              id: p.id,
              url: fixUrl(signed?.signedUrl) ?? null,
              sort_order: p.sort_order,
            };
          }),
        );

        const voiceNotes = await Promise.all(
          ((capsule.voice_notes as Record<string, unknown>[]) ?? []).map(async (vn) => {
            const { data: signed } = await supabase.storage
              .from("capsule-voice-notes")
              .createSignedUrl(vn.storage_path as string, SIGNED_URL_EXPIRY_SECONDS);
            return {
              id: vn.id,
              url: fixUrl(signed?.signedUrl) ?? null,
              duration_seconds: vn.duration_seconds,
              sort_order: vn.sort_order,
            };
          }),
        );

        return {
          ...capsule,
          photos,
          voice_notes: voiceNotes,
        };
      }),
    );

    return jsonResponse(capsules);
  } catch (e) {
    console.error("get-capsules unexpected error:", e);
    return errorResponse("Internal server error", 500);
  }
});
