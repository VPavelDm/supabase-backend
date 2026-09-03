// Direct Postgres access for app schemas that are deliberately not exposed
// through PostgREST (they hold third-party access tokens). Edge functions
// reach them over the direct connection instead of a supabase-js client.

import postgres from "npm:postgres@3.4.7";

export const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  prepare: false,
  max: 2,
});
