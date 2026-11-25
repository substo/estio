BEGIN;
-- Claim time for a video job: the id of this person's latest finished turnaround and face sheets, so the Mac can draw storyboard frames from them.
CREATE FUNCTION studio.studio_job_character_sheets(p_location_id text, p_clerk_user_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 select coalesce(jsonb_agg(jsonb_build_object('sheet',x.sheet,'jobId',x.id) order by x.sheet desc),'[]'::jsonb)
 from (select distinct on (payload->>'sheet') payload->>'sheet' as sheet, id from studio.studio_jobs
  where location_id=p_location_id and created_by_clerk_user_id=p_clerk_user_id and kind='studio.character_sheet' and status='succeeded' and payload->>'sheet' in ('turnaround','face')
  order by payload->>'sheet', finished_at desc) x
$$;
REVOKE ALL ON FUNCTION studio.studio_job_character_sheets(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_job_character_sheets(text,text) TO service_role;
COMMIT;
