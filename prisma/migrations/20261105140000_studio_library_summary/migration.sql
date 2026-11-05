BEGIN;
-- Durable requests remain independent of device availability. No hosted execution is created.
CREATE TABLE studio.studio_library_summary_requests (
 location_id text NOT NULL, record_id uuid NOT NULL, actor_app text NOT NULL,
 actor_id text NOT NULL, record_version bigint NOT NULL, job_id uuid, evidence_fingerprint text NOT NULL,
 CHECK(actor_app in ('estio','substo')),
 FOREIGN KEY(location_id,record_id) REFERENCES studio.studio_records(location_id,id) ON DELETE CASCADE,
 PRIMARY KEY(location_id,record_id)
);
REVOKE ALL ON studio.studio_library_summary_requests FROM PUBLIC;
-- Fingerprint exactly the evidence sent to the native adapter; bookkeeping is excluded.
CREATE FUNCTION studio.studio_library_summary_fingerprint(p_payload jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 select md5(jsonb_build_array(left(coalesce(p_payload->>'description',''),20000),left(coalesce(p_payload->>'transcript',''),20000))::text)
$$;
REVOKE ALL ON FUNCTION studio.studio_library_summary_fingerprint(jsonb) FROM PUBLIC;
CREATE FUNCTION studio.studio_request_library_summary(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare r studio.studio_records%rowtype;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 select * into r from studio.studio_records where location_id=p_location_id and id=p_record_id and kind in ('reference','channel') for update;
 if not found then raise exception 'Source unavailable'; end if;
 if length(btrim(coalesce(r.payload->>'description','')))=0 and length(btrim(coalesce(r.payload->>'transcript','')))=0 then
  delete from studio.studio_library_summary_requests where location_id=p_location_id and record_id=r.id;
  update studio.studio_records set payload=(payload - 'aiSummary' - 'summaryBasis') || '{"summaryStatus":"no_evidence"}'::jsonb where location_id=p_location_id and id=r.id;
  return jsonb_build_object('summaryStatus','no_evidence');
 end if;
 if exists(select 1 from studio.studio_library_summary_requests where location_id=p_location_id and record_id=r.id and evidence_fingerprint=studio.studio_library_summary_fingerprint(r.payload)) then
  -- Metadata-only retries may advance the record version before a job is created.
  update studio.studio_library_summary_requests set record_version=r.version where location_id=p_location_id and record_id=r.id and job_id is null;
  return jsonb_build_object('summaryStatus',r.payload->>'summaryStatus');
 end if;
 update studio.studio_records set payload=(payload - 'aiSummary') || jsonb_build_object('summaryStatus','waiting_for_device','summaryBasis',case when length(payload->>'transcript')>0 then 'transcript' else 'description' end) where location_id=p_location_id and id=r.id;
 insert into studio.studio_library_summary_requests values(p_location_id,r.id,p_actor_app,p_clerk_user_id,r.version,null,studio.studio_library_summary_fingerprint(r.payload))
 on conflict(location_id,record_id) do update set actor_app=excluded.actor_app,actor_id=excluded.actor_id,record_version=excluded.record_version,job_id=null,evidence_fingerprint=excluded.evidence_fingerprint;
 return jsonb_build_object('summaryStatus','waiting_for_device');
end $$;
REVOKE ALL ON FUNCTION studio.studio_request_library_summary(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_library_summary(text,text,text,uuid) TO service_role;

CREATE FUNCTION studio.studio_library_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; r studio.studio_records%rowtype; q record; result jsonb; ok boolean;
begin
 -- Reuse the existing identity/member/revocation lock protocol on EVERY operation.
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if d.app='estio' and p_estio_authorized_by is distinct from d.created_by then raise exception 'Device authentication failed' using errcode='42501'; end if;
 perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
 select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 if p_operation='claim' then
  -- Existing function validates worker/limit/lease and services diagnostics first.
  result:=studio.studio_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
  if jsonb_array_length(result)>0 or d.paused or not d.processing_enabled or d.desired_config#>>'{features,text}' is distinct from 'true' or p_body->>'summaryReady' is distinct from 'true' then return result; end if;
  -- Expired executions are uncertain: never replay them on another subscription/device.
  update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),last_error_code='summary_execution_uncertain'
   where device_id=d.id and kind='studio.library_summary' and status='running' and lease_expires_at<=clock_timestamp();
  for q in select x.* from studio.studio_library_summary_requests x where x.location_id=d.location_id and x.actor_app=d.app and x.actor_id=d.created_by and x.job_id is null order by x.record_id limit 10 for update skip locked loop
   select * into r from studio.studio_records where location_id=q.location_id and id=q.record_id and version=q.record_version for update;
   if found then
    insert into studio.studio_jobs(location_id,kind,payload,execution_target,device_id,created_by_clerk_user_id,max_attempts)
     values(d.location_id,'studio.library_summary',jsonb_build_object('recordId',r.id,'recordVersion',r.version,'description',left(coalesce(r.payload->>'description',''),20000)) || case when length(r.payload->>'transcript')>0 then jsonb_build_object('transcript',left(r.payload->>'transcript',20000)) else '{}'::jsonb end,'device',d.id,d.created_by,20) returning * into j;
    update studio.studio_library_summary_requests set job_id=j.id where location_id=q.location_id and record_id=q.record_id;
    update studio.studio_records set payload=payload || jsonb_build_object('summaryStatus','queued','summaryBasis',case when j.payload ? 'transcript' then 'transcript' else 'description' end) where location_id=r.location_id and id=r.id;
   else
    update studio.studio_records set payload=payload || '{"summaryStatus":"stale"}'::jsonb where location_id=q.location_id and id=q.record_id;
   end if;
  end loop;
  select * into j from studio.studio_jobs where device_id=d.id and location_id=d.location_id and created_by_clerk_user_id=d.created_by and kind='studio.library_summary' and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
  if not found then return '[]'; end if;
  update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer) where id=j.id returning * into j;
  return jsonb_build_array(to_jsonb(j));
 end if;
 if p_operation in ('extend','complete','fail') then
  select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and execution_target='device' and kind='studio.library_summary' and created_by_clerk_user_id=d.created_by for update;
  if found then
   if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end; end if;
   if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
   if p_operation='complete' then
    result:=p_body->'result';
    if jsonb_typeof(result) is distinct from 'object' or octet_length(result::text)>4096 or exists(select 1 from jsonb_each(result) e where e.key not in ('summary','provider','model')) or jsonb_typeof(result->'summary') is distinct from 'string' or length(btrim(result->>'summary')) not between 1 and 1500 or coalesce(result->>'provider','') not in ('codex','claude') or result->>'model' is distinct from 'native-default' then raise exception 'Invalid summary'; end if;
    select * into r from studio.studio_records where location_id=j.location_id and id=(j.payload->>'recordId')::uuid for update;
    ok:=studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,result);
    if ok and r.version=(j.payload->>'recordVersion')::bigint and exists(select 1 from studio.studio_library_summary_requests where location_id=r.location_id and record_id=r.id and job_id=j.id) then
     update studio.studio_records set payload=payload || jsonb_build_object('aiSummary',result->>'summary','summaryStatus','ready','summaryBasis',case when j.payload ? 'transcript' then 'transcript' else 'description' end),version=version+1,updated_at=clock_timestamp() where location_id=r.location_id and id=r.id;
     update studio.studio_library_summary_requests set record_version=r.version+1 where location_id=r.location_id and record_id=r.id and job_id=j.id;
    elsif ok then
     update studio.studio_records set payload=payload || '{"summaryStatus":"stale"}'::jsonb where location_id=r.location_id and id=r.id and exists(select 1 from studio.studio_library_summary_requests where location_id=r.location_id and record_id=r.id and job_id=j.id);
    end if;
    return to_jsonb(ok);
   end if;
   -- These gates occur before native generation, so waiting does not consume execution attempts.
   if p_body#>>'{failure,code}' in ('subscription_capacity','local_policy') and p_body#>>'{failure,retryable}'='true' then
    update studio.studio_jobs set attempts=greatest(0,attempts-1) where id=j.id;
   end if;
   result:=to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,p_body#>>'{failure,code}',p_body#>>'{failure,message}',(p_body#>>'{failure,retryable}')::boolean,(p_body#>>'{failure,retryAfterSeconds}')::integer));
   update studio.studio_records set payload=payload || jsonb_build_object('summaryStatus',case when result='"retry_scheduled"'::jsonb then 'waiting_for_capacity' else 'failed' end) where location_id=j.location_id and id=(j.payload->>'recordId')::uuid and version=(j.payload->>'recordVersion')::bigint;
   return result;
  end if;
 end if;
 return studio.studio_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
end $$;
REVOKE ALL ON FUNCTION studio.studio_library_device_command(text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_library_device_command(text,text,text,jsonb,text) TO service_role;
-- The hosted recovery loop predates device summaries and scans every expired job.
-- Fence its attempted queued transition without replacing that broad function.
CREATE FUNCTION studio.studio_library_summary_expiry_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
begin
 if old.kind='studio.library_summary' and old.execution_target='device' and old.status='running' and old.lease_expires_at<=clock_timestamp() and new.status='queued' then
  new.status:='failed'; new.finished_at:=clock_timestamp(); new.lease_owner:=null; new.lease_expires_at:=null;
  new.last_error_code:='summary_execution_uncertain';
 end if;
 if new.kind='studio.library_summary' and new.last_error_code='summary_execution_uncertain' then
  update studio.studio_records set payload=payload || '{"summaryStatus":"uncertain"}'::jsonb where location_id=new.location_id and id=(new.payload->>'recordId')::uuid and version=(new.payload->>'recordVersion')::bigint;
 end if;
 return new;
end $$;
CREATE TRIGGER studio_library_summary_expiry_fence BEFORE UPDATE ON studio.studio_jobs FOR EACH ROW EXECUTE FUNCTION studio.studio_library_summary_expiry_fence();
REVOKE ALL ON FUNCTION studio.studio_library_summary_expiry_fence() FROM PUBLIC;
COMMIT;
