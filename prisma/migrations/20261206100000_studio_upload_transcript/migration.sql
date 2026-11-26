BEGIN;
-- Upload transcripts on the creator's own Mac: Parakeet (offline) turns an uploaded video's speech into timed lines, so the script can be matched to moments of the creator's own footage without any paid transcription.
-- Additive. Runs as the same device job kind as character sheets (sheet = 'transcript'); the timed lines travel as one private file the server reads and stores, never through the job result. A transcript job does not need Codex, so it can be claimed when the sheet drawer is not ready.

CREATE FUNCTION studio.studio_request_upload_transcript(p_location_id text,p_actor_app text,p_clerk_user_id text,p_upload_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; why text;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if not exists(select 1 from studio.studio_uploads where id=p_upload_id and location_id=p_location_id and status='uploaded' and (content_type like 'video/%' or content_type like 'audio/%')) then raise exception 'Upload not found' using errcode='UT001'; end if;
 if exists(select 1 from studio.studio_transcripts where upload_id=p_upload_id and location_id=p_location_id) then return jsonb_build_object('status','done','reused',true); end if;
 select * into j from studio.studio_jobs where location_id=p_location_id and kind='studio.character_sheet' and payload->>'sheet'='transcript' and payload->>'uploadId'=p_upload_id::text and created_by_clerk_user_id=p_clerk_user_id and status in ('queued','running') limit 1;
 if found then return jsonb_build_object('jobId',j.id,'status',j.status,'reused',true); end if;
 select * into d from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null
  and x.processing_enabled and 'studio.character_sheet'=any(x.allowed_kinds) and x.report->'handlers' ? 'studio.character_sheet'
  and x.report#>>'{transcribeUpload,ready}'='true' order by x.seen_at desc nulls last limit 1 for share;
 if not found then
  why:=case
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null) then 'UT011'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled) then 'UT012'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled and x.report#>>'{transcribeUpload,ready}' is not null) then 'UT014'
   else 'UT013' end;
  raise exception 'No ready Mac' using errcode=why;
 end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.character_sheet',jsonb_build_object('sheet','transcript','uploadId',p_upload_id),'utrans:'||p_upload_id::text||':'||gen_random_uuid()::text,p_clerk_user_id,1);
 if j.execution_target<>'device' then update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'reused',false);
end $$;

-- The requester's latest transcript job for each of these uploads (and whether a transcript already exists), for the page and for the server to read finished lines.
CREATE FUNCTION studio.studio_upload_transcript_state(p_location_id text,p_actor_app text,p_clerk_user_id text,p_upload_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_upload_ids is null or cardinality(p_upload_ids)>50 then raise exception 'Too many uploads' using errcode='UT002'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('uploadId',u,'transcribed',exists(select 1 from studio.studio_transcripts t where t.upload_id=u and t.location_id=p_location_id),
   'jobId',x.id,'status',x.status,'error',case when x.status in ('failed','cancelled') then left(coalesce(x.last_error_message,''),300) end))
  from unnest(p_upload_ids) u left join lateral (select * from studio.studio_jobs y where y.location_id=p_location_id and y.kind='studio.character_sheet' and y.payload->>'sheet'='transcript' and y.payload->>'uploadId'=u::text and y.created_by_clerk_user_id=p_clerk_user_id order by y.created_at desc limit 1) x on true),'[]'::jsonb);
end $$;

-- Save the timed lines the requester's Mac made. The server calls this only after it has read the Mac's own private file for a finished job; first write wins.
CREATE FUNCTION studio.studio_save_local_upload_transcript(p_location_id text,p_upload_id uuid,p_model text,p_language text,p_duration_seconds numeric,p_text text,p_segments jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if not exists(select 1 from studio.studio_uploads where id=p_upload_id and location_id=p_location_id and status='uploaded') then raise exception 'Upload not ready' using errcode='22023'; end if;
 if p_model is null or p_model !~ '^[A-Za-z0-9._:-]{1,100}$' or jsonb_typeof(p_segments) is distinct from 'array' or jsonb_array_length(p_segments)>6000 or p_duration_seconds is null or p_duration_seconds<0
  or (p_language is not null and p_language !~ '^[a-z]{2,12}$') then raise exception 'Invalid transcript' using errcode='22023'; end if;
 insert into studio.studio_transcripts(upload_id,location_id,model,language,duration_seconds,text,segments) values(p_upload_id,p_location_id,p_model,p_language,p_duration_seconds,left(coalesce(p_text,''),2000000),p_segments)
  on conflict (upload_id) do nothing;
 return found;
end $$;

-- The sheet device command, widened: a transcript result is one file, transcript.json, and a transcript job is claimed whether or not Codex is ready.
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
  if not d.paused and d.processing_enabled and 'studio.character_sheet'=any(d.allowed_kinds) and not exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind='studio.character_sheet' and execution_target='device' and status='queued' and run_after<=clock_timestamp() and (p_body->>'sheetReady'='true' or payload->>'sheet'='transcript') order by created_at limit 1 for update skip locked;
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
  or r->>'sheet' is distinct from j.payload->>'sheet' or jsonb_typeof(r->'files') is distinct from 'array' or jsonb_array_length(r->'files') not between 1 and 40
  or exists(select 1 from jsonb_array_elements(r->'files') f where jsonb_typeof(f) is distinct from 'string' or (f#>>'{}') !~ (case when j.payload->>'sheet'='storyboard' then '^frame-([1-9]|[1-3][0-9]|40)\.png$' when j.payload->>'sheet'='transcript' then '^transcript\.json$' else '^sheet-[1-4]\.png$' end))
  or (j.payload->>'sheet' not in ('storyboard','transcript') and jsonb_array_length(r->'files')>4) or (j.payload->>'sheet'='transcript' and jsonb_array_length(r->'files')<>1) then raise exception 'Invalid character sheet result' using errcode='22023'; end if;
 return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,r));
end $$;

REVOKE ALL ON FUNCTION studio.studio_request_upload_transcript(text,text,text,uuid),studio.studio_upload_transcript_state(text,text,text,uuid[]),studio.studio_save_local_upload_transcript(text,uuid,text,text,numeric,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_upload_transcript(text,text,text,uuid),studio.studio_upload_transcript_state(text,text,text,uuid[]),studio.studio_save_local_upload_transcript(text,uuid,text,text,numeric,text,jsonb) TO service_role;
COMMIT;
