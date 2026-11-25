BEGIN;
-- Character sheets: the creator's own Mac draws a reference sheet (turnaround, expressions, face, outfits) from their photos with the Codex CLI.
-- Additive. Same lease protocol as every device job: the requesting account's own Mac only, offline Macs leave the job queued, no paid fallback.
-- The pictures do not travel in the job: the Mac uploads them to private storage through links minted at claim time and completes with their names.

-- 1. The kind a Mac may run while processing is On.
ALTER TABLE studio.studio_devices DROP CONSTRAINT studio_devices_allowed_kinds_check;
ALTER TABLE studio.studio_devices ADD CONSTRAINT studio_devices_allowed_kinds_check CHECK (
 'studio.diagnostic'=any(allowed_kinds) AND allowed_kinds <@ ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe','studio.youtube_search','studio.video_assemble','studio.video_edit','studio.open_editor','studio.voice_preview','studio.character_sheet']::text[]);
CREATE OR REPLACE FUNCTION studio.studio_device_allowed_kinds_sync() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
begin
 if tg_op='INSERT' or new.processing_enabled is distinct from old.processing_enabled then
  new.allowed_kinds:=case when new.processing_enabled then ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe','studio.youtube_search','studio.video_assemble','studio.video_edit','studio.open_editor','studio.voice_preview','studio.character_sheet']::text[] else ARRAY['studio.diagnostic']::text[] end;
 end if; return new;
end $$;
UPDATE studio.studio_devices d SET allowed_kinds=d.allowed_kinds||ARRAY['studio.character_sheet']::text[]
 WHERE d.processing_enabled AND d.revoked_at IS NULL AND NOT 'studio.character_sheet'=any(d.allowed_kinds);

-- 2. Ask the requester's own ready Mac for one sheet.
CREATE FUNCTION studio.studio_request_character_sheet(p_location_id text,p_actor_app text,p_clerk_user_id text,p_sheet text,p_profile jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; why text;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_sheet is null or p_sheet not in ('turnaround','expressions','face','outfits') then raise exception 'Unknown sheet' using errcode='CS001'; end if;
 if p_profile is null or jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>6000 then raise exception 'Invalid character card' using errcode='CS002'; end if;
 select * into j from studio.studio_jobs where location_id=p_location_id and kind='studio.character_sheet' and payload->>'sheet'=p_sheet and created_by_clerk_user_id=p_clerk_user_id and status in ('queued','running') limit 1;
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
 j:=studio.studio_enqueue_job(p_location_id,'studio.character_sheet',jsonb_build_object('sheet',p_sheet,'profile',p_profile),'csheet:'||p_sheet||':'||gen_random_uuid()::text,p_clerk_user_id,1);
 if j.execution_target<>'device' then update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'reused',false);
end $$;

-- 3. What the requester's page shows: their latest job of each sheet kind, with its own result or failure.
CREATE FUNCTION studio.studio_character_sheet_state(p_location_id text,p_actor_app text,p_clerk_user_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 return coalesce((select jsonb_agg(jsonb_build_object('jobId',x.id,'sheet',x.payload->>'sheet','status',x.status,'files',x.result->'files','error',case when x.status in ('failed','cancelled') then left(coalesce(x.last_error_message,''),300) end,'createdAt',x.created_at,'finishedAt',x.finished_at) order by x.created_at desc)
  from (select distinct on (payload->>'sheet') * from studio.studio_jobs where location_id=p_location_id and kind='studio.character_sheet' and created_by_clerk_user_id=p_clerk_user_id order by payload->>'sheet',created_at desc) x),'[]'::jsonb);
end $$;

-- 4. Withdrawing consent or turning processing off cancels sheets still waiting for that Mac.
CREATE FUNCTION studio.studio_character_sheet_device_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.revoked_at is not null or not new.processing_enabled then
  update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),last_error_code='sheet_mac_settings_changed',last_error_message='Mac settings changed. Try again once the Mac is ready.'
   where device_id=new.id and kind='studio.character_sheet' and status='queued';
 end if; return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_character_sheet_device_release() FROM PUBLIC;
CREATE TRIGGER studio_character_sheet_device_release AFTER UPDATE OF revoked_at,processing_enabled ON studio.studio_devices FOR EACH ROW EXECUTE FUNCTION studio.studio_character_sheet_device_release();

-- 5. Device protocol: in front of the voice-preview wrapper. Claim, extend, complete and fail for this kind only; everything else is passed down unchanged.
CREATE FUNCTION studio.studio_character_sheet_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL) RETURNS jsonb
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
  or r->>'sheet' is distinct from j.payload->>'sheet' or jsonb_typeof(r->'files') is distinct from 'array' or jsonb_array_length(r->'files') not between 1 and 4
  or exists(select 1 from jsonb_array_elements(r->'files') f where jsonb_typeof(f) is distinct from 'string' or (f#>>'{}') !~ '^sheet-[1-4]\.png$') then raise exception 'Invalid character sheet result' using errcode='22023'; end if;
 return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,r));
end $$;

REVOKE ALL ON FUNCTION studio.studio_request_character_sheet(text,text,text,text,jsonb),studio.studio_character_sheet_state(text,text,text),studio.studio_character_sheet_device_command(text,text,text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_character_sheet(text,text,text,text,jsonb),studio.studio_character_sheet_state(text,text,text),studio.studio_character_sheet_device_command(text,text,text,jsonb,text,jsonb) TO service_role;
COMMIT;
