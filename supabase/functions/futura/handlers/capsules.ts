// Capsule routes. Thin pass-throughs to the `public` RPCs (whose bodies
// resolve tables in the `futura` schema); auth is the caller's JWT riding
// into PostgREST, enforced by auth.uid() + RLS.

import { createSupabaseClient } from "../../_shared/supabase-client.ts";
import { errorResponse, jsonResponse } from "../../_shared/response.ts";

const SIGNED_URL_EXPIRY_SECONDS = 24 * 60 * 60;

const UUID_SEGMENT = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const PHOTO_PATH_REGEX = new RegExp(`^${UUID_SEGMENT}/${UUID_SEGMENT}/${UUID_SEGMENT}\\.jpg$`);
const VOICE_PATH_REGEX = new RegExp(`^${UUID_SEGMENT}/${UUID_SEGMENT}/${UUID_SEGMENT}\\.m4a$`);

// Local development runs edge functions inside Docker, where storage URLs
// come back as http://kong:8000 — unreachable from the iOS client. Only the
// local stack needs the rewrite; in production it never matches.
const LOCAL_KONG = "http://kong:8000";
function externalUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return Deno.env.get("SUPABASE_URL") === LOCAL_KONG
    ? url.replace(LOCAL_KONG, "http://127.0.0.1:54321")
    : url;
}

interface MediaRow {
  storage_path: string;
  [key: string]: unknown;
}

/// One storage round-trip per bucket instead of one per file.
async function signedUrlMap(
  supabase: ReturnType<typeof createSupabaseClient>,
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, SIGNED_URL_EXPIRY_SECONDS);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) {
      map.set(entry.path, externalUrl(entry.signedUrl)!);
    }
  }
  return map;
}

export async function handleGetCapsules(req: Request): Promise<Response> {
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

  const capsules = (data ?? []) as Record<string, unknown>[];
  const photoUrls = await signedUrlMap(
    supabase,
    "capsule-photos",
    capsules.flatMap((c) => ((c.photos as MediaRow[]) ?? []).map((p) => p.storage_path)),
  );
  const voiceUrls = await signedUrlMap(
    supabase,
    "capsule-voice-notes",
    capsules.flatMap((c) => ((c.voice_notes as MediaRow[]) ?? []).map((v) => v.storage_path)),
  );

  const result = capsules.map((capsule) => ({
    ...capsule,
    photos: ((capsule.photos as MediaRow[]) ?? []).map((p) => ({
      id: p.id,
      url: photoUrls.get(p.storage_path) ?? null,
      sort_order: p.sort_order,
    })),
    voice_notes: ((capsule.voice_notes as MediaRow[]) ?? []).map((vn) => ({
      id: vn.id,
      url: voiceUrls.get(vn.storage_path) ?? null,
      duration_seconds: vn.duration_seconds,
      sort_order: vn.sort_order,
    })),
  }));

  return jsonResponse(result);
}

export async function handleCreateCapsule(req: Request): Promise<Response> {
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
}

export async function handleDeleteCapsule(req: Request): Promise<Response> {
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
}

export async function handleAddCapsuleMedia(req: Request): Promise<Response> {
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
}

export async function handleOpenCapsule(req: Request): Promise<Response> {
  const supabase = createSupabaseClient(req);
  const params = await req.json();
  const { data, error } = await supabase.rpc("open_capsule", params);
  if (error) {
    console.error("open-capsule RPC failed:", error);
    return errorResponse("Internal server error", 500);
  }
  return jsonResponse(data);
}
