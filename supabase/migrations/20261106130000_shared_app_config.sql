-- Public key/value config that every app on the project reads at launch: first of all the
-- force-update floors (futura_ios_minimum_version, futura_ios_recommended_version,
-- treddy_ios_minimum_version, treddy_ios_recommended_version), compared with the app's
-- CFBundleShortVersionString. A missing row or blank value means "no requirement", and the apps
-- start normally when they can't read the table at all.
--
-- In `public`, not an app schema: clients read it straight through PostgREST with the
-- publishable key, like the app-facing RPCs. Anyone may read it; only service_role (the
-- dashboard, migrations) writes it, so keep secrets out of it.
--
-- Raising a *_minimum_version locks out every installed build below it at its next launch, all at
-- once. Set it only to a version already live in the store and installed by most users.
-- No rows are seeded on purpose.

create table if not exists public.app_config (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists "Anyone can read app_config" on public.app_config;
create policy "Anyone can read app_config"
on public.app_config for select
to anon, authenticated
using (true);

revoke all on table public.app_config from anon, authenticated;
grant select on table public.app_config to anon, authenticated;
grant all on table public.app_config to service_role;

drop trigger if exists app_config_set_updated_at on public.app_config;
create trigger app_config_set_updated_at
before update on public.app_config
for each row execute function shared.set_updated_at();
