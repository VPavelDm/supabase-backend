-- The Lingo apps' win-back push on Android (Hejka first): an FCM token next to
-- the iPhones' APNs tokens in lingo.devices, so functions/lingo/winback.ts can
-- send each device its own way. Both apps share one Adapty app per language
-- app, so an Android learner's ending already reaches the same webhook.
--
-- `platform` says which: 'ios' (APNs, the only kind until now, so the default)
-- or 'android' (FCM). FCM tokens are case-sensitive and not hex, so they are
-- checked and stored as given; APNs tokens keep being lowercased hex.
--
-- lingo_register_device gains p_platform with a default. The old four-argument
-- function is dropped first: with both in place PostgREST could not choose
-- between them for the iOS apps' four named arguments.
--
-- Idempotent like every migration here.

alter table lingo.devices
  add column if not exists platform text not null default 'ios';

alter table lingo.devices drop constraint if exists devices_platform_check;
alter table lingo.devices
  add constraint devices_platform_check check (platform in ('ios', 'android'));

drop function if exists public.lingo_register_device(text, text, text, text);

-- A token belongs to one install; a reinstall that comes back as another
-- anonymous user, or a deletion that starts over, takes the row over. The
-- caller can only file a token under themselves; a made-up app name only
-- sends their own pushes to a topic or project that rejects them.
create or replace function public.lingo_register_device(
  p_app text,
  p_device_token text,
  p_environment text default 'production',
  p_locale text default 'en',
  p_platform text default 'ios'
)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_auth_id uuid := auth.uid();
  v_platform text := lower(btrim(coalesce(p_platform, 'ios')));
  v_app text := lower(btrim(p_app));
  v_token text;
begin
  if v_auth_id is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_platform not in ('ios', 'android') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;
  if v_platform = 'ios' then
    v_token := lower(btrim(p_device_token));
    if v_token !~ '^[0-9a-f]{64,200}$' then
      raise exception 'Invalid device token' using errcode = '22023';
    end if;
  else
    -- FCM registration tokens: base64url-ish with a colon, about 160 characters.
    v_token := btrim(p_device_token);
    if v_token !~ '^[A-Za-z0-9_:-]{100,4096}$' then
      raise exception 'Invalid device token' using errcode = '22023';
    end if;
  end if;
  if v_app !~ '^[a-z][a-z0-9_]{1,31}$' then
    raise exception 'Invalid app' using errcode = '22023';
  end if;

  insert into lingo.devices (device_token, app, user_id, environment, locale, platform)
  values (
    v_token,
    v_app,
    v_auth_id,
    -- FCM has no sandbox.
    case when v_platform = 'ios' and p_environment = 'sandbox' then 'sandbox' else 'production' end,
    coalesce(left(nullif(btrim(p_locale), ''), 35), 'en'),
    v_platform
  )
  on conflict (device_token) do update set
    app = excluded.app,
    user_id = excluded.user_id,
    environment = excluded.environment,
    locale = excluded.locale,
    platform = excluded.platform;
end;
$$;

revoke execute on function public.lingo_register_device(text, text, text, text, text) from public, anon;
grant execute on function public.lingo_register_device(text, text, text, text, text) to authenticated;
