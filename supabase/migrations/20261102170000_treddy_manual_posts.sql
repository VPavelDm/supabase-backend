-- Treddy: a planned post can be one the user posts themselves.
--
--   * manual — the autoposter leaves the post alone; at its time the
--     account's devices get a "time to post" push instead, and the user
--     marks it published from the app once it's out.
--   * reminded_at — when that push went out, so it goes out once. Moving
--     the post to another time clears it (see sync.ts).
--
-- Both default to what every existing row already is: autoposted, never
-- reminded.

alter table treddy.posts
  add column if not exists manual boolean not null default false,
  add column if not exists reminded_at timestamptz;
