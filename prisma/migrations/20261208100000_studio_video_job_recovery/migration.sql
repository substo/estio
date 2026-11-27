BEGIN;

-- A deploy can interrupt the Mac's final report after the editor has already stopped. Recover expired video leases on reads too,
-- not only on the next device claim, so the content page cannot remain "Editing" forever while the Mac is idle.
CREATE FUNCTION studio.studio_timeout_stuck_video_jobs(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare n integer;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,
   last_error_code='worker_report_timeout',last_error_message='The Mac stopped before it could report the result. Retry.',
   finished_at=clock_timestamp(),updated_at=clock_timestamp()
  where location_id=p_location_id and kind in ('studio.video_assemble','studio.video_edit','studio.open_editor')
   and payload->>'recordId'=p_record_id::text and status='running' and lease_expires_at<=clock_timestamp();
 get diagnostics n = row_count;
 return n;
end $$;
REVOKE ALL ON FUNCTION studio.studio_timeout_stuck_video_jobs(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_timeout_stuck_video_jobs(text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION studio.studio_video_loop_state(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare kept boolean; versions jsonb; thread jsonb; opened jsonb; busy boolean; retry_job_id uuid;
begin
 perform studio.studio_timeout_stuck_video_jobs(p_location_id,p_actor_app,p_clerk_user_id,p_record_id);
 select coalesce((select (x.result#>>'{assembly,projectKept}')='true' from studio.studio_jobs x where x.location_id=p_location_id and x.kind in ('studio.video_assemble','studio.video_edit')
   and x.payload->>'recordId'=p_record_id::text and x.status='succeeded' order by x.finished_at desc nulls last limit 1),false) into kept;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.original_filename,'bytes',u.byte_size,'createdAt',u.created_at,'timeline',(select x.result#>'{assembly,timeline}' from studio.studio_jobs x where x.location_id=p_location_id and x.kind in ('studio.video_assemble','studio.video_edit') and x.payload->>'recordId'=p_record_id::text and x.status='succeeded' and x.result#>>'{assembly,uploadId}'=u.id::text and x.result#>'{assembly,timeline}' is not null order by x.finished_at desc nulls last limit 1)) order by u.created_at desc),'[]'::jsonb) into versions
  from (select * from studio.studio_uploads x where x.location_id=p_location_id and x.record_id=p_record_id and x.status='uploaded' and x.content_type='video/mp4' and x.original_filename like 'Edited video %' order by x.created_at desc limit 20) u;
 select coalesce(jsonb_agg(t order by t->>'createdAt'),'[]'::jsonb) into thread from (
  select jsonb_build_object('id',msg.id,'instruction',msg.instruction,'createdAt',msg.created_at,'status',coalesce(jb.status,'failed'),
    'reply',coalesce(jb.result#>>'{assembly,summary}',case when jb.status in ('failed','cancelled') then jb.last_error_message end)) t
  from studio.studio_video_edit_messages msg left join studio.studio_jobs jb on jb.id=msg.job_id
  where msg.location_id=p_location_id and msg.record_id=p_record_id order by msg.created_at desc limit 30) s;
 select jsonb_build_object('jobId',x.id,'status',x.status,'message',x.last_error_message) into opened from studio.studio_jobs x
  where x.location_id=p_location_id and x.kind='studio.open_editor' and x.payload->>'recordId'=p_record_id::text order by x.created_at desc limit 1;
 select exists(select 1 from studio.studio_jobs x where x.location_id=p_location_id and x.kind in ('studio.video_assemble','studio.video_edit') and x.payload->>'recordId'=p_record_id::text and x.status in ('queued','running')) into busy;
 select x.id into retry_job_id from studio.studio_jobs x where x.location_id=p_location_id
  and x.kind in ('studio.video_assemble','studio.video_edit','studio.open_editor') and x.payload->>'recordId'=p_record_id::text
  and x.status='failed' and x.last_error_code='worker_report_timeout' order by x.finished_at desc nulls last limit 1;
 return jsonb_build_object('projectKept',kept,'versions',versions,'thread',thread,'openEditor',opened,'busy',busy,'retryJobId',retry_job_id);
end $$;

COMMIT;
