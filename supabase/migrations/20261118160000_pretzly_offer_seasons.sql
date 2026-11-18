-- Seasonal offers for Pretzly: Calyo's seasons and rules (see
-- 20261101120000_shared_offer_seasons.sql), one set of rows for app 'pretzly'.
-- Read by Pretzly's `PretzlyOfferService` through onboarding-ios'
-- `SharedBackendOfferConfig` (`shared_offer_config('pretzly')`); `id` = theme,
-- so this year's windows read `christmas_2026` and nobody gets a season twice.
--
-- Pretzly's Supabase project is a different one; only these public season rows
-- live here.
--
-- Only Pretzly versions with offers (iOS, from the offers release) read these
-- rows. From then on an edit reaches every installed copy
-- at its next launch, and a season whose dates include today turns on for every
-- free user at once: a release before Nov 30 opens on Black Friday, one after
-- Dec 13 on Christmas.
--
-- Idempotent like every migration here.

insert into shared.offer_seasons (app, id, theme, starts, ends) values
  ('pretzly', 'halloween', 'halloween', '10-13', '11-01'),
  ('pretzly', 'black_friday', 'black_friday', '11-13', '11-30'),
  ('pretzly', 'christmas', 'christmas', '12-13', '12-27')
on conflict (app, id) do nothing;

insert into shared.offer_rules (app, rest_days, refund_quiet_days, winback_hours)
values ('pretzly', 7, 30, 48)
on conflict (app) do nothing;
