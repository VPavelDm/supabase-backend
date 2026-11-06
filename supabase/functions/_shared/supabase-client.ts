import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";
import { publishableKey } from "./keys.ts";

export function createSupabaseClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    publishableKey(),
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    },
  );
}
