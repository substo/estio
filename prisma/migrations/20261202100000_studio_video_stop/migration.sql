-- Stop a video that is being made or changed. The owner's own action, on their own piece.
-- A queued job is simply cancelled. A running one loses its lease: the Mac's next lease check (about every 40 s) is refused, so it aborts the agent.
-- Edits the agent already saved stay in the project's history (undo and restore still work); nothing is rolled back.
CREATE FUNCTION studio.studio_stop_video(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare n integer;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 perform 1 from studio.studio_records where location_id=p_location_id and id=p_record_id and kind='content';
 if not found then raise exception 'Content not found' using errcode='VE001'; end if;
 update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,
   last_error_code='video_stopped',last_error_message='Stopped. Changes the agent already saved stay in the project history.'
  where location_id=p_location_id and kind in ('studio.video_assemble','studio.video_edit') and payload->>'recordId'=p_record_id::text and status in ('queued','running');
 get diagnostics n = row_count;
 return jsonb_build_object('stopped',n);
end $$;
REVOKE ALL ON FUNCTION studio.studio_stop_video(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_stop_video(text,text,text,uuid) TO service_role;
