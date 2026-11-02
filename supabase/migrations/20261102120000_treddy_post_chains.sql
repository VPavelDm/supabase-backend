-- Treddy: a planned post can be a chain of posts.
--
--   * follow_ups — the posts that go out after `text`, each answering the
--     one before. Empty for a single post.
--   * part_media_ids — Threads IDs of the chain's posts that already went
--     out, in order. Publishing is not idempotent: a chain that stopped
--     partway (a failed post, or a run that died) goes on after the last of
--     these instead of posting the earlier ones again. The first one is the
--     post the app shows stats for, so it's backfilled from
--     published_media_id.

alter table treddy.posts
  add column if not exists follow_ups jsonb not null default '[]'::jsonb,
  add column if not exists part_media_ids jsonb not null default '[]'::jsonb;

alter table treddy.posts drop constraint if exists posts_follow_ups_is_array;
alter table treddy.posts
  add constraint posts_follow_ups_is_array check (jsonb_typeof(follow_ups) = 'array');

alter table treddy.posts drop constraint if exists posts_part_media_ids_is_array;
alter table treddy.posts
  add constraint posts_part_media_ids_is_array check (jsonb_typeof(part_media_ids) = 'array');

update treddy.posts
set part_media_ids = jsonb_build_array(published_media_id)
where published_media_id is not null
  and part_media_ids = '[]'::jsonb;
