-- =============================================================================
-- Track when a capsule was first opened by its owner.
--
-- Adds capsules.opened_at, exposes it through get_capsules, and adds
-- open_capsule() which stamps the first-open time (idempotent — the original
-- open time is never overwritten, and locked capsules cannot be opened).
-- =============================================================================

alter table public.capsules add column opened_at timestamptz;

-- =============================================================================
-- get_capsules — same signature, now returns opened_at
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_capsules(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_ascending boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
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

-- =============================================================================
-- open_capsule
-- =============================================================================

CREATE OR REPLACE FUNCTION public.open_capsule(
  p_capsule_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
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
