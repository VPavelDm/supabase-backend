-- Treddy: one account on several devices, several accounts on one device.
--
-- /sync used to mirror a single device's queue: anything the device didn't
-- list was deleted server-side, so a second device wiped the first one's
-- posts on its first sync. It is a merge now, and this migration gives it
-- what a merge needs:
--   * edited_at — the device's last-edit time of a post. Last write wins
--     between devices; the server's own updated_at keeps being touched by
--     the trigger and by the publisher, so it can't serve as that clock.
--   * status 'deleted' — a tombstone. A post deleted on one device must not
--     be resurrected by another device that still holds it, and the other
--     device must learn to drop it. Tombstones are purged after 30 days.
-- It also pins accounts.settings to an object: the brief was once stored
-- double-encoded as a JSON string, which read back as "no setup" and sent a
-- returning user through onboarding again.

alter table treddy.posts
  add column if not exists edited_at timestamptz not null default now();

alter table treddy.posts drop constraint if exists posts_status_check;
alter table treddy.posts
  add constraint posts_status_check
  check (status in ('scheduled', 'publishing', 'published', 'failed', 'deleted'));

alter table treddy.accounts drop constraint if exists accounts_settings_is_object;
alter table treddy.accounts
  add constraint accounts_settings_is_object
  check (settings is null or jsonb_typeof(settings) = 'object');

-- Retention, now including tombstones.
select cron.unschedule('treddy-cleanup');
select cron.schedule('treddy-cleanup', '17 4 * * *', $$
  delete from treddy.posts
  where status in ('published', 'failed')
    and updated_at < now() - interval '90 days';
  delete from treddy.posts
  where status = 'deleted'
    and updated_at < now() - interval '30 days';
  delete from treddy.ai_usage where day < current_date - 30;
  delete from treddy.job_runs where finished_at < now() - interval '30 days';
$$);
