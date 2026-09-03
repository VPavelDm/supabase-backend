-- =============================================================================
-- Namespace Futura's tables into the `futura` schema.
--
-- This Supabase project is shared by several apps; each app keeps its tables
-- in its own schema so the dashboard stays readable (Treddy already lives in
-- `treddy`). The public RPC functions are the shipped app's API — their
-- names, signatures, and schema stay exactly as they are, only their bodies
-- now resolve tables in `futura` via search_path. No app release needed.
--
-- What moves automatically with `ALTER TABLE ... SET SCHEMA`: indexes,
-- constraints, RLS policies, and triggers (they reference the table by OID).
-- Storage policies only reference buckets, so they're untouched. The only
-- thing that breaks — and is rebuilt below — are the function bodies, which
-- resolve table names through search_path at execution time.
-- =============================================================================

create schema futura;

alter table public.capsules set schema futura;
alter table public.capsule_photos set schema futura;
alter table public.capsule_voice_notes set schema futura;
alter table public.profiles set schema futura;

-- The updated_at trigger helper is Futura's too; the trigger keeps working
-- because it references the function by OID.
alter function public.set_updated_at() set schema futura;

-- =============================================================================
-- Capsule RPCs — same API, tables now resolved in `futura`
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_capsules(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_ascending boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'futura'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_limit int := least(greatest(p_limit, 0), 100);
  v_offset int := greatest(p_offset, 0);
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
      'opened_at', c.opened_at,
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
    ) order by c.ord
  ), '[]'::jsonb)
  into v_capsules
  from (
    select *, row_number() over (
      order by
        case when p_ascending then delivery_date end asc,
        case when not p_ascending then delivery_date end desc,
        id
    ) as ord
    from capsules
    where user_id = v_auth_id
    order by ord
    limit v_limit
    offset v_offset
  ) c;

  return v_capsules;
end;
$$;

GRANT EXECUTE ON FUNCTION public.get_capsules(int, int, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.open_capsule(
  p_capsule_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'futura'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_opened_at timestamptz;
begin
  update capsules
  set opened_at = coalesce(opened_at, now())
  where id = p_capsule_id
    and user_id = v_auth_id
    and delivery_date <= now()
  returning opened_at into v_opened_at;

  if not found then
    raise exception 'Capsule not found or still locked';
  end if;

  return jsonb_build_object(
    'id', p_capsule_id,
    'opened_at', v_opened_at
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.open_capsule(uuid) TO authenticated;

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
SET search_path TO 'futura'
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

CREATE OR REPLACE FUNCTION public.delete_capsule(
  p_capsule_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'futura'
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

CREATE OR REPLACE FUNCTION public.add_capsule_photo(
  p_capsule_id uuid,
  p_storage_path text,
  p_sort_order int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'futura'
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

CREATE OR REPLACE FUNCTION public.add_capsule_voice_note(
  p_capsule_id uuid,
  p_storage_path text,
  p_duration_seconds double precision DEFAULT 0,
  p_sort_order int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'futura'
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

-- =============================================================================
-- Profile RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_profile_if_needed()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'futura'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where auth_id = v_auth_id;

  if found then
    return jsonb_build_object(
      'auth_id', v_profile.auth_id,
      'name', v_profile.name,
      'birthday', v_profile.birthday,
      'timezone', v_profile.timezone,
      'passed_onboarding', v_profile.passed_onboarding
    );
  end if;

  insert into profiles (auth_id)
  values (v_auth_id)
  on conflict (auth_id) do nothing;

  select * into v_profile from profiles where auth_id = v_auth_id;

  return jsonb_build_object(
    'auth_id', v_profile.auth_id,
    'name', v_profile.name,
    'birthday', v_profile.birthday,
    'passed_onboarding', v_profile.passed_onboarding
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.create_profile_if_needed() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_profile()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'futura'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where auth_id = v_auth_id;

  if not found then
    raise exception 'Profile not found';
  end if;

  return jsonb_build_object(
    'auth_id', v_profile.auth_id,
    'name', v_profile.name,
    'birthday', v_profile.birthday,
    'passed_onboarding', v_profile.passed_onboarding
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.get_profile() TO authenticated;

CREATE OR REPLACE FUNCTION public.update_profile(
  p_name text DEFAULT NULL,
  p_birthday date DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_passed_onboarding boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'futura'
AS $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  update profiles
  set
    name = coalesce(p_name, name),
    birthday = coalesce(p_birthday, birthday),
    timezone = coalesce(p_timezone, timezone),
    passed_onboarding = coalesce(p_passed_onboarding, passed_onboarding)
  where auth_id = v_auth_id
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found';
  end if;

  return jsonb_build_object(
    'auth_id', v_profile.auth_id,
    'name', v_profile.name,
    'birthday', v_profile.birthday,
    'passed_onboarding', v_profile.passed_onboarding
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile(text, date, text, boolean) TO authenticated;
