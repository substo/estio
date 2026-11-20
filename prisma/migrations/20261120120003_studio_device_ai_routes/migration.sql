BEGIN;

-- The private device route only has steps which this authenticated, owner-bound Mac can execute.
-- Capacity is checked again immediately before each generation by the companion.
CREATE FUNCTION studio.studio_device_local_ai_route(p_device studio.studio_devices,p_family text,p_kinds text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
declare settings jsonb; step jsonb; kind text; provider text; model text; requested jsonb; candidates jsonb:='[]';
begin
 select payload->'aiRouting' into settings from public.settings_documents
  where scope_type::text='LOCATION' and scope_id=p_device.location_id and domain='location.ai';
 for step in select value from jsonb_array_elements(
   case when jsonb_typeof(settings->'chain')='array' then settings->'chain'
    else '[{"kind":"device_codex"},{"kind":"device_claude"},{"kind":"chatgpt_subscription"}]'::jsonb end) loop
  kind:=step->>'kind';
  if kind is null or kind not in ('device_codex','device_claude') or (p_kinds is not null and not (kind=any(p_kinds))) then continue; end if;
  provider:=substring(kind from 8);
  model:=coalesce(settings#>>array['taskDefaults',p_family,kind],step->>'model',
   case when p_device.desired_config->>'textProvider'=provider then p_device.desired_config->>'textModel' end);
  if requested is null then requested:=jsonb_build_object('kind',kind,'model',model); end if;
  if p_device.report->>'deviceAiRouteVersion' is distinct from '1' then continue; end if;
  if model is not null and (model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'
   or (jsonb_typeof(p_device.report#>array[provider,'models'])='array'
    and p_device.report#>array[provider,'models']<>'[]'::jsonb and not ((p_device.report#>array[provider,'models']) ? model))) then continue; end if;
  candidates:=candidates||jsonb_build_array(jsonb_build_object('kind',kind,'model',model,'deviceId',p_device.id));
 end loop;
 return jsonb_build_object('requested',requested,'candidates',candidates);
end $$;
REVOKE ALL ON FUNCTION studio.studio_device_local_ai_route(studio.studio_devices,text,text[]) FROM PUBLIC;

-- Reuse the existing leased claim and complete commands. A claim is pinned before leaving the transaction. Completion
-- still runs through the original business validation and accepts attribution only for one admitted step.
CREATE FUNCTION studio.studio_routed_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; response jsonb; actual jsonb; v_result jsonb; planned jsonb; local_family text; reason text;
begin
 if p_operation not in ('claim','complete') then
  return studio.studio_youtube_search_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;
 if p_operation='claim' then
  response:=studio.studio_youtube_search_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
  if jsonb_array_length(response)=0 then return response; end if;
  select * into j from studio.studio_jobs where id=(response#>>'{0,id}')::uuid;
  local_family:=case when j.kind='studio.library_summary' then 'summaries'
   when j.kind='studio.youtube_search' and j.payload->>'mode' in ('plan_search_rank','rank') then 'research'
   when j.kind='studio.video_transcribe' and jsonb_typeof(j.payload->'gate')='object' then 'research' end;
  if local_family is null then return response; end if;
  select * into d from studio.studio_devices where id=j.device_id;
  if d.report->>'deviceAiRouteVersion' is distinct from '1' then
   -- Older companions ignore the per-job route. Wait for an upgrade before issuing generation.
   -- Plain YouTube searches and manual video transcription do not use this AI route.
   update studio.studio_jobs set status='queued',attempts=greatest(0,attempts-1),lease_owner=null,
    lease_token=null,lease_expires_at=null,run_after=clock_timestamp()+interval '5 minutes',
    last_error_code='companion_outdated',last_error_message='Update the Studio companion to run this Location AI route.'
    where id=j.id;
   update studio.studio_video_transcriptions set status='queued',error_code='companion_outdated',
    error_message='Update the Studio companion to use this Location AI route.' where job_id=j.id and status='running';
   return '[]'::jsonb;
  end if;
  planned:=studio.studio_device_local_ai_route(d,local_family);
  update studio.studio_jobs set route=planned where id=j.id returning * into j;
  return jsonb_build_array(to_jsonb(j));
 end if;

 -- Lock the same authority and device rows in the same order as the delegated protocol.
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
 select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id
  and device_id=d.id and execution_target='device' and created_by_clerk_user_id=d.created_by for update;
 if j.kind not in ('studio.library_summary','studio.onboarding_research','studio.video_transcribe','studio.youtube_search')
  or j.route is null or j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId'
  or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then
  return studio.studio_youtube_search_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;
 v_result:=p_body->'result';
 if j.kind='studio.video_transcribe' then
  actual:=p_body->'routeActual';
 elsif j.kind='studio.youtube_search' then
  if v_result#>'{trace,planner}' is not null then
   perform studio.studio_check_local_route_actual(j.route,v_result#>'{trace,planner}');
  end if;
  actual:=coalesce(v_result#>'{trace,ranker}',v_result#>'{trace,planner}');
 else
  actual:=v_result;
 end if;
 if j.kind<>'studio.youtube_search' or actual is not null then
  actual:=studio.studio_check_local_route_actual(j.route,actual);
 end if;

 -- The original research protocol validates only the old sentinel. Substitute it for the delegated transport, then use
 -- the validated result for both the job and the durable onboarding apply command.
 if j.kind='studio.onboarding_research' then
  p_body:=jsonb_set(p_body,'{result,model}','"native-default"'::jsonb);
 end if;
 response:=studio.studio_youtube_search_device_command(p_token_hash,p_app,p_operation,p_body-'routeActual',p_estio_authorized_by,p_observed);
 if response='true'::jsonb and actual is not null then
  reason:=j.route->>'reason';
  if j.route#>>'{candidates,0,kind}' is distinct from actual->>'kind' then
   reason:=concat_ws('; ',reason,studio.studio_route_label(j.route#>>'{candidates,0,kind}')||' unavailable before generation → '||studio.studio_route_label(actual->>'kind'));
  end if;
  update studio.studio_jobs set route=j.route||jsonb_build_object('actual',actual,'reason',reason),
   result=case when j.kind='studio.onboarding_research' then v_result else studio.studio_jobs.result end where id=j.id;
 end if;
 return response;
end $$;
REVOKE ALL ON FUNCTION studio.studio_routed_device_command(text,text,text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_routed_device_command(text,text,text,jsonb,text,jsonb) TO service_role;

CREATE FUNCTION studio.studio_check_local_route_actual(p_route jsonb,p_report jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
declare provider text:=p_report->>'provider'; model text:=p_report->>'model'; kind text:='device_'||provider;
begin
 if provider is null or provider not in ('codex','claude') or model is null or model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'
  or not exists(select 1 from jsonb_array_elements(p_route->'candidates') s where s->>'kind'=kind and coalesce(s->>'model','native-default')=model) then
  raise exception 'Provider or model was not admitted for this job' using errcode='22023';
 end if;
 return jsonb_build_object('kind',kind,'model',model);
end $$;
REVOKE ALL ON FUNCTION studio.studio_check_local_route_actual(jsonb,jsonb) FROM PUBLIC;

-- An expired gated transcription lease may already have executed relevance generation. Preserve the ordinary
-- unmetered transcription retry, but do not rerun the model or fall through to another connection on an unknown result.
CREATE FUNCTION studio.studio_device_generation_expiry_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if old.execution_target='device' and old.kind='studio.onboarding_research' and old.status='running'
  and old.lease_expires_at<=clock_timestamp() and new.status='queued' and new.last_error_code='worker_lease_expired' then
  new.status:='failed'; new.finished_at:=clock_timestamp();
  new.last_error_code:='research_execution_uncertain';
  new.last_error_message:='The Mac stopped before research was confirmed. Start a new request to research again.';
 end if;
 if old.kind='studio.video_transcribe' and jsonb_typeof(old.payload->'gate')='object' and old.status='running'
  and old.lease_expires_at<=clock_timestamp() and new.status in ('queued','failed') and new.last_error_code='worker_lease_expired' then
  new.status:='failed'; new.finished_at:=clock_timestamp();
  new.last_error_code:='video_relevance_execution_uncertain';
  new.last_error_message:='The Mac stopped with the relevance run in progress. Use Transcribe on your Mac to start a new request.';
  update studio.studio_video_transcriptions set status='failed',error_code=new.last_error_code,error_message=new.last_error_message,
   completed_at=clock_timestamp(),updated_at=clock_timestamp() where job_id=old.id and status='running';
 end if;
 return new;
end $$;
REVOKE ALL ON FUNCTION studio.studio_device_generation_expiry_fence() FROM PUBLIC;
CREATE TRIGGER studio_device_generation_expiry_fence BEFORE UPDATE OF status ON studio.studio_jobs
 FOR EACH ROW EXECUTE FUNCTION studio.studio_device_generation_expiry_fence();

-- List only eligible research steps for the original requesting Account, including the chosen model.
CREATE FUNCTION studio.studio_onboarding_mac_routes(p_location_id text,p_actor_app text,p_clerk_user_id text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 select coalesce(jsonb_agg(s.step order by d.seen_at desc,s.n),'[]'::jsonb)
 from studio.studio_devices d
 cross join lateral jsonb_array_elements(studio.studio_device_local_ai_route(d,'research')->'candidates') with ordinality s(step,n)
 where d.location_id=p_location_id and d.app=p_actor_app and d.created_by=p_clerk_user_id and d.revoked_at is null
  and not d.paused and d.processing_enabled and 'studio.onboarding_research'=any(d.allowed_kinds)
  and d.seen_at between clock_timestamp()-interval '90 seconds' and clock_timestamp()
  and coalesce(d.report->>'draining','false')='false'
  and d.report->'handlers' ? 'studio.onboarding_research' and coalesce(d.report->'processingBlocked','[]'::jsonb)='[]'
  and d.report#>>array[substring(s.step->>'kind' from 8),'ready']='true'
  and d.report#>>array[substring(s.step->>'kind' from 8),'authenticated']='true'
  and d.report#>>array[substring(s.step->>'kind' from 8),'loginMethod']=case s.step->>'kind' when 'device_codex' then 'chatgpt' else 'claudeai' end
  and d.report#>>array['capacity',substring(s.step->>'kind' from 8)]='true'
$$;
REVOKE ALL ON FUNCTION studio.studio_onboarding_mac_routes(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_onboarding_mac_routes(text,text,text) TO service_role;

CREATE FUNCTION studio.studio_enqueue_routed_onboarding_research(p_location_id text,p_actor_app text,p_clerk_user_id text,p_device_id uuid,
 p_payload jsonb,p_idempotency_key text,p_kinds text[],p_remaining text[],p_requested jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; plan jsonb; candidates jsonb; queued jsonb; existing studio.studio_jobs%rowtype;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 select * into existing from studio.studio_jobs where location_id=p_location_id and idempotency_key=p_idempotency_key for update;
 if found then
  if existing.kind<>'studio.onboarding_research' or existing.execution_target<>'device' or existing.created_by_clerk_user_id<>p_clerk_user_id
   or existing.payload->>'batch' is distinct from p_payload->>'batch' or existing.payload->>'topic' is distinct from p_payload->>'topic' then
   raise exception 'Idempotency key already used' using errcode='23505'; end if;
  return jsonb_build_object('jobId',existing.id,'deviceId',existing.device_id);
 end if;
 select * into d from studio.studio_devices where id=p_device_id and location_id=p_location_id and app=p_actor_app
  and created_by=p_clerk_user_id and revoked_at is null for update;
 if not found or p_payload->>'app' is distinct from p_actor_app or cardinality(p_kinds) not between 1 and 2 or coalesce(cardinality(p_remaining),0)>4 then
  raise exception 'Mac research route is no longer available' using errcode='P2030';
 end if;
 plan:=studio.studio_device_local_ai_route(d,'research',p_kinds);
 select coalesce(jsonb_agg(candidate order by n),'[]'::jsonb) into candidates
 from jsonb_array_elements(plan->'candidates') with ordinality a(candidate,n)
 where candidate in (select value from jsonb_array_elements(studio.studio_onboarding_mac_routes(p_location_id,p_actor_app,p_clerk_user_id)));
 if candidates#>>'{0,kind}' is distinct from p_kinds[1] then raise exception 'Mac research route is no longer available' using errcode='P2030'; end if;
 -- A queued duplicate can never create an additional native generation.
 queued:=studio.studio_enqueue_device_onboarding_research(p_location_id,p_device_id,p_payload,p_idempotency_key,p_clerk_user_id);
 update studio.studio_jobs set route=jsonb_build_object('requested',coalesce(p_requested,plan->'requested'),'candidates',candidates,
  'remainingKinds',coalesce(p_remaining,array[]::text[]),'reason',left(p_reason,300))
  where id=(queued->>'jobId')::uuid and route is null and attempts=0;
 return queued;
end $$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_routed_onboarding_research(text,text,text,uuid,jsonb,text,text[],text[],jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_routed_onboarding_research(text,text,text,uuid,jsonb,text,text[],text[],jsonb,text) TO service_role;

-- Only a companion capacity rejection before generation can continue down the saved remaining order.
-- The ordinary apply path still handles old jobs and all uncertain/terminal outcomes.
CREATE OR REPLACE FUNCTION studio.studio_onboarding_device_finished() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare continuation jsonb;
begin
 if new.kind='studio.onboarding_research' and new.execution_target='device' and new.status in ('succeeded','failed','cancelled')
  and old.status not in ('succeeded','failed','cancelled') then
  if new.status='failed' and new.last_error_code='onboarding_route_wait'
   and jsonb_typeof(new.route->'remainingKinds')='array' and jsonb_array_length(new.route->'remainingKinds')>0 then
   continuation:=jsonb_build_object('app',new.payload->>'app','createdBy',new.created_by_clerk_user_id,
    'remainingKinds',new.route->'remainingKinds','requested',new.route->'requested','reason',new.last_error_message);
  end if;
  perform studio.studio_enqueue_job(new.location_id,'studio.onboarding_apply',
   jsonb_build_object('jobId',new.id,'batch',new.payload->'batch','topic',new.payload->'topic','actorId',coalesce(new.payload->'actorId','null'::jsonb),'status',new.status)
   || case when new.status='succeeded' then jsonb_build_object('result',new.result)
      else jsonb_build_object('error',coalesce(new.last_error_message,'Research on the Mac was cancelled.')) end
   || case when continuation is not null then jsonb_build_object('continuation',continuation) else '{}'::jsonb end,
   'onboarding-apply:'||new.id||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS'),new.created_by_clerk_user_id,3);
 end if;
 return null;
end $$;

COMMIT;
