-- Shared utilities for the multi-app project: a `shared` schema for helpers
-- every app uses, plus housekeeping for the cron machinery itself.

create schema if not exists shared;

-- One updated_at trigger helper for every app. Futura's namespace migration
-- left it as futura.set_updated_at; move it here if it still lives there —
-- existing triggers reference the function by OID and keep working.
do $$
begin
  if exists (
    select from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at' and n.nspname = 'futura'
  ) then
    alter function futura.set_updated_at() set schema shared;
  end if;
end $$;

create or replace function shared.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- cron.job_run_details grows unbounded (treddy-publish-due alone adds ~1440
-- rows a day); keep a week of history. pg_net cleans its own response table.
select cron.schedule('shared-purge-cron-history', '0 4 * * 0', $$
  delete from cron.job_run_details where end_time < now() - interval '7 days'
$$);
