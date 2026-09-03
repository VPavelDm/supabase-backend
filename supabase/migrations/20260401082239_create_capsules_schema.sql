-- =============================================================================
-- Tables
-- =============================================================================

create table public.capsules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  message text not null default '',
  recipient_type text not null default 'myself',
  recipient_name text,
  sender_name text not null default '',
  delivery_date timestamptz not null,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.capsule_photos (
  id uuid primary key default gen_random_uuid(),
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.capsule_voice_notes (
  id uuid primary key default gen_random_uuid(),
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  storage_path text not null,
  duration_seconds double precision not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_capsules_user_id on public.capsules(user_id);
create index idx_capsules_delivery_date on public.capsules(delivery_date);
create index idx_capsule_photos_capsule_id on public.capsule_photos(capsule_id);
create index idx_capsule_voice_notes_capsule_id on public.capsule_voice_notes(capsule_id);

-- =============================================================================
-- Updated_at trigger
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger capsules_updated_at
  before update on public.capsules
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.capsules enable row level security;
alter table public.capsule_photos enable row level security;
alter table public.capsule_voice_notes enable row level security;

create policy "Users can select own capsules"
  on public.capsules for select
  using (auth.uid() = user_id);

create policy "Users can insert own capsules"
  on public.capsules for insert
  with check (auth.uid() = user_id);

create policy "Users can update own capsules"
  on public.capsules for update
  using (auth.uid() = user_id);

create policy "Users can delete own capsules"
  on public.capsules for delete
  using (auth.uid() = user_id);

create policy "Users can select own capsule photos"
  on public.capsule_photos for select
  using (exists (
    select 1 from public.capsules c
    where c.id = capsule_photos.capsule_id
      and c.user_id = auth.uid()
  ));

create policy "Users can insert own capsule photos"
  on public.capsule_photos for insert
  with check (exists (
    select 1 from public.capsules c
    where c.id = capsule_photos.capsule_id
      and c.user_id = auth.uid()
  ));

create policy "Users can delete own capsule photos"
  on public.capsule_photos for delete
  using (exists (
    select 1 from public.capsules c
    where c.id = capsule_photos.capsule_id
      and c.user_id = auth.uid()
  ));

create policy "Users can select own capsule voice notes"
  on public.capsule_voice_notes for select
  using (exists (
    select 1 from public.capsules c
    where c.id = capsule_voice_notes.capsule_id
      and c.user_id = auth.uid()
  ));

create policy "Users can insert own capsule voice notes"
  on public.capsule_voice_notes for insert
  with check (exists (
    select 1 from public.capsules c
    where c.id = capsule_voice_notes.capsule_id
      and c.user_id = auth.uid()
  ));

create policy "Users can delete own capsule voice notes"
  on public.capsule_voice_notes for delete
  using (exists (
    select 1 from public.capsules c
    where c.id = capsule_voice_notes.capsule_id
      and c.user_id = auth.uid()
  ));

-- =============================================================================
-- Storage buckets
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('capsule-photos', 'capsule-photos', false),
  ('capsule-voice-notes', 'capsule-voice-notes', false);

create policy "Users can upload own photos"
  on storage.objects for insert
  with check (
    bucket_id = 'capsule-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own photos"
  on storage.objects for select
  using (
    bucket_id = 'capsule-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own photos"
  on storage.objects for delete
  using (
    bucket_id = 'capsule-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload own voice notes"
  on storage.objects for insert
  with check (
    bucket_id = 'capsule-voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own voice notes"
  on storage.objects for select
  using (
    bucket_id = 'capsule-voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own voice notes"
  on storage.objects for delete
  using (
    bucket_id = 'capsule-voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- Step 01: get_capsules
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_capsules()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_capsules jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'message', c.message,
      'recipient_type', c.recipient_type,
      'recipient_name', c.recipient_name,
      'sender_name', c.sender_name,
      'delivery_date', c.delivery_date,
      'latitude', c.latitude,
      'longitude', c.longitude,
      'created_at', c.created_at,
      'photos', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'storage_path', p.storage_path,
            'sort_order', p.sort_order
          ) order by p.sort_order
        )
        from capsule_photos p
        where p.capsule_id = c.id
      ), '[]'::jsonb),
      'voice_notes', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', vn.id,
            'storage_path', vn.storage_path,
            'duration_seconds', vn.duration_seconds,
            'sort_order', vn.sort_order
          ) order by vn.sort_order
        )
        from capsule_voice_notes vn
        where vn.capsule_id = c.id
      ), '[]'::jsonb)
    ) order by c.delivery_date
  ), '[]'::jsonb)
  into v_capsules
  from capsules c
  where c.user_id = v_auth_id;

  return v_capsules;
end;
$$;

GRANT EXECUTE ON FUNCTION public.get_capsules() TO authenticated;

-- =============================================================================
-- Step 02: create_capsule
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_capsule(
  p_title text,
  p_message text DEFAULT '',
  p_recipient_type text DEFAULT 'myself',
  p_recipient_name text DEFAULT NULL,
  p_sender_name text DEFAULT '',
  p_delivery_date timestamptz DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_capsule_id uuid;
begin
  if p_delivery_date is null then
    raise exception 'delivery_date is required';
  end if;

  insert into capsules (user_id, title, message, recipient_type, recipient_name, sender_name, delivery_date, latitude, longitude)
  values (v_auth_id, p_title, p_message, p_recipient_type, p_recipient_name, p_sender_name, p_delivery_date, p_latitude, p_longitude)
  returning id into v_capsule_id;

  return jsonb_build_object(
    'id', v_capsule_id,
    'title', p_title,
    'message', p_message,
    'recipient_type', p_recipient_type,
    'recipient_name', p_recipient_name,
    'sender_name', p_sender_name,
    'delivery_date', p_delivery_date,
    'latitude', p_latitude,
    'longitude', p_longitude
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.create_capsule(text, text, text, text, text, timestamptz, double precision, double precision) TO authenticated;

-- =============================================================================
-- Step 03: delete_capsule
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_capsule(
  p_capsule_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_photo_paths text[];
  v_voice_paths text[];
begin
  -- Collect storage paths before cascade delete removes the rows
  select coalesce(array_agg(p.storage_path), '{}')
    into v_photo_paths
  from capsule_photos p
  where p.capsule_id = p_capsule_id;

  select coalesce(array_agg(vn.storage_path), '{}')
    into v_voice_paths
  from capsule_voice_notes vn
  where vn.capsule_id = p_capsule_id;

  delete from capsules
  where id = p_capsule_id
    and user_id = v_auth_id;

  if not found then
    raise exception 'Capsule not found';
  end if;

  return jsonb_build_object(
    'success', true,
    'photo_paths', to_jsonb(v_photo_paths),
    'voice_note_paths', to_jsonb(v_voice_paths)
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.delete_capsule(uuid) TO authenticated;

-- =============================================================================
-- Step 04: add_capsule_photo
-- =============================================================================

CREATE OR REPLACE FUNCTION public.add_capsule_photo(
  p_capsule_id uuid,
  p_storage_path text,
  p_sort_order int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_photo_id uuid;
begin
  -- Verify ownership
  if not exists (
    select 1 from capsules where id = p_capsule_id and user_id = v_auth_id
  ) then
    raise exception 'Capsule not found';
  end if;

  insert into capsule_photos (capsule_id, storage_path, sort_order)
  values (p_capsule_id, p_storage_path, p_sort_order)
  returning id into v_photo_id;

  return jsonb_build_object(
    'id', v_photo_id,
    'capsule_id', p_capsule_id,
    'storage_path', p_storage_path,
    'sort_order', p_sort_order
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.add_capsule_photo(uuid, text, int) TO authenticated;

-- =============================================================================
-- Step 05: add_capsule_voice_note
-- =============================================================================

CREATE OR REPLACE FUNCTION public.add_capsule_voice_note(
  p_capsule_id uuid,
  p_storage_path text,
  p_duration_seconds double precision DEFAULT 0,
  p_sort_order int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_voice_note_id uuid;
begin
  -- Verify ownership
  if not exists (
    select 1 from capsules where id = p_capsule_id and user_id = v_auth_id
  ) then
    raise exception 'Capsule not found';
  end if;

  insert into capsule_voice_notes (capsule_id, storage_path, duration_seconds, sort_order)
  values (p_capsule_id, p_storage_path, p_duration_seconds, p_sort_order)
  returning id into v_voice_note_id;

  return jsonb_build_object(
    'id', v_voice_note_id,
    'capsule_id', p_capsule_id,
    'storage_path', p_storage_path,
    'duration_seconds', p_duration_seconds,
    'sort_order', p_sort_order
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.add_capsule_voice_note(uuid, text, double precision, int) TO authenticated;
