-- Lyncil's seasons and offer rules in shared.offer_seasons / shared.offer_rules
-- (20261101120000_shared_offer_seasons.sql): the same dates and numbers as
-- Calyo's (Pavel, 2026-11-01). From 4.15 builds on, Lyncil reads its seasons
-- only from here — Remote Config `offer_seasons` is no longer read — so with
-- no rows here there is no seasonal offer.
--
-- `id` = theme, so this year's ids read `halloween_2026` like the Remote
-- Config seasons did, and a user who already had a season this year doesn't
-- get it again. The themes are the ones Lyncil has artwork and wording for
-- (`OfferTheme`: halloween, black_friday, christmas).
--
-- Idempotent like every migration here.

insert into shared.offer_seasons (app, id, theme, starts, ends) values
  ('lyncil', 'halloween', 'halloween', '10-13', '11-01'),
  ('lyncil', 'black_friday', 'black_friday', '11-13', '11-30'),
  ('lyncil', 'christmas', 'christmas', '12-13', '12-27')
on conflict (app, id) do nothing;

insert into shared.offer_rules (app, rest_days, refund_quiet_days, winback_hours)
values ('lyncil', 7, 30, 48)
on conflict (app) do nothing;
