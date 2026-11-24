BEGIN;
-- Workspace: each exported version carries a bounded, read-only picture of its timeline (<= 16 tracks, <= 24 KB) so the page can draw the layers.
-- Additive: the device command accepts one more optional result key with its own size bound, and the loop state returns it per version.
-- The statements below are the previous definitions with exactly these changes (result size split, 'timeline' allowed and shape-checked; versions[].timeline).

CREATE OR REPLACE FUNCTION studio.studio_video_assembly_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; r jsonb; ex jsonb; up uuid; mo uuid; fname text; v_sha text; v_size bigint;
 kinds text[]:=ARRAY['studio.video_assemble','studio.video_edit','studio.open_editor'];
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
  -- A job whose Mac stopped is not replayed automatically (an assembly may have spent narration credit); the page offers to try again.
  update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',last_error_message='The Mac stopped before finishing this.',finished_at=clock_timestamp(),updated_at=clock_timestamp()
   where device_id=d.id and kind=any(kinds) and status='running' and lease_expires_at<=clock_timestamp();
  if not d.paused and d.processing_enabled and p_body->>'assembleReady'='true' then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind=any(kinds) and kind=any(d.allowed_kinds) and execution_target='device' and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
  return studio.studio_routed_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;

 if coalesce(p_body->>'jobId','') !~ '^[0-9a-f-]{36}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and execution_target='device' and kind=any(kinds) for update;
 if not found then return studio.studio_routed_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then
  if p_operation in ('video_export_reserve','video_export_verify') then raise exception 'Current video lease required' using errcode='40001'; end if;
  return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end;
 end if;
 if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
 if p_operation='fail' then
  return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,coalesce(nullif(p_body#>>'{failure,code}',''),'video_assembly_failed'),left(coalesce(p_body#>>'{failure,message}','The Mac could not finish this.'),300),
    coalesce((p_body#>>'{failure,retryable}')::boolean,false),case when coalesce((p_body#>>'{failure,retryable}')::boolean,false) then coalesce(nullif(p_body#>>'{failure,retryAfterSeconds}','')::integer,300) else null end));
 end if;

 if p_operation in ('video_export_reserve','video_export_verify') and j.kind='studio.open_editor' then raise exception 'No export for this job' using errcode='22023'; end if;
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

 -- complete: bounded facts only; an export, if any, must already be verified.
 r:=p_body->'result';
 if j.kind='studio.open_editor' then
  if jsonb_typeof(r) is distinct from 'object' or octet_length(r::text)>1024 or jsonb_typeof(r->'editor') is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(r) k where k<>'editor') or exists(select 1 from jsonb_object_keys(r->'editor') k where k not in ('opened','projectName'))
   or (r->'editor' ? 'opened' and jsonb_typeof(r->'editor'->'opened') is distinct from 'boolean') then raise exception 'Invalid editor result' using errcode='22023'; end if;
  return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,r));
 end if;
 if jsonb_typeof(r) is distinct from 'object' or octet_length(r::text)>30000 or octet_length((r #- '{assembly,timeline}')::text)>8192 or jsonb_typeof(r->'assembly') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(r) k where k<>'assembly')
  or exists(select 1 from jsonb_object_keys(r->'assembly') k where k not in ('exportName','bytes','seconds','beats','clips','voiced','uploadId','summary','exportSaved','projectKept','projectName','timeline'))
  or (r->'assembly' ? 'projectKept' and jsonb_typeof(r->'assembly'->'projectKept') is distinct from 'boolean')
  or (r->'assembly' ? 'timeline' and (jsonb_typeof(r->'assembly'->'timeline') is distinct from 'object' or octet_length((r->'assembly'->'timeline')::text)>24000
   or jsonb_typeof(r->'assembly'->'timeline'->'tracks') is distinct from 'array' or jsonb_array_length(r->'assembly'->'timeline'->'tracks')>16
   or jsonb_typeof(r->'assembly'->'timeline'->'d') is distinct from 'number'))
  or (r->'assembly' ? 'summary' and (jsonb_typeof(r->'assembly'->'summary') is distinct from 'string' or char_length(r->'assembly'->>'summary')>2000))
  or (r->'assembly' ? 'uploadId' and coalesce(r->'assembly'->>'uploadId','') !~ '^[0-9a-f-]{36}$') then raise exception 'Invalid video assembly result' using errcode='22023'; end if;
 if r->'assembly' ? 'uploadId' and (j.payload#>>'{export,uploadId}' is distinct from r->'assembly'->>'uploadId' or j.payload#>>'{export,state}' is distinct from 'verified') then raise exception 'Export was not verified' using errcode='22023'; end if;
 return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,r));
end $$;

CREATE OR REPLACE FUNCTION studio.studio_video_loop_state(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare kept boolean; versions jsonb; thread jsonb; opened jsonb; busy boolean; tl jsonb;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
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
 return jsonb_build_object('projectKept',kept,'versions',versions,'thread',thread,'openEditor',opened,'busy',busy);
end $$;

COMMIT;
