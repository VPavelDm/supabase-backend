-- Affirmations' subscription offers (subscription-offers skill): the device
-- tokens the win-back push goes to, the once-per-ending gate behind it, and
-- the app's rows in the shared offer seasons and rules.
--
-- Push: the app asks for notification permission in onboarding and registers
-- its APNs token on every launch, and again whenever the signed-in user
-- changes (affirmations_register_device). The daily reminders stay local
-- notifications and never touch the backend. The only push sent from here is
-- the win-back (functions/affirmations/winback.ts): when a trial or
-- subscription ends unpaid, Adapty posts to `affirmations/adapty-webhook` and
-- the user's iPhones get "A gift from Here 🎁", which opens the offer.
--
-- Seasons: an edit to the `affirmations` rows reaches every installed copy of
-- the app at its next launch. A season whose dates include today turns on for
-- every free user at once.
--
-- Both tables cascade with the auth user, are listed in `userHoldsAppData`
-- (_shared/erase-user.ts) and are emptied by `affirmations/delete-my-data`.
-- Only the RPC below and the functions touch them: RLS on, no policies.
--
-- Idempotent like every migration here.

create schema if not exists affirmations;

create table if not exists affirmations.devices (
  device_token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  -- BCP 47 tag the app runs in; the push text is localized on the phone
  -- (loc-key), so this is for analysis only.
  locale text not null default 'en',
  updated_at timestamptz not null default now()
);
create index if not exists devices_user_idx on affirmations.devices (user_id);

alter table affirmations.devices enable row level security;

drop trigger if exists affirmations_set_updated_at on affirmations.devices;
create trigger affirmations_set_updated_at
  before update on affirmations.devices
  for each row execute function shared.set_updated_at();

-- A token belongs to one install; a reinstall, a switch to another Apple
-- account or a deletion that comes back as another user takes the row over.
create or replace function public.affirmations_register_device(
  p_device_token text,
  p_environment text default 'production',
  p_locale text default 'en'
)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_token text := lower(btrim(p_device_token));
begin
  if v_token !~ '^[0-9a-f]{64,200}$' then
    raise exception 'Invalid device token' using errcode = '22023';
  end if;

  insert into affirmations.devices (device_token, user_id, environment, locale)
  values (
    v_token,
    v_auth_id,
    case when p_environment = 'sandbox' then 'sandbox' else 'production' end,
    coalesce(left(nullif(btrim(p_locale), ''), 35), 'en')
  )
  on conflict (device_token) do update set
    user_id = excluded.user_id,
    environment = excluded.environment,
    locale = excluded.locale;
end;
$$;

revoke execute on function public.affirmations_register_device(text, text, text) from public, anon;
grant execute on function public.affirmations_register_device(text, text, text) to authenticated;

-- One row per (user, ending): a trial or subscription that ends sends one
-- push however many times Adapty delivers the event (it retries on any
-- non-2xx, and both Adapty projects post here). `lapsed_at` is the access
-- level's expiry, so a user who comes back, pays and lapses again gets a new
-- row and a new push.
create table if not exists affirmations.winback_pushes (
  user_id uuid not null references auth.users (id) on delete cascade,
  lapsed_at timestamptz not null,
  event_type text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, lapsed_at)
);

alter table affirmations.winback_pushes enable row level security;

-- The same dates and rules as Calyo's and Lyncil's. `id` = theme, so this
-- year's window ids read `black_friday_2026`; the themes are the ones the app
-- has a look for (SpecialOfferTheme).
insert into shared.offer_seasons (app, id, theme, starts, ends) values
  ('affirmations', 'halloween', 'halloween', '10-13', '11-01'),
  ('affirmations', 'black_friday', 'black_friday', '11-13', '11-30'),
  ('affirmations', 'christmas', 'christmas', '12-13', '12-27')
on conflict (app, id) do nothing;

insert into shared.offer_rules (app, rest_days, refund_quiet_days, winback_hours)
values ('affirmations', 7, 30, 48)
on conflict (app) do nothing;
