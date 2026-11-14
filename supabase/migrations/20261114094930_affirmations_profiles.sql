create table affirmations.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table affirmations.profiles enable row level security;
revoke all on affirmations.profiles from public, anon, authenticated;

create function public.affirmations_get_profile()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  caller uuid := affirmations.require_user();
begin
  return (select jsonb_build_object('name', name, 'onboarding_completed', onboarding_completed)
          from affirmations.profiles where user_id = caller);
end;
$$;

create function public.affirmations_complete_onboarding(p_name text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := affirmations.require_user();
begin
  insert into affirmations.profiles (user_id, name, onboarding_completed)
  values (caller, nullif(btrim(p_name), ''), true)
  on conflict (user_id) do update
    set name = excluded.name, onboarding_completed = true
    where not profiles.onboarding_completed;
end;
$$;

revoke all on function public.affirmations_get_profile() from public, anon, authenticated;
revoke all on function public.affirmations_complete_onboarding(text) from public, anon, authenticated;
grant execute on function public.affirmations_get_profile() to authenticated;
grant execute on function public.affirmations_complete_onboarding(text) to authenticated;
