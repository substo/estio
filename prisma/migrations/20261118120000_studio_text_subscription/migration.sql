BEGIN;
ALTER TABLE studio.studio_idea_reviews ADD COLUMN execution_provider text NOT NULL DEFAULT 'openai' CHECK(execution_provider IN ('openai','subscription'));
GRANT SELECT(execution_provider) ON studio.studio_idea_reviews TO service_role;
ALTER TABLE studio.studio_devices DROP CONSTRAINT studio_devices_allowed_kinds_check;
ALTER TABLE studio.studio_devices ADD CONSTRAINT studio_devices_allowed_kinds_check CHECK (
 'studio.diagnostic'=any(allowed_kinds) AND allowed_kinds <@ ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run']::text[]);
CREATE OR REPLACE FUNCTION studio.studio_device_allowed_kinds_sync() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
begin
 if tg_op='INSERT' or new.processing_enabled is distinct from old.processing_enabled then
  new.allowed_kinds:=case when new.processing_enabled then ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run']::text[] else ARRAY['studio.diagnostic']::text[] end;
 end if; return new;
end $$;
UPDATE studio.studio_devices SET allowed_kinds=array_append(allowed_kinds,'studio.text_run') WHERE processing_enabled AND NOT 'studio.text_run'=any(allowed_kinds);

-- New snapshots use the validators/instructions shipped by the current worker. Existing runs remain immutable.
CREATE FUNCTION studio.studio_text_prompt_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
begin
 if new.workflow='idea_review' then new.prompt_version:='studio.idea-review.v2';
 elsif new.workflow='script_brief' then new.prompt_version:='studio.script-brief.v2'; end if;
 return new;
end $$;
REVOKE ALL ON FUNCTION studio.studio_text_prompt_version() FROM PUBLIC;
CREATE TRIGGER studio_text_prompt_version BEFORE INSERT ON studio.studio_idea_reviews FOR EACH ROW EXECUTE FUNCTION studio.studio_text_prompt_version();

-- The original enqueue functions still own snapshot building, membership, request dedupe and workflow bounds.
-- This wrapper makes the selected execution route part of that same atomic enqueue transaction.
CREATE FUNCTION studio.studio_enqueue_routed_text_run(p_location_id text,p_actor_app text,p_clerk_user_id text,p_workflow text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare route text:=coalesce(p_command->>'provider','openai'); r jsonb; run studio.studio_idea_reviews%rowtype; d studio.studio_devices%rowtype; prior uuid;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if route not in ('openai','subscription') or p_workflow not in ('idea_review','script_brief','knowledge_extract')
 or (route='openai' and p_command->>'confirmPaid' is distinct from 'true')
 or (route='subscription' and p_command->>'confirmSubscription' is distinct from 'true') then raise exception 'Explicit provider authorization required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location_id,0));
 select id into prior from studio.studio_idea_reviews where location_id=p_location_id and request_id=(p_command->>'requestId')::uuid;
 if prior is null and route='openai' and not exists(select 1 from public.settings_secrets where scope_type::text='LOCATION' and scope_id=p_location_id and domain='location.ai' and secret_key='openai_api_key') then
  raise exception 'Add a Location OpenAI API key before queuing this workflow' using errcode='22023';
 end if;
 if p_workflow='knowledge_extract' then
  r:=studio.studio_enqueue_knowledge_extraction(p_location_id,p_actor_app,p_clerk_user_id,(p_command->>'requestId')::uuid,(p_command->>'sourceId')::uuid,(p_command->>'expectedVersion')::bigint,p_command->>'mode',p_command->>'inputId',(p_command->>'startUnit')::integer,(p_command->>'unitCount')::integer,p_command->>'focus',true);
 else
  r:=studio.studio_enqueue_text_run(p_location_id,p_actor_app,p_clerk_user_id,(p_command->>'requestId')::uuid,p_command->'ideas',p_command->>'focus',true,p_workflow);
 end if;
 select * into run from studio.studio_idea_reviews where id=(r->>'reviewId')::uuid for update;
 if prior is not null then
  if run.execution_provider<>route then raise exception 'Request provider changed' using errcode='23505'; end if;
  return r;
 end if;
 if route='subscription' then
  -- Account-scoped: a teammate's subscription is never borrowed. AI-manager consent is required for Mac work.
  perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
  select * into d from studio.studio_devices where location_id=p_location_id and app=p_actor_app and created_by=p_clerk_user_id
   and revoked_at is null and not paused and processing_enabled and 'studio.text_run'=any(allowed_kinds)
   and seen_at<=clock_timestamp() and seen_at>clock_timestamp()-interval '90 seconds' and coalesce(report->>'draining','false')='false'
   and report->'handlers' ? 'studio.text_run' and desired_config#>>'{features,text}'='true'
   and desired_config->>'textProvider' in ('codex','claude') and config_version=applied_config_version and config_status='applied'
   and report#>>ARRAY[desired_config->>'textProvider','ready']='true'
   and report#>>ARRAY[desired_config->>'textProvider','authenticated']='true'
   and report#>>ARRAY[desired_config->>'textProvider','loginMethod']=case desired_config->>'textProvider' when 'codex' then 'chatgpt' else 'claudeai' end
   and report#>>ARRAY['capacity',desired_config->>'textProvider']='true'
   and coalesce(report->'processingBlocked','[]'::jsonb)='[]'::jsonb
   order by seen_at desc limit 1 for update;
  if not found then raise exception 'Your paired Mac must be ready with Text work and a subscription provider selected and applied' using errcode='22023'; end if;
  update studio.studio_idea_reviews set execution_provider=route,model='mac_'||(d.desired_config->>'textProvider')||':'||coalesce(d.desired_config->>'textModel','native-default') where id=run.id;
  update studio.studio_jobs set kind='studio.text_run',execution_target='device',device_id=d.id,max_attempts=1,
   payload=payload||jsonb_build_object('workflow',run.workflow,'snapshot',run.snapshot,'promptVersion',run.prompt_version,'provider',d.desired_config->>'textProvider','model',d.desired_config->'textModel','configVersion',d.config_version)
   where id=run.job_id;
 end if;
 return r;
end $$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb) TO service_role;

CREATE FUNCTION studio.studio_text_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; r studio.studio_idea_reviews%rowtype; v_result jsonb; stale boolean;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
 select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 if p_operation='claim' then
  if coalesce(p_body->>'leaseSeconds','') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 then raise exception 'Invalid lease' using errcode='22023'; end if;
  if exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then return '[]'::jsonb; end if;
  -- Fail changed/withdrawn consent visibly; never silently route to another CLI or API.
  update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),last_error_code='text_provider_changed',last_error_message='Mac settings changed. Start a new request with your chosen provider.'
   where device_id=d.id and kind='studio.text_run' and status='queued' and (not d.processing_enabled or not 'studio.text_run'=any(d.allowed_kinds) or d.desired_config#>>'{features,text}' is distinct from 'true' or (payload->>'configVersion')::integer<>d.config_version);
  if not d.paused and d.processing_enabled and 'studio.text_run'=any(d.allowed_kinds) and d.desired_config#>>'{features,text}'='true'
   and d.config_version=d.applied_config_version and d.config_status='applied' and p_body->>'textReady'='true' then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind='studio.text_run' and execution_target='device' and status='queued' and attempts=0 and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer) where id=j.id returning * into j;
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
 elsif p_operation in ('extend','complete','fail') then
  select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and execution_target='device' and kind='studio.text_run' for update;
  if found then
   if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end; end if;
   if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
   if p_operation='complete' then
    select * into r from studio.studio_idea_reviews where id=(j.payload->>'reviewId')::uuid and location_id=d.location_id and job_id=j.id and execution_provider='subscription' for update;
    v_result:=p_body->'result';
    if not found or jsonb_typeof(v_result) is distinct from 'object' or exists(select 1 from jsonb_each(v_result) e where e.key not in ('output','provider','model')) or v_result->>'provider' is distinct from j.payload->>'provider' or v_result->>'model' is distinct from coalesce(j.payload->>'model','native-default') or jsonb_typeof(v_result->'output') is distinct from 'object' or octet_length(v_result::text)>24576 then raise exception 'Invalid text result' using errcode='22023'; end if;
    perform studio.studio_validate_text_run_result(r.workflow,v_result->'output',r.snapshot);
    if r.workflow='knowledge_extract' then stale:=not studio.studio_knowledge_snapshot_current(d.location_id,r.snapshot);
    else
     perform 1 from studio.studio_records x where x.location_id=d.location_id and x.id in (select (i->>'id')::uuid from jsonb_array_elements(r.snapshot->'ideas') i union select (s->>'id')::uuid from jsonb_array_elements(r.snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) order by x.id for share;
     select exists(select 1 from (select i from jsonb_array_elements(r.snapshot->'ideas') i union all select s from jsonb_array_elements(r.snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) a where not exists(select 1 from studio.studio_records x where x.location_id=d.location_id and x.id=(a.i->>'id')::uuid and x.version=(a.i->>'version')::bigint)) into stale;
    end if;
    update studio.studio_idea_reviews set result=v_result->'output',stale_at_completion=stale,completed_at=clock_timestamp(),model='mac_'||(v_result->>'provider')||':'||(v_result->>'model') where id=r.id;
    return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,v_result));
   end if;
   -- Only pre-execution capacity/policy waits may be retried. Every uncertain/failed execution is terminal.
   if p_body#>>'{failure,code}' in ('subscription_capacity','local_policy') and p_body#>>'{failure,retryable}'='true' then
    update studio.studio_jobs set attempts=0 where id=j.id;
    return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,p_body#>>'{failure,code}',p_body#>>'{failure,message}',true,300));
   end if;
   return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,'text_execution_uncertain','Subscription execution stopped without a validated saved result. Automatic replay is blocked.',false,null));
  end if;
 end if;
 return studio.studio_onboarding_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
end $$;
REVOKE ALL ON FUNCTION studio.studio_text_device_command(text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_text_device_command(text,text,text,jsonb,text) TO service_role;

CREATE FUNCTION studio.studio_text_replay_fence() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
begin
 if old.kind='studio.text_run' and new.status='queued' and old.status='failed' then
  raise exception 'Subscription execution cannot be replayed; start a new explicitly authorized request' using errcode='40001';
 end if;
 if old.kind='studio.text_run' and old.attempts>0 and new.status='queued' then
  new.attempts:=greatest(old.attempts,1);
  new.status:='failed';new.finished_at:=clock_timestamp();new.lease_owner:=null;new.lease_expires_at:=null;new.last_error_code:='text_execution_uncertain';
 end if;return new;
end $$;
REVOKE ALL ON FUNCTION studio.studio_text_replay_fence() FROM PUBLIC;
CREATE TRIGGER studio_text_replay_fence BEFORE UPDATE ON studio.studio_jobs FOR EACH ROW EXECUTE FUNCTION studio.studio_text_replay_fence();
-- Queued work cannot outlive its grant/settings or revocation. Running results keep their pinned route and lease.
CREATE FUNCTION studio.studio_text_device_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.revoked_at is not null or not new.processing_enabled or new.config_version<>old.config_version then
  update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),last_error_code='text_provider_changed',last_error_message='Mac settings or authority changed. Start a new request with your chosen provider.'
   where device_id=new.id and kind='studio.text_run' and status='queued';
 end if;return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_text_device_release() FROM PUBLIC;
CREATE TRIGGER studio_text_device_release AFTER UPDATE OF revoked_at,processing_enabled,config_version ON studio.studio_devices FOR EACH ROW EXECUTE FUNCTION studio.studio_text_device_release();

-- Retain the existing Library request/evidence/apply path while recording the actual selected CLI model.
CREATE OR REPLACE FUNCTION studio.studio_library_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
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
    if jsonb_typeof(result) is distinct from 'object' or octet_length(result::text)>4096 or exists(select 1 from jsonb_each(result) e where e.key not in ('summary','provider','model')) or jsonb_typeof(result->'summary') is distinct from 'string' or length(btrim(result->>'summary')) not between 1 and 1500 or coalesce(result->>'provider','') not in ('codex','claude') or coalesce(result->>'model','') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$' then raise exception 'Invalid summary'; end if;
    select * into r from studio.studio_records where location_id=j.location_id and id=(j.payload->>'recordId')::uuid for update;
    ok:=studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,result);
    if ok and r.version=(j.payload->>'recordVersion')::bigint and exists(select 1 from studio.studio_library_summary_requests where location_id=r.location_id and record_id=r.id and job_id=j.id) then
     update studio.studio_records set payload=payload || jsonb_build_object('aiSummary',result->>'summary','summaryProvider',result->>'provider','summaryModel',result->>'model','summaryStatus','ready','summaryBasis',case when j.payload ? 'transcript' then 'transcript' else 'description' end),version=version+1,updated_at=clock_timestamp() where location_id=r.location_id and id=r.id;
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

COMMIT;
