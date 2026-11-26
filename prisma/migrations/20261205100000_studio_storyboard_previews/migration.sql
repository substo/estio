BEGIN;
-- Storyboard previews: before a video is made, the creator's own Mac draws one picture per script beat (the creator in the scene, from their photos and character sheets) with Codex, so the creator can approve the storyboard and the edit then uses those pictures.
-- Additive. Runs as the same device job kind as character sheets (sheet = 'storyboard'), so the Mac needs no new permission; only the result check is widened. Pictures live in private storage and only the creator who asked can see them.

CREATE FUNCTION studio.studio_request_storyboard(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid,p_beats jsonb,p_portrait boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; why text;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_beats is null or jsonb_typeof(p_beats)<>'array' or jsonb_array_length(p_beats) not between 1 and 6 or octet_length(p_beats::text)>12000
  or exists(select 1 from jsonb_array_elements(p_beats) b where jsonb_typeof(b)<>'object' or exists(select 1 from jsonb_object_keys(b) k where k not in ('n','prompt','h'))
   or coalesce(b->>'n','') !~ '^[1-6]$' or jsonb_typeof(b->'prompt')<>'string' or char_length(b->>'prompt') not between 1 and 1500 or coalesce(b->>'h','') !~ '^[0-9a-f]{64}$') then raise exception 'Invalid storyboard' using errcode='SB001'; end if;
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

-- What the page shows: the latest request for this piece, and the latest finished set of pictures (with the script fingerprints they were drawn from).
CREATE FUNCTION studio.studio_storyboard_state(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 return studio.studio_storyboard_for(p_location_id,p_clerk_user_id,p_record_id);
end $$;

-- The same, for the server at claim time (no member check: the caller is the claim path for that user's own job).
CREATE FUNCTION studio.studio_storyboard_for(p_location_id text,p_clerk_user_id text,p_record_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 select jsonb_build_object(
  'latest',(select jsonb_build_object('jobId',x.id,'status',x.status,'error',case when x.status in ('failed','cancelled') then left(coalesce(x.last_error_message,''),300) end,'createdAt',x.created_at,'finishedAt',x.finished_at)
    from studio.studio_jobs x where x.location_id=p_location_id and x.kind='studio.character_sheet' and x.payload->>'sheet'='storyboard' and x.payload->>'recordId'=p_record_id::text and x.created_by_clerk_user_id=p_clerk_user_id order by x.created_at desc limit 1),
  'ready',(select jsonb_build_object('jobId',x.id,'files',x.result->'files','beats',x.payload->'beats','finishedAt',x.finished_at)
    from studio.studio_jobs x where x.location_id=p_location_id and x.kind='studio.character_sheet' and x.payload->>'sheet'='storyboard' and x.payload->>'recordId'=p_record_id::text and x.created_by_clerk_user_id=p_clerk_user_id and x.status='succeeded' order by x.finished_at desc limit 1));
$$;

-- The sheet device command, widened: a storyboard result is 1 to 6 files named frame-N.png. Sheets keep their own check.
CREATE OR REPLACE FUNCTION studio.studio_character_sheet_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; r jsonb;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_operation not in ('claim','extend','complete','fail') then
  return studio.studio_voice_preview_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;

 if p_operation='claim' then
  if coalesce(p_body->>'leaseSeconds','') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 then raise exception 'Invalid lease' using errcode='22023'; end if;
  perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
  select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
  if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
  update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',last_error_message='The Mac stopped before finishing this sheet.',finished_at=clock_timestamp(),updated_at=clock_timestamp()
   where device_id=d.id and kind='studio.character_sheet' and status='running' and lease_expires_at<=clock_timestamp();
  if not d.paused and d.processing_enabled and 'studio.character_sheet'=any(d.allowed_kinds) and p_body->>'sheetReady'='true'
   and not exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind='studio.character_sheet' and execution_target='device' and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
  return studio.studio_voice_preview_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;

 if coalesce(p_body->>'jobId','') !~ '^[0-9a-f-]{36}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and execution_target='device' and kind='studio.character_sheet' for update;
 if not found then return studio.studio_voice_preview_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then
  return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end;
 end if;
 if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
 if p_operation='fail' then
  return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,coalesce(nullif(p_body#>>'{failure,code}',''),'character_sheet_failed'),left(coalesce(p_body#>>'{failure,message}','The Mac could not draw this sheet.'),300),false,null));
 end if;
 r:=p_body->'result';
 if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k not in ('sheet','files'))
  or r->>'sheet' is distinct from j.payload->>'sheet' or jsonb_typeof(r->'files') is distinct from 'array' or jsonb_array_length(r->'files') not between 1 and 6
  or exists(select 1 from jsonb_array_elements(r->'files') f where jsonb_typeof(f) is distinct from 'string' or (f#>>'{}') !~ (case when j.payload->>'sheet'='storyboard' then '^frame-[1-6]\.png$' else '^sheet-[1-4]\.png$' end))
  or (j.payload->>'sheet'<>'storyboard' and jsonb_array_length(r->'files')>4) then raise exception 'Invalid character sheet result' using errcode='22023'; end if;
 return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,r));
end $$;

REVOKE ALL ON FUNCTION studio.studio_request_storyboard(text,text,text,uuid,jsonb,boolean),studio.studio_storyboard_state(text,text,text,uuid),studio.studio_storyboard_for(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_storyboard(text,text,text,uuid,jsonb,boolean),studio.studio_storyboard_state(text,text,text,uuid),studio.studio_storyboard_for(text,text,uuid) TO service_role;
COMMIT;
