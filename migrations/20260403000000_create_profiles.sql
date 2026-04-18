-- =============================================================================
-- Profiles table
-- =============================================================================

create table public.profiles (
  id bigint generated always as identity primary key,
  auth_id uuid not null unique default gen_random_uuid(),
  name text,
  birthday date,
  timezone text,
  passed_onboarding boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can select own profile"
  on public.profiles for select
  using (auth.uid() = auth_id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = auth_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = auth_id);

-- =============================================================================
-- create_profile_if_needed
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_profile_if_needed()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where auth_id = v_auth_id;

  if found then
    return jsonb_build_object(
      'auth_id', v_profile.auth_id,
      'name', v_profile.name,
      'birthday', v_profile.birthday,
      'timezone', v_profile.timezone,
      'passed_onboarding', v_profile.passed_onboarding
    );
  end if;

  insert into profiles (auth_id)
  values (v_auth_id)
  on conflict (auth_id) do nothing;

  select * into v_profile from profiles where auth_id = v_auth_id;

  return jsonb_build_object(
    'auth_id', v_profile.auth_id,
    'name', v_profile.name,
    'birthday', v_profile.birthday,
    'passed_onboarding', v_profile.passed_onboarding
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.create_profile_if_needed() TO authenticated;

-- =============================================================================
-- get_profile
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_profile()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where auth_id = v_auth_id;

  if not found then
    raise exception 'Profile not found';
  end if;

  return jsonb_build_object(
    'auth_id', v_profile.auth_id,
    'name', v_profile.name,
    'birthday', v_profile.birthday,
    'passed_onboarding', v_profile.passed_onboarding
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.get_profile() TO authenticated;

-- =============================================================================
-- update_profile
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_profile(
  p_name text DEFAULT NULL,
  p_birthday date DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_passed_onboarding boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  update profiles
  set
    name = coalesce(p_name, name),
    birthday = coalesce(p_birthday, birthday),
    timezone = coalesce(p_timezone, timezone),
    passed_onboarding = coalesce(p_passed_onboarding, passed_onboarding)
  where auth_id = v_auth_id
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found';
  end if;

  return jsonb_build_object(
    'auth_id', v_profile.auth_id,
    'name', v_profile.name,
    'birthday', v_profile.birthday,
    'passed_onboarding', v_profile.passed_onboarding
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile(text, date, text, boolean) TO authenticated;
