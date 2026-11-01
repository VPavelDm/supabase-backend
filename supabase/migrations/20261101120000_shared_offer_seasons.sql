-- Seasonal offers for every app in one place: Halloween, Black Friday,
-- Christmas, as month-day ranges that come back each year, plus the rules
-- around offers (rest between them, quiet days after a refund, win-back
-- length). Read by onboarding-ios Paywalls' `SharedBackendOfferConfig` through
-- `public.shared_offer_config(p_app)`; see the `subscription-offers` skill.
--
-- One row names one app. There is no "all apps" row on purpose: an edit
-- reaches every installed copy of that app at its next launch, and a wrong
-- date in a shared row would put every app on sale at once.
--
-- Everything here is public: any app's publishable key can call the RPC.
-- Never store anything private in these tables.
--
-- Idempotent like every migration here.

create table if not exists shared.offer_seasons (
  app text not null,
  id text not null,
  theme text,
  starts text not null check (starts ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  ends text not null check (ends ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  duration_minutes int not null default 45 check (duration_minutes between 1 and 10080),
  image text,
  placement_id text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (app, id)
);

create table if not exists shared.offer_rules (
  app text primary key,
  rest_days int not null default 7 check (rest_days >= 0),
  refund_quiet_days int not null default 30 check (refund_quiet_days >= 0),
  winback_hours int not null default 48 check (winback_hours >= 1),
  updated_at timestamptz not null default now()
);

drop trigger if exists offer_seasons_updated_at on shared.offer_seasons;
create trigger offer_seasons_updated_at before update on shared.offer_seasons
  for each row execute function shared.set_updated_at();
drop trigger if exists offer_rules_updated_at on shared.offer_rules;
create trigger offer_rules_updated_at before update on shared.offer_rules
  for each row execute function shared.set_updated_at();

-- The shared schema is not exposed through PostgREST; RLS on as a guard.
alter table shared.offer_seasons enable row level security;
alter table shared.offer_rules enable row level security;

-- `{ "seasons": [...], "rules": {...} | null }` for one app, enabled seasons
-- only. Granted to anon as well as authenticated, unlike this repo's other
-- RPCs: an app reading its seasons has no session in this project (Calyo's
-- users sign in to their own project), and season dates are not secret.
create or replace function public.shared_offer_config(p_app text)
returns jsonb
language sql
stable
security definer
set search_path to 'shared'
as $$
  select jsonb_build_object(
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'theme', s.theme,
        'starts', s.starts,
        'ends', s.ends,
        'duration_minutes', s.duration_minutes,
        'image', s.image,
        'placement_id', s.placement_id
      ) order by s.starts)
      from shared.offer_seasons s
      where s.app = p_app and s.enabled
    ), '[]'::jsonb),
    'rules', (
      select jsonb_build_object(
        'rest_days', r.rest_days,
        'refund_quiet_days', r.refund_quiet_days,
        'winback_hours', r.winback_hours
      )
      from shared.offer_rules r
      where r.app = p_app
    )
  );
$$;

revoke all on function public.shared_offer_config(text) from public;
grant execute on function public.shared_offer_config(text) to anon, authenticated;

-- Calyo's seasons, as its own project's app_config.offer_events holds them
-- (Pavel's dates of 2026-10-23). `id` = theme so this year's ids stay
-- `halloween_2026` and nobody gets a season twice. Check the live
-- app_config row before pushing: its seed used DO NOTHING, so a later edit
-- there would not be in this file.
insert into shared.offer_seasons (app, id, theme, starts, ends) values
  ('calyo', 'halloween', 'halloween', '10-13', '11-01'),
  ('calyo', 'black_friday', 'black_friday', '11-13', '11-30'),
  ('calyo', 'christmas', 'christmas', '12-13', '12-27')
on conflict (app, id) do nothing;

insert into shared.offer_rules (app, rest_days, refund_quiet_days, winback_hours)
values ('calyo', 7, 30, 48)
on conflict (app) do nothing;
