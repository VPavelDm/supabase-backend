-- Seed 13 capsules per existing profile for App Store screenshots.
--
-- Each capsule delivers roughly 1..13 weeks out, with a random day and time
-- within the week so the home list shows varied countdowns and no two
-- delivery dates collide.
--
-- Run manually from the supabase/ directory:
--   supabase db execute --file snippets/seed_screenshot_capsules.sql
-- or paste into the SQL editor in Supabase Studio.

do $$
declare
  v_profile record;
  v_titles text[] := array[
    'Note to my future self',
    'After the move to a new city',
    'When the baby turns one',
    'Open after the marathon',
    'Six months into the new job',
    'On our wedding anniversary',
    'After the trip to Japan',
    'Halfway through grad school',
    'When I finish the novel',
    'Birthday surprise for myself',
    'After my first solo recital',
    'For my future self, with love',
    'When I finally learn to surf'
  ];
  i int;
begin
  update public.profiles set passed_onboarding = true;

  for v_profile in
    select p.auth_id
    from public.profiles p
  loop
    for i in 1..13 loop
      insert into public.capsules (user_id, title, recipient_type, delivery_date)
      values (
        v_profile.auth_id,
        v_titles[i],
        'myself',
        now()
          + (i || ' weeks')::interval
          + ((floor(random() * 86400 * 7) - 86400 * 3)::int || ' seconds')::interval
      );
    end loop;
  end loop;
end $$;
