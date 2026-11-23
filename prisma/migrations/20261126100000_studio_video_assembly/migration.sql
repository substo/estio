BEGIN;
-- Script-to-video on the paired Mac: footage and script in, an edited MP4 out (saved back as a normal upload on the content record).
-- Additive. Same lease protocol as every device job: the requesting account's own Mac only, offline Macs leave the job queued, no paid fallback.

-- 1. Grant while processing is On.
ALTER TABLE studio.studio_devices DROP CONSTRAINT studio_devices_allowed_kinds_check;
ALTER TABLE studio.studio_devices ADD CONSTRAINT studio_devices_allowed_kinds_check CHECK (
 'studio.diagnostic'=any(allowed_kinds) AND allowed_kinds <@ ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe','studio.youtube_search','studio.video_assemble']::text[]);
CREATE OR REPLACE FUNCTION studio.studio_device_allowed_kinds_sync() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
begin
 if tg_op='INSERT' or new.processing_enabled is distinct from old.processing_enabled then
  new.allowed_kinds:=case when new.processing_enabled then ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe','studio.youtube_search','studio.video_assemble']::text[] else ARRAY['studio.diagnostic']::text[] end;
 end if; return new;
end $$;
UPDATE studio.studio_devices SET allowed_kinds=array_append(allowed_kinds,'studio.video_assemble') WHERE processing_enabled AND revoked_at IS NULL AND NOT 'studio.video_assemble'=any(allowed_kinds);

-- 2. Admission. Snapshots the saved script and the record's uploaded footage; one active job per record.
CREATE FUNCTION studio.studio_request_video_assembly(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid,p_options jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare rec studio.studio_records%rowtype; d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; script text; media jsonb; vo boolean; mu boolean; po boolean; why text;
begin
 if p_options is null or jsonb_typeof(p_options)<>'object' or exists(select 1 from jsonb_object_keys(p_options) k where k not in ('voiceover','music','portrait'))
  or exists(select 1 from jsonb_each(p_options) e where jsonb_typeof(e.value)<>'boolean') then raise exception 'Invalid video options' using errcode='22023'; end if;
 vo:=coalesce((p_options->>'voiceover')::boolean,false); mu:=coalesce((p_options->>'music')::boolean,false); po:=coalesce((p_options->>'portrait')::boolean,false);
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 select * into rec from studio.studio_records where location_id=p_location_id and id=p_record_id and kind='content' for update;
 if not found then raise exception 'Content not found' using errcode='VA001'; end if;
 script:=btrim(coalesce(rec.payload->>'script',''));
 if char_length(script)<1 then raise exception 'No saved script' using errcode='VA002'; end if;
 if char_length(script)>20000 then raise exception 'Script too long' using errcode='VA003'; end if;
 select * into j from studio.studio_jobs where location_id=p_location_id and kind='studio.video_assemble' and payload->>'recordId'=p_record_id::text and status in ('queued','running') limit 1;
 if found then return jsonb_build_object('jobId',j.id,'status',j.status,'reused',true); end if;
 select coalesce(jsonb_agg(jsonb_build_object('uploadId',u.id,'name',u.original_filename,'contentType',u.content_type,'byteSize',u.byte_size) order by u.created_at),'[]'::jsonb) into media
  from (select * from studio.studio_uploads x where x.location_id=p_location_id and x.record_id=p_record_id and x.status='uploaded' and x.media_object_id is not null
         and (x.content_type like 'video/%' or x.content_type like 'audio/%') and x.original_filename !~ '^Edited video ' order by x.created_at limit 40) u;
 if jsonb_array_length(media)=0 and not vo then raise exception 'No footage' using errcode='VA004'; end if;
 if (select coalesce(sum((m->>'byteSize')::bigint),0) from jsonb_array_elements(media) m)>21474836480 then raise exception 'Footage too large' using errcode='VA005'; end if;
 select * into d from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null
  and x.processing_enabled and 'studio.video_assemble'=any(x.allowed_kinds) and x.report->'handlers' ? 'studio.video_assemble'
  and x.report#>>'{videoAssembly,ready}'='true' order by x.seen_at desc nulls last limit 1 for share;
 if not found then
  why:=case
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null) then 'VA011'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled) then 'VA012'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled and x.report->'handlers' ? 'studio.video_assemble') then 'VA014'
   else 'VA013' end;
  raise exception 'No ready Mac' using errcode=why;
 end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.video_assemble',
   jsonb_build_object('recordId',p_record_id,'recordVersion',rec.version,'title',left(rec.title,200),'script',script,'options',jsonb_build_object('voiceover',vo,'music',mu,'portrait',po),'media',media),
   'vassemble:'||p_record_id::text||':'||gen_random_uuid()::text,p_clerk_user_id,1);
 if j.execution_target<>'device' then update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'reused',false);
end $$;
REVOKE ALL ON FUNCTION studio.studio_request_video_assembly(text,text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_video_assembly(text,text,text,uuid,jsonb) TO service_role;

-- 3. Consent withdrawal: queued assemblies cannot outlive the grant or a revoked Mac.
CREATE FUNCTION studio.studio_video_assembly_device_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.revoked_at is not null or not new.processing_enabled then
  update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),last_error_code='video_mac_settings_changed',last_error_message='Mac settings changed. Make the video again once the Mac is ready.'
   where device_id=new.id and kind='studio.video_assemble' and status='queued';
 end if; return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_assembly_device_release() FROM PUBLIC;
CREATE TRIGGER studio_video_assembly_device_release AFTER UPDATE OF revoked_at,processing_enabled ON studio.studio_devices FOR EACH ROW EXECUTE FUNCTION studio.studio_video_assembly_device_release();

-- 4. Device protocol: new outermost wrapper (the server calls this instead of studio_routed_device_command).
-- claim/extend/complete/fail for this kind plus video_export_reserve / video_export_verify (signed upload, server-side byte check, saved as an upload on the record).
CREATE FUNCTION studio.studio_video_assembly_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; r jsonb; ex jsonb; up uuid; mo uuid; fname text; v_sha text; v_size bigint;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_operation not in ('claim','extend','complete','fail','video_export_reserve','video_export_verify') then
  return studio.studio_routed_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;

 if p_operation='claim' then
  if coalesce(p_body->>'leaseSeconds','') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 then raise exception 'Invalid lease' using errcode='22023'; end if;
  perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
  select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
  if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
  if exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then return '[]'::jsonb; end if;
  -- An assembly whose Mac stopped is not replayed automatically (it may have spent ElevenLabs credit); the page offers Make video again.
  update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',last_error_message='The Mac stopped before finishing this video.',finished_at=clock_timestamp(),updated_at=clock_timestamp()
   where device_id=d.id and kind='studio.video_assemble' and status='running' and lease_expires_at<=clock_timestamp();
  if not d.paused and d.processing_enabled and 'studio.video_assemble'=any(d.allowed_kinds) and p_body->>'assembleReady'='true' then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind='studio.video_assemble' and execution_target='device' and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
  return studio.studio_routed_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;

 if coalesce(p_body->>'jobId','') !~ '^[0-9a-f-]{36}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and execution_target='device' and kind='studio.video_assemble' for update;
 if not found then return studio.studio_routed_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then
  if p_operation in ('video_export_reserve','video_export_verify') then raise exception 'Current video lease required' using errcode='40001'; end if;
  return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end;
 end if;
 if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
 if p_operation='fail' then
  return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,coalesce(nullif(p_body#>>'{failure,code}',''),'video_assembly_failed'),left(coalesce(p_body#>>'{failure,message}','Video assembly failed on the Mac.'),300),
    coalesce((p_body#>>'{failure,retryable}')::boolean,false),case when coalesce((p_body#>>'{failure,retryable}')::boolean,false) then coalesce(nullif(p_body#>>'{failure,retryAfterSeconds}','')::integer,300) else null end));
 end if;

 if p_operation='video_export_reserve' then
  v_sha:=p_body->>'sha256';
  if coalesce(v_sha,'') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_body->'byteSize') is distinct from 'number' or (p_body->>'byteSize')::numeric<>trunc((p_body->>'byteSize')::numeric)
   or (p_body->>'byteSize')::numeric not between 1000 and 5368709120 or coalesce(p_observed->>'bucket','') !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' then raise exception 'Invalid export' using errcode='22023'; end if;
  ex:=j.payload->'export';
  if ex is not null and ex->>'sha256' is distinct from v_sha then raise exception 'Export already reserved for different bytes' using errcode='23505'; end if;
  if ex is null then
   up:=gen_random_uuid(); fname:='Edited video '||to_char(clock_timestamp(),'YYYY-MM-DD HH24MI')||'.mp4';
   insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,created_by_clerk_user_id,expires_at)
    values(up,d.location_id,(j.payload->>'recordId')::uuid,fname,'video/mp4',(p_body->>'byteSize')::bigint,p_observed->>'bucket',d.location_id||'/uploads/'||up::text||'/original','awaiting_upload',d.created_by,clock_timestamp()+interval '6 hours');
   ex:=jsonb_build_object('uploadId',up,'sha256',v_sha,'byteSize',(p_body->>'byteSize')::bigint,'objectKey',d.location_id||'/uploads/'||up::text||'/original','bucket',p_observed->>'bucket','state','reserved');
   update studio.studio_jobs set payload=jsonb_set(payload,'{export}',ex) where id=j.id;
  end if;
  return jsonb_build_object('uploadId',ex->>'uploadId','objectKey',ex->>'objectKey','byteSize',(ex->>'byteSize')::bigint,'state',ex->>'state');
 end if;

 if p_operation='video_export_verify' then
  ex:=j.payload->'export';
  if ex is null then raise exception 'No export reserved' using errcode='22023'; end if;
  if p_observed is null then return jsonb_build_object('objectKey',ex->>'objectKey','sha256',ex->>'sha256','byteSize',(ex->>'byteSize')::bigint,'state',ex->>'state'); end if;
  if jsonb_typeof(p_observed)<>'object' or p_observed->>'bucket' is distinct from ex->>'bucket' or p_observed->>'sha256' is distinct from ex->>'sha256'
   or jsonb_typeof(p_observed->'byteSize') is distinct from 'number' or (p_observed->>'byteSize')::bigint is distinct from (ex->>'byteSize')::bigint then raise exception 'Export bytes do not match the reservation' using errcode='22023'; end if;
  if ex->>'state'<>'verified' then
   select original_filename into fname from studio.studio_uploads where id=(ex->>'uploadId')::uuid and location_id=d.location_id;
   insert into studio.studio_media_objects(location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
    values(d.location_id,ex->>'bucket',ex->>'objectKey',fname,'video/mp4',(ex->>'byteSize')::bigint,ex->>'sha256',d.created_by)
    on conflict (bucket_id,object_key) do update set byte_size=excluded.byte_size returning id into mo;
   update studio.studio_uploads set status='uploaded',media_object_id=mo,uploaded_at=clock_timestamp() where id=(ex->>'uploadId')::uuid and location_id=d.location_id;
   update studio.studio_jobs set payload=jsonb_set(payload,'{export,state}','"verified"') where id=j.id;
  end if;
  return jsonb_build_object('uploadId',ex->>'uploadId','state','verified');
 end if;

 -- complete: bounded facts only; the export, if any, must already be verified.
 r:=p_body->'result';
 if jsonb_typeof(r) is distinct from 'object' or octet_length(r::text)>8192 or jsonb_typeof(r->'assembly') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(r) k where k<>'assembly')
  or exists(select 1 from jsonb_object_keys(r->'assembly') k where k not in ('exportName','bytes','seconds','beats','clips','voiced','uploadId','summary','exportSaved'))
  or (r->'assembly' ? 'summary' and (jsonb_typeof(r->'assembly'->'summary') is distinct from 'string' or char_length(r->'assembly'->>'summary')>2000))
  or (r->'assembly' ? 'uploadId' and coalesce(r->'assembly'->>'uploadId','') !~ '^[0-9a-f-]{36}$') then raise exception 'Invalid video assembly result' using errcode='22023'; end if;
 if r->'assembly' ? 'uploadId' and (j.payload#>>'{export,uploadId}' is distinct from r->'assembly'->>'uploadId' or j.payload#>>'{export,state}' is distinct from 'verified') then raise exception 'Export was not verified' using errcode='22023'; end if;
 return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,r));
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_assembly_device_command(text,text,text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_video_assembly_device_command(text,text,text,jsonb,text,jsonb) TO service_role;

COMMIT;
