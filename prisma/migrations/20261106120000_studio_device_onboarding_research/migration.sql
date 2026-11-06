BEGIN;
-- Additive: paired computers may also be granted Library summaries and onboarding research. Mac checks stay always allowed.
-- The old constraint allowed exactly {studio.diagnostic}; the new one is a superset, so every existing row stays valid.
ALTER TABLE studio.studio_devices DROP CONSTRAINT studio_devices_allowed_kinds_check;
ALTER TABLE studio.studio_devices ADD CONSTRAINT studio_devices_allowed_kinds_check CHECK (
 'studio.diagnostic'=any(allowed_kinds) AND allowed_kinds <@ ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research']::text[]);

-- The owner's processing opt-in is the grant: On allows the processing kinds, Off returns to Mac checks only.
CREATE FUNCTION studio.studio_device_allowed_kinds_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
begin
 if tg_op='INSERT' or new.processing_enabled is distinct from old.processing_enabled then
  new.allowed_kinds:=case when new.processing_enabled then ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research']::text[] else ARRAY['studio.diagnostic']::text[] end;
 end if;
 return new;
end $$;
REVOKE ALL ON FUNCTION studio.studio_device_allowed_kinds_sync() FROM PUBLIC;
CREATE TRIGGER studio_device_allowed_kinds_sync BEFORE INSERT OR UPDATE OF processing_enabled ON studio.studio_devices
 FOR EACH ROW EXECUTE FUNCTION studio.studio_device_allowed_kinds_sync();
-- Existing devices whose owner already turned processing on are upgraded in place, without re-pairing.
UPDATE studio.studio_devices SET allowed_kinds=ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research']::text[]
 WHERE processing_enabled AND revoked_at IS NULL;

-- Onboarding research routed to one paired computer. The server already checked readiness; this re-checks the grant.
CREATE FUNCTION studio.studio_enqueue_device_onboarding_research(p_location_id text,p_device_id uuid,p_payload jsonb,p_idempotency_key text,p_created_by text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype;
begin
 select * into d from studio.studio_devices where id=p_device_id and location_id=p_location_id and revoked_at is null for update;
 if not found or d.paused or not d.processing_enabled or not ('studio.onboarding_research'=any(d.allowed_kinds)) then
  raise exception 'Device unavailable for research' using errcode='42501';
 end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.onboarding_research',p_payload,p_idempotency_key,p_created_by,2);
 -- Same transaction as the insert, so no hosted worker can see it before it is bound to the device.
 if j.device_id is null and j.status='queued' and j.attempts=0 then
  update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j;
 end if;
 if j.device_id is distinct from d.id then raise exception 'Idempotency key already used for a different job' using errcode='23505'; end if;
 return jsonb_build_object('jobId',j.id,'deviceId',d.id);
end $$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_device_onboarding_research(text,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_device_onboarding_research(text,uuid,jsonb,text,text) TO service_role;

-- Outermost device entry point. Onboarding research is claimed first (an owner is waiting for it), then everything else
-- goes through the existing Library-summary wrapper and base device protocol unchanged.
CREATE FUNCTION studio.studio_onboarding_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; result jsonb; body jsonb:=p_body;
begin
 -- Same identity/member/revocation lock protocol as the wrapped functions, on every operation.
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if d.app='estio' and p_estio_authorized_by is distinct from d.created_by then raise exception 'Device authentication failed' using errcode='42501'; end if;
 perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
 select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 if p_operation='claim' then
  if jsonb_typeof(p_body->'leaseSeconds') is distinct from 'number' or (p_body->>'leaseSeconds') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 then
   raise exception 'Invalid claim' using errcode='22023';
  end if;
  if not d.paused and d.processing_enabled and 'studio.onboarding_research'=any(d.allowed_kinds) and p_body->>'researchReady'='true' then
   select * into j from studio.studio_jobs where device_id=d.id and location_id=d.location_id and execution_target='device' and kind='studio.onboarding_research'
    and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),
     lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
  -- Library summaries need their own grant as well as the existing processing/text gates.
  if not ('studio.library_summary'=any(d.allowed_kinds)) then body:=body-'summaryReady'; end if;
  return studio.studio_library_device_command(p_token_hash,p_app,p_operation,body,p_estio_authorized_by);
 end if;
 if p_operation in ('extend','complete','fail') then
  select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and execution_target='device'
   and kind='studio.onboarding_research' for update;
  if found then
   -- A claimed job may finish even if processing was turned off meanwhile; revocation (above) is the hard stop.
   if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then
    return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end;
   end if;
   if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
   if p_operation='complete' then
    result:=p_body->'result';
    if jsonb_typeof(result) is distinct from 'object' or octet_length(result::text)>24576 or exists(select 1 from jsonb_each(result) e where e.key not in ('research','provider','model'))
     or jsonb_typeof(result->'research') is distinct from 'object' or coalesce(result->>'provider','') not in ('codex','claude') or result->>'model' is distinct from 'native-default' then
     raise exception 'Invalid research result' using errcode='22023';
    end if;
    return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,result));
   end if;
   -- Capacity/policy waits happen before any provider call, so they do not use up an execution attempt.
   if p_body#>>'{failure,code}' in ('subscription_capacity','local_policy') and p_body#>>'{failure,retryable}'='true' then
    update studio.studio_jobs set attempts=greatest(0,attempts-1) where id=j.id;
   end if;
   return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,p_body#>>'{failure,code}',p_body#>>'{failure,message}',
    (p_body#>>'{failure,retryable}')::boolean,(p_body#>>'{failure,retryAfterSeconds}')::integer));
  end if;
 end if;
 return studio.studio_library_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
end $$;
REVOKE ALL ON FUNCTION studio.studio_onboarding_device_command(text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_onboarding_device_command(text,text,text,jsonb,text) TO service_role;

-- When device research finishes (or can no longer run), hand the outcome to the hosted worker, which applies it to the
-- Business profile with the same parser and mapping as server research. One durable job per research job.
CREATE FUNCTION studio.studio_onboarding_device_finished() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.kind='studio.onboarding_research' and new.execution_target='device' and new.status in ('succeeded','failed','cancelled')
  and old.status not in ('succeeded','failed','cancelled') then
  perform studio.studio_enqueue_job(new.location_id,'studio.onboarding_apply',
   jsonb_build_object('jobId',new.id,'batch',new.payload->'batch','topic',new.payload->'topic','actorId',coalesce(new.payload->'actorId','null'::jsonb),'status',new.status)
   || case when new.status='succeeded' then jsonb_build_object('result',new.result)
      else jsonb_build_object('error',coalesce(new.last_error_message,'Research on the Mac was cancelled.')) end,
   -- A manual retry can finish the same job again later, so each finish gets its own key.
   'onboarding-apply:'||new.id||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS'),new.created_by_clerk_user_id,3);
 end if;
 return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_onboarding_device_finished() FROM PUBLIC;
CREATE TRIGGER studio_onboarding_device_finished AFTER UPDATE OF status ON studio.studio_jobs
 FOR EACH ROW EXECUTE FUNCTION studio.studio_onboarding_device_finished();

-- Queued research never waits forever for a computer that was revoked or had processing turned off.
CREATE FUNCTION studio.studio_device_onboarding_release() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if (new.revoked_at is not null and old.revoked_at is null) or (old.processing_enabled and not new.processing_enabled) then
  update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),updated_at=clock_timestamp(),last_error_code='device_unavailable',
   last_error_message='The Mac stopped accepting research. Research again to use another connection.'
   where device_id=new.id and kind='studio.onboarding_research' and status='queued';
 end if;
 return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_device_onboarding_release() FROM PUBLIC;
CREATE TRIGGER studio_device_onboarding_release AFTER UPDATE OF revoked_at,processing_enabled ON studio.studio_devices
 FOR EACH ROW EXECUTE FUNCTION studio.studio_device_onboarding_release();
COMMIT;
