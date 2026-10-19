-- =============================================================================
-- Lyncil: the developer screen's "Reset onboarding"
-- =============================================================================
-- Debug and TestFlight builds have a Developer screen in Profile; its reset
-- makes the caller's own profile forget the finish, so the app's next routing
-- (right away, or on the next launch) goes through onboarding again. Songs,
-- jobs and feedback stay. Harmless to expose: a replay buys nothing, the song
-- quota (song-quota.ts) counts the onboarding song like any other.

create or replace function public.lyncil_reset_onboarding()
returns jsonb
language plpgsql security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;

  perform ensure_profile(v_auth_id);

  update profiles set
    onboarded_at = null,
    onboarding_variant = null
  where id = v_auth_id
  returning * into v_profile;

  return public.lyncil_profile_json(v_profile);
end;
$$;

grant execute on function public.lyncil_reset_onboarding() to authenticated;
