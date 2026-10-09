-- Share links: music.lyncil.com/s/<slug> plays one of a user's songs to
-- anyone with the link (functions/lyncil/share.ts). A link is a pointer, not
-- a copy: the page reads the song as it is now, so edits show, and a deleted
-- song (deleted_at) reads as gone without touching the link.
--
-- One live link per song: sharing again hands back the same slug. Stopping
-- sharing sets revoked_at, and sharing after that makes a new slug, so a
-- link that went somewhere it shouldn't stays dead.
--
-- The slug is the only secret: 12 random base62 characters (~71 bits), never
-- the song id, so links can't be guessed or walked.
--
-- No view or play counters here: a write per page view would land on the
-- Disk IO budget the shared project is already short of.
--
-- Idempotent like every migration here.

create table if not exists lyncil.song_shares (
  slug text primary key check (slug ~ '^[A-Za-z0-9]{12}$'),
  song_id uuid not null references lyncil.songs (id) on delete cascade,
  user_id uuid not null references lyncil.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists song_shares_live_song_idx
  on lyncil.song_shares (song_id)
  where revoked_at is null;

-- Reached only by the edge function over the direct connection; the lyncil
-- schema is not exposed through PostgREST. RLS on as a guard all the same.
alter table lyncil.song_shares enable row level security;
