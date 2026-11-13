-- The Lingo apps' win-back push (subscription-offers skill): the device
-- tokens it goes to and the once-per-ending gate behind it. Hutarka and Hejka
-- already show their offers in the app (onboarding-ios' OfferCenter); this is
-- the push that brings a lapsed learner back to see one.
--
-- Push: the apps register their APNs token on every launch and whenever the
-- signed-in user appears (lingo_register_device), naming the app they are, so
-- the push goes out under that app's bundle id. The daily practice reminder
-- stays a local notification and never touches the backend. The only push sent
-- from here is the win-back (functions/lingo/winback.ts): when a trial or
-- subscription ends unpaid, the app's Adapty projects post to
-- `lingo/adapty-webhook/<app>` and the learner's iPhones get "A gift for you 🎁",
-- which opens the offer.
--
-- Both tables cascade with the auth user, are listed in `userHoldsAppData`
-- (_shared/erase-user.ts) and are emptied by `lingo/delete-my-data`. Only the
-- RPC below and the function touch them: RLS on, no policies.
--
-- Idempotent like every migration here.

create schema if not exists lingo;

create table if not exists lingo.devices (
  device_token text primary key,
  -- The app the token belongs to (functions/lingo/apps.ts ids); picks the
  -- APNs topic and the Adapty projects. A token is issued per app install,
  -- so it is unique across apps too.
  app text not null check (app ~ '^[a-z][a-z0-9_]{1,31}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  -- BCP 47 tag the phone runs in; the push text is localized on the phone
  -- (loc-key), so this is for analysis only.
  locale text not null default 'en',
  updated_at timestamptz not null default now()
);
create index if not exists devices_user_idx on lingo.devices (user_id, app);

alter table lingo.devices enable row level security;

drop trigger if exists lingo_set_updated_at on lingo.devices;
create trigger lingo_set_updated_at
  before update on lingo.devices
  for each row execute function shared.set_updated_at();

-- A token belongs to one install; a reinstall that comes back as another
-- anonymous user, or a deletion that starts over, takes the row over. The
-- caller can only file a token under themselves; a made-up app name only
-- sends their own pushes to a topic that rejects them.
create or replace function public.lingo_register_device(
  p_app text,
  p_device_token text,
  p_environment text default 'production',
  p_locale text default 'en'
)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_auth_id uuid := auth.uid();
  v_token text := lower(btrim(p_device_token));
  v_app text := lower(btrim(p_app));
begin
  if v_auth_id is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_token !~ '^[0-9a-f]{64,200}$' then
    raise exception 'Invalid device token' using errcode = '22023';
  end if;
  if v_app !~ '^[a-z][a-z0-9_]{1,31}$' then
    raise exception 'Invalid app' using errcode = '22023';
  end if;

  insert into lingo.devices (device_token, app, user_id, environment, locale)
  values (
    v_token,
    v_app,
    v_auth_id,
    case when p_environment = 'sandbox' then 'sandbox' else 'production' end,
    coalesce(left(nullif(btrim(p_locale), ''), 35), 'en')
  )
  on conflict (device_token) do update set
    app = excluded.app,
    user_id = excluded.user_id,
    environment = excluded.environment,
    locale = excluded.locale;
end;
$$;

revoke execute on function public.lingo_register_device(text, text, text, text) from public, anon;
grant execute on function public.lingo_register_device(text, text, text, text) to authenticated;

-- One row per (app, user, ending): a trial or subscription that ends sends one
-- push however many times Adapty delivers the event (it retries on any
-- non-2xx, and both of an app's Adapty projects post here). `lapsed_at` is the
-- access level's expiry, so a learner who comes back, pays and lapses again
-- gets a new row and a new push.
create table if not exists lingo.winback_pushes (
  app text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  lapsed_at timestamptz not null,
  event_type text not null,
  created_at timestamptz not null default now(),
  primary key (app, user_id, lapsed_at)
);
create index if not exists winback_pushes_user_idx on lingo.winback_pushes (user_id);

alter table lingo.winback_pushes enable row level security;
