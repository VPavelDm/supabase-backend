-- Every subscription in Lyncil's App Store group, with its level and billing
-- period, read from the App Store Connect API (functions/lyncil/store-products.ts).
-- The level decides what a plan buys (Pavel, 2026-10-18): level 1 is the
-- songs plans, every other level (2 on sale, 3 and beyond retired) lyrics
-- only. The app splits its paywall by the same rule, from StoreKit.
--
-- The function refreshes the whole table when it is a month old, or when a
-- purchase names a product the table doesn't have (at most every 10 minutes),
-- so a new product in App Store Connect needs nothing here. To pick up a
-- level change at once, empty it and the next song check refills it:
--
--   supabase db query --linked "delete from lyncil.store_products"
--
-- Idempotent like every migration here.

create table if not exists lyncil.store_products (
  product_id text primary key,
  group_level int not null check (group_level >= 1),
  -- App Store Connect's subscriptionPeriod: ONE_WEEK, ONE_MONTH, ONE_YEAR…
  period text,
  state text,
  refreshed_at timestamptz not null default now()
);

-- Reached only by the edge function over the direct connection; the lyncil
-- schema is not exposed through PostgREST. RLS on as a guard all the same.
alter table lyncil.store_products enable row level security;
