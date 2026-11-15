-- Affirmations: texts for the App Blocker's shield screen.
--
-- When a blocked app opens, iOS shows a shield drawn by an extension of the
-- app. The extension has no network, so the app downloads this pool while it's
-- open and keeps it in its App Group; the extension picks a random card from it
-- (never the one shown last). The app bundles the same English set for phones
-- that haven't downloaded anything yet.
--
-- A card is a title (up to ~40 characters), a subtitle (~90) and the label of
-- the button that closes the blocked app (~15); the limits below are a little
-- looser so a translation can run longer. Cards are per language; the app falls
-- back to English. Turn a card off with is_active instead of deleting it.
--
-- No user data: nothing to add to erase-user.ts or delete-my-data.ts.
--
-- Idempotent like every migration here.

-- MARK: - Table

create table if not exists affirmations.shield_texts (
  id text primary key check (char_length(id) between 1 and 64),
  language text not null check (char_length(language) between 2 and 8),
  title text not null check (char_length(title) between 1 and 60),
  subtitle text not null check (char_length(subtitle) between 1 and 120),
  button text not null check (char_length(button) between 1 and 24),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shield_texts_language_idx
  on affirmations.shield_texts (language, sort_order) where is_active;

drop trigger if exists affirmations_set_updated_at on affirmations.shield_texts;
create trigger affirmations_set_updated_at
  before update on affirmations.shield_texts
  for each row execute function shared.set_updated_at();

alter table affirmations.shield_texts enable row level security;
revoke all on affirmations.shield_texts from public, anon, authenticated;

-- MARK: - Seed (the app's bundled English set)

insert into affirmations.shield_texts (id, language, title, subtitle, button, sort_order) values
  ('en.pause', 'en', 'A small pause', 'This app can wait. Take 30 seconds for yourself in Here first.', 'Back to calm', 0),
  ('en.later', 'en', 'Not right now', 'Your feed will still be there. This moment won''t.', 'Not now', 1),
  ('en.breath', 'en', 'Take a breath first', 'Thirty seconds of calm, then it''s all yours.', 'Back to calm', 2),
  ('en.autopilot', 'en', 'Opened this on autopilot?', 'Maybe, maybe not. Either way, breathe first.', 'Not now', 3),
  ('en.nothing', 'en', 'You''re allowed to do nothing', 'Sit with it for a minute. Nothing here needs you yet.', 'Back to calm', 4),
  ('en.endless', 'en', 'Still scrolling?', 'The scroll is endless. Your evening isn''t.', 'Not now', 5),
  ('en.attention', 'en', 'Easy does it', 'I choose what gets my attention.', 'Back to calm', 6),
  ('en.checkin', 'en', 'Check in with yourself', 'How do you feel? Ask yourself before the app tells you.', 'Not now', 7)
on conflict (id) do update set
  language = excluded.language,
  title = excluded.title,
  subtitle = excluded.subtitle,
  button = excluded.button,
  sort_order = excluded.sort_order;

-- MARK: - Read

-- Every active card in every language; the app keeps them all, so the shield can
-- follow the phone's language without another download.
create or replace function public.affirmations_get_shield_texts()
returns table (id text, language text, title text, subtitle text, button text)
language plpgsql security definer
set search_path to 'affirmations'
as $$
begin
  perform affirmations.require_user();
  return query
    select t.id, t.language, t.title, t.subtitle, t.button
    from shield_texts t
    where t.is_active
    order by t.language, t.sort_order, t.id;
end;
$$;

revoke all on function public.affirmations_get_shield_texts() from public, anon, authenticated;
grant execute on function public.affirmations_get_shield_texts() to authenticated;
