-- Disk IO on the Nano instance (dashboard: "Project is depleting its Disk IO
-- Budget", 2026-10-07). The steady drain was treddy-publish-due firing every
-- minute: each run writes cron.job_run_details, pg_net's request queue and
-- response table, and treddy.job_runs, then autovacuum rewrites them — 1,440
-- times a day to publish about three posts, 94 of 102 of them scheduled on
-- the hour or half hour.
--
-- Every 5 minutes keeps those on time and delays an odd-minute post by at
-- most four; the run history is purged daily rather than weekly, still
-- keeping a week. (net._http_response was also compacted once by hand with
-- VACUUM FULL: 64 MB holding 443 kB of rows. pg_net deletes its own rows.)
--
-- Idempotent like every migration here.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'treddy-publish-due'),
  schedule := '*/5 * * * *'
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'shared-purge-cron-history'),
  schedule := '0 4 * * *'
);
