-- Three lockdowns, none of which changes what the apps do today.
--
-- 1. Lyncil tracks: only generate-song writes them, with the secret key. A user could upload or
--    replace any audio under their own folder and publish it on music.lyncil.com through
--    share-song. Deploy generate-song (it uploads with the secret key) before this migration;
--    the other way round, finished songs fail to save until it is deployed.
drop policy if exists "Lyncil users upload own tracks" on storage.objects;
drop policy if exists "Lyncil users replace own tracks" on storage.objects;

-- 2. Functions: every function in public was executable by PUBLIC, anon included, because the
--    schema's default privileges granted it. A new function without a guard would have been open
--    to anyone holding the publishable key. Functions now start with no grant (the global form:
--    Postgres ignores a schema-scoped revoke from PUBLIC), and each one the apps call is granted
--    to authenticated, which anonymous users carry too. Every app signs in before its first call.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema shared from public, anon, authenticated;
revoke execute on all functions in schema lyncil from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Futura (through its edge functions, with the caller's token).
grant execute on function public.get_capsules(integer, integer, boolean) to authenticated;
grant execute on function public.create_capsule(text, text, text, text, text, timestamptz, double precision, double precision) to authenticated;
grant execute on function public.delete_capsule(uuid) to authenticated;
grant execute on function public.open_capsule(uuid) to authenticated;
grant execute on function public.add_capsule_photo(uuid, text, integer) to authenticated;
grant execute on function public.add_capsule_voice_note(uuid, text, double precision, integer) to authenticated;
grant execute on function public.get_profile() to authenticated;
grant execute on function public.create_profile_if_needed() to authenticated;
grant execute on function public.update_profile(text, date, text, boolean) to authenticated;

-- Lyncil (straight from the apps).
grant execute on function public.lyncil_ensure_profile() to authenticated;
grant execute on function public.lyncil_complete_onboarding(text) to authenticated;
grant execute on function public.lyncil_reset_onboarding() to authenticated;
grant execute on function public.lyncil_get_songs() to authenticated;
grant execute on function public.lyncil_upsert_song(uuid, text, text, text, text, text, text, text, text, boolean, text, double precision, double precision) to authenticated;
grant execute on function public.lyncil_delete_song(uuid) to authenticated;
grant execute on function public.lyncil_add_song_feedback(uuid, text[], text) to authenticated;
grant execute on function public.lyncil_register_device(text, text, text) to authenticated;

-- The onboarding offer config is read before sign-in, with the publishable key alone.
grant execute on function public.shared_offer_config(text) to anon, authenticated;

-- lyncil_profile_json, lyncil_song_json and shared.set_updated_at keep no grant: the first two are
-- called only inside the SECURITY DEFINER functions above, the last only as a trigger.

-- 3. Futura's tables kept the grants they had when they lived in public. Nothing can use them
--    (the schema has no usage grant and the functions are SECURITY DEFINER); removed anyway.
revoke all on all tables in schema futura from anon, authenticated;
revoke all on all sequences in schema futura from anon, authenticated;
