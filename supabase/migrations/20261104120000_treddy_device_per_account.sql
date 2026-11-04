-- Treddy: one phone can hold several Threads accounts, so a device token
-- belongs to every account signed in on it, not to one.
--
-- The token alone was the key: each link/sync re-pointed the phone's only
-- row at the account that synced last, so pushes for the phone's other
-- accounts (posted, failed, and the "time to post" reminders of posts the
-- user publishes themselves) went to no device at all.
--
-- Existing rows are unique by token, so they satisfy the wider key as they
-- are; the other accounts get their rows the next time the app registers.

alter table treddy.devices drop constraint if exists devices_pkey;
alter table treddy.devices add primary key (device_token, threads_user_id);
