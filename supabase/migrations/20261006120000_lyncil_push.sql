-- Push notifications for Lyncil: "Your song is ready" when a song finishes.
--
-- The app registers its APNs token once notifications are allowed
-- (lyncil_register_device); a song's finish (functions/lyncil/generate-song.ts,
-- whoever flips the job to succeeded) pushes to every device of its user.
--
-- Lyria in sync mode (the provider in use) finishes on the server, so the
-- push goes out with the app closed. A Mureka or background-Lyria song only
-- finishes when the app polls song-status, so it pushes only while someone is
-- polling; switching back to either needs a pg_cron job that finishes pending
-- songs itself (dropped 2026-10-06 while Lyria sync is the only provider).
--
-- The reminders (day 1, 3, 7) are local notifications scheduled by the app
-- and never touch the backend.
--
-- Idempotent like every migration here.

create table if not exists lyncil.devices (
  device_token text primary key,
  user_id uuid not null references lyncil.profiles (id) on delete cascade,
  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  -- BCP 47 tag the app runs in; the push text is localized on the phone
  -- (loc-key), so this is for analysis only.
  locale text not null default 'en',
  updated_at timestamptz not null default now()
);
create index if not exists devices_user_idx on lyncil.devices (user_id);

-- Never exposed through PostgREST directly; the RPC below is the API.
alter table lyncil.devices enable row level security;

drop trigger if exists lyncil_set_updated_at on lyncil.devices;
create trigger lyncil_set_updated_at
  before update on lyncil.devices
  for each row execute function shared.set_updated_at();

-- A token belongs to one install; a reinstall that comes back as another
-- user takes the row over.
create or replace function public.lyncil_register_device(
  p_device_token text,
  p_environment text default 'production',
  p_locale text default 'en'
)
returns jsonb
language plpgsql security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
  v_token text := lower(trim(p_device_token));
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;
  if v_token !~ '^[0-9a-f]{64,200}$' then
    raise exception 'Invalid device token';
  end if;

  perform ensure_profile(v_auth_id);

  insert into devices (device_token, user_id, environment, locale)
  values (
    v_token,
    v_auth_id,
    case when p_environment = 'sandbox' then 'sandbox' else 'production' end,
    coalesce(left(nullif(trim(p_locale), ''), 35), 'en')
  )
  on conflict (device_token) do update set
    user_id = excluded.user_id,
    environment = excluded.environment,
    locale = excluded.locale;

  return jsonb_build_object('device_token', v_token);
end;
$$;

grant execute on function public.lyncil_register_device(text, text, text) to authenticated;
