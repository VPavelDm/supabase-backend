-- A new feedback reason, `offensive`: Google Play's AI-generated content
-- policy wants a way to report offensive output from inside the app, and the
-- Android app sends it with the dislike reasons. Before this, the function
-- dropped any key not on its list, so a report saved as a row with no reason.
--
-- Same signature and body as 20260930130000 apart from the list: installed
-- iOS apps call lyncil_add_song_feedback(uuid, text[], text). `create or
-- replace` keeps the function's grants; the grant below restates the one from
-- 20261107120000.
--
-- Idempotent like every migration here.

create or replace function public.lyncil_add_song_feedback(
  p_song_id uuid,
  p_reasons text[] default '{}',
  p_text text default ''
)
returns jsonb
language plpgsql security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
  v_song songs%rowtype;
  v_job song_jobs%rowtype;
  v_id uuid;
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;

  select * into v_song from songs where id = p_song_id and user_id = v_auth_id;
  if not found then
    raise exception 'Song not found';
  end if;

  select * into v_job from song_jobs
  where song_id = p_song_id and user_id = v_auth_id and status = 'succeeded'
  order by created_at desc limit 1;

  insert into song_feedback (user_id, song_id, task_id, provider, genre, mood, voice, reasons, text)
  values (
    v_auth_id, p_song_id, v_job.task_id, v_job.provider,
    v_song.genre, v_song.mood, v_song.voice,
    -- Known keys only, each once: the app is not the only possible caller.
    coalesce((
      select array_agg(distinct r) from unnest(p_reasons) as r
      where r in ('voice', 'melody', 'lyrics', 'genre', 'sound', 'length', 'offensive')
    ), '{}'),
    left(coalesce(trim(p_text), ''), 2000)
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.lyncil_add_song_feedback(uuid, text[], text) to authenticated;
