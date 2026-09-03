// Profile routes. Thin pass-throughs to the `public` RPCs; auth is the
// caller's JWT riding into PostgREST, enforced by auth.uid() + RLS.

import { createSupabaseClient } from "../../_shared/supabase-client.ts";
import { errorResponse, jsonResponse } from "../../_shared/response.ts";

export async function handleGetProfile(req: Request): Promise<Response> {
  const supabase = createSupabaseClient(req);
  const { data, error } = await supabase.rpc("get_profile");
  if (error) {
    console.error("get-profile RPC failed:", error);
    return errorResponse("Internal server error", 500);
  }
  return jsonResponse(data);
}

export async function handleUpdateProfile(req: Request): Promise<Response> {
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
}

export async function handleCreateProfileIfNeeded(req: Request): Promise<Response> {
  const supabase = createSupabaseClient(req);
  const { data, error } = await supabase.rpc("create_profile_if_needed");
  if (error) {
    console.error("create-profile-if-needed RPC failed:", error);
    return errorResponse("Internal server error", 500);
  }
  return jsonResponse(data);
}
