BEGIN;

-- A storyboard beat may be an object/UI-only shot. Persist that decision so the Mac does not
-- introduce the creator from saved reference photos when the visual note asks only for an interface.
CREATE OR REPLACE FUNCTION studio.studio_request_storyboard(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid,p_beats jsonb,p_portrait boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; why text;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_beats is null or jsonb_typeof(p_beats)<>'array' or jsonb_array_length(p_beats) not between 1 and 40 or octet_length(p_beats::text)>90000
  or exists(select 1 from jsonb_array_elements(p_beats) b where jsonb_typeof(b)<>'object' or exists(select 1 from jsonb_object_keys(b) k where k not in ('n','prompt','h','person'))
   or coalesce(b->>'n','') !~ '^([1-9]|[1-3][0-9]|40)$' or jsonb_typeof(b->'prompt')<>'string' or char_length(b->>'prompt') not between 1 and 1500
   or coalesce(b->>'h','') !~ '^[0-9a-f]{64}$' or (b ? 'person' and jsonb_typeof(b->'person')<>'boolean')) then raise exception 'Invalid storyboard' using errcode='SB001'; end if;
 if not exists(select 1 from studio.studio_records where location_id=p_location_id and id=p_record_id and kind='content') then raise exception 'Content not found' using errcode='SB002'; end if;
 select * into j from studio.studio_jobs where location_id=p_location_id and kind='studio.character_sheet' and payload->>'sheet'='storyboard' and payload->>'recordId'=p_record_id::text and created_by_clerk_user_id=p_clerk_user_id and status in ('queued','running') limit 1;
 if found then return jsonb_build_object('jobId',j.id,'status',j.status,'reused',true); end if;
 select * into d from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null
  and x.processing_enabled and 'studio.character_sheet'=any(x.allowed_kinds) and x.report->'handlers' ? 'studio.character_sheet'
  and x.report#>>'{characterSheet,ready}'='true' order by x.seen_at desc nulls last limit 1 for share;
 if not found then
  why:=case
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null) then 'CS011'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled) then 'CS012'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled and x.report->'handlers' ? 'studio.character_sheet') then 'CS014'
   else 'CS013' end;
  raise exception 'No ready Mac' using errcode=why;
 end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.character_sheet',jsonb_build_object('sheet','storyboard','recordId',p_record_id,'portrait',coalesce(p_portrait,false),'beats',p_beats),'sboard:'||p_record_id::text||':'||gen_random_uuid()::text,p_clerk_user_id,1);
 if j.execution_target<>'device' then update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'reused',false);
end $$;

REVOKE ALL ON FUNCTION studio.studio_request_storyboard(text,text,text,uuid,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_storyboard(text,text,text,uuid,jsonb,boolean) TO service_role;

COMMIT;
