-- Seasonal offers for the Lingo apps (Hutarka, Hejka): Calyo's seasons and
-- rules as `shared_offer_config('calyo')` serves them on 2026-11-13, one set
-- of rows per app (see 20261101120000_shared_offer_seasons.sql: no shared
-- "all apps" row). Read by each app's `LingoOffer` through onboarding-ios'
-- `SharedBackendOfferConfig`; `id` = theme, so this year's windows read
-- `black_friday_2026` and nobody gets a season twice.
--
-- Black Friday starts the day this lands: every installed copy picks it up at
-- its next launch. A season sells the apps' own `<app>_annual_offer` on their
-- own ticket screen, which has no seasonal look of its own.
--
-- Idempotent like every migration here.

insert into shared.offer_seasons (app, id, theme, starts, ends) values
  ('hutarka', 'halloween', 'halloween', '10-13', '11-01'),
  ('hutarka', 'black_friday', 'black_friday', '11-13', '11-30'),
  ('hutarka', 'christmas', 'christmas', '12-13', '12-27'),
  ('hejka', 'halloween', 'halloween', '10-13', '11-01'),
  ('hejka', 'black_friday', 'black_friday', '11-13', '11-30'),
  ('hejka', 'christmas', 'christmas', '12-13', '12-27')
on conflict (app, id) do nothing;

insert into shared.offer_rules (app, rest_days, refund_quiet_days, winback_hours) values
  ('hutarka', 7, 30, 48),
  ('hejka', 7, 30, 48)
on conflict (app) do nothing;
