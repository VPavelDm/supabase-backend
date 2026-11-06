// What every app's delete-my-data route shares: removing a user's storage
// folder, deleting the auth user once no app on the project holds anything of
// theirs, and erasing them at the third-party services that know their id.
//
// The auth user is shared: Futura, Lyncil and Affirmations all sign users in
// against this project's auth. Each app's install has its own anonymous user
// (the session lives in that app's Keychain), but nothing in the schema
// enforces that, so an app's route deletes only its own rows and files and
// leaves the auth user alone while `userHoldsAppData` finds anything of
// another app's. An app that starts keeping per-user rows or files on this
// project adds them to `userHoldsAppData`, or another app's deletion would
// delete its auth user, and with it every row that cascades from auth.users.

import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { sql } from "./db.ts";
import { secretKey } from "./keys.ts";

const TIMEOUT_MS = 10_000;
/// The storage API's limit for one remove call.
const REMOVE_BATCH = 1000;

/// iOS spells a UUID upper-case (`UUID.uuidString`), the backend and Android
/// lower-case, and every service below treats ids as case-sensitive.
export function idSpellings(userId: string): string[] {
  return [...new Set([userId.toLowerCase(), userId.toUpperCase()])];
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/// The user's id, checked by the auth server, or null when the bearer token
/// is missing, is the anon key, or is rejected.
export async function verifiedUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice("bearer ".length).trim();
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

/// Removes every object under `<user id>/` in the bucket (either spelling)
/// and returns how many there were. Throws when the storage API refuses, so
/// the route can fail before it deletes the rows that point at the files.
export async function removeUserFolder(bucket: string, userId: string): Promise<number> {
  const prefixes = idSpellings(userId).map((id) => `${id}/%`);
  const rows = await sql`
    select name from storage.objects
    where bucket_id = ${bucket} and (name like ${prefixes[0]} or name like ${prefixes.at(-1)!})`;
  const names = rows.map((row) => row.name as string);
  const storage = adminClient().storage.from(bucket);
  for (let i = 0; i < names.length; i += REMOVE_BATCH) {
    const { error } = await storage.remove(names.slice(i, i + REMOVE_BATCH));
    if (error) throw new Error(`removing ${bucket}/${userId}/: ${error.message}`);
  }
  return names.length;
}

/// Whether any app on the project still holds a row or a file of this user's.
async function userHoldsAppData(userId: string): Promise<boolean> {
  const id = userId.toLowerCase();
  const prefixes = idSpellings(userId).map((spelling) => `${spelling}/%`);
  const [row] = await sql`
    select
      exists (select 1 from futura.profiles where auth_id = ${id}::uuid)
      or exists (select 1 from futura.capsules where user_id = ${id}::uuid)
      or exists (select 1 from lyncil.profiles where id = ${id}::uuid)
      or exists (select 1 from lyncil.ai_usage
                 where caller in (${`user:${id}`}, ${`adfree:user:${id}`}))
      or exists (select 1 from affirmations.ai_usage where caller = ${`user:${id}`})
      or exists (select 1 from storage.objects
                 where bucket_id in ('capsule-photos', 'capsule-voice-notes', 'lyncil-tracks')
                   and (name like ${prefixes[0]} or name like ${prefixes.at(-1)!}))
      as in_use`;
  return row.in_use === true;
}

export type AuthUserOutcome = "deleted" | "kept" | "failed";

/// Deletes the auth user (sessions, identities, and every row that cascades
/// from auth.users) when no app holds anything of theirs any more; otherwise
/// keeps it. Never throws: the app's own data is already gone by now, and a
/// leftover anonymous auth user holds nothing personal, so a failure is
/// logged for a manual follow-up instead of failing the deletion.
export async function deleteAuthUserIfUnused(fn: string, userId: string): Promise<AuthUserOutcome> {
  try {
    if (await userHoldsAppData(userId)) {
      console.log(JSON.stringify({ fn, event: "auth_user_kept", reason: "other_app_data" }));
      return "kept";
    }
    const { error } = await adminClient().auth.admin.deleteUser(userId);
    if (error) throw error;
    return "deleted";
  } catch (e) {
    console.error(JSON.stringify({
      level: "error",
      fn,
      event: "auth_user_delete_failed",
      user_id: userId,
      message: e instanceof Error ? e.message : String(e),
    }));
    return "failed";
  }
}

export type ErasureStatus = "erased" | "skipped" | "failed";

/// Runs one third-party erasure, logging instead of throwing: it runs after
/// the user's rows are gone, so a failure is a manual follow-up, not a
/// reason to tell the user their data is still here.
export async function eraseAt(
  fn: string,
  service: string,
  userId: string,
  erase: () => Promise<ErasureStatus>,
): Promise<ErasureStatus> {
  try {
    const status = await erase();
    if (status === "skipped") {
      console.warn(JSON.stringify({ level: "warn", fn, event: "erasure_skipped", service }));
    }
    return status;
  } catch (e) {
    console.error(JSON.stringify({
      level: "error",
      fn,
      event: "erasure_failed",
      service,
      user_id: userId,
      message: e instanceof Error ? e.message : String(e),
    }));
    return "failed";
  }
}

/// Deletes the Adapty profile whose customer user id is the user's, under
/// each spelling, with one Adapty app's secret key. Adapty keeps the store
/// purchase itself: a restore on a new profile finds the subscription again.
export async function eraseFromAdapty(
  secretApiKey: string | undefined,
  userId: string,
  fetchFn: typeof fetch = fetch,
): Promise<ErasureStatus> {
  if (!secretApiKey) return "skipped";
  for (const customerUserId of idSpellings(userId)) {
    const res = await fetchFn("https://api.adapty.io/api/v2/server-side-api/profile/", {
      method: "DELETE",
      headers: { Authorization: `Api-Key ${secretApiKey}`, "adapty-customer-user-id": customerUserId },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel();
    // 404: no profile under this spelling, the usual case for one of the two.
    if (!res.ok && res.status !== 404) throw new Error(`Adapty profile delete → ${res.status}`);
  }
  return "erased";
}

/// Asks Amplitude's User Privacy API to delete the user's events and
/// profile, under each spelling. Amplitude queues the job and runs it within
/// 30 days; `ignore_invalid_id` keeps a spelling it never saw from failing
/// the request.
export async function eraseFromAmplitude(
  keys: { apiKey?: string; secretKey?: string; host?: string },
  userId: string,
  requester: string,
  fetchFn: typeof fetch = fetch,
): Promise<ErasureStatus> {
  if (!keys.apiKey || !keys.secretKey) return "skipped";
  const host = keys.host ?? "https://amplitude.com";
  const res = await fetchFn(`${host}/api/2/deletions/users`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keys.apiKey}:${keys.secretKey}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_ids: idSpellings(userId),
      requester,
      ignore_invalid_id: "True",
      delete_from_org: "False",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`Amplitude deletion request → ${res.status}`);
  return "erased";
}
