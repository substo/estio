BEGIN;
-- Additive: the Location's ordered AI fallback chain (settings `location.ai` → `aiRouting.chain`, see lib/ai/routing.ts) admits a
-- Studio text run on the first eligible candidate, and moves a queued Mac job to the next candidate only on a pre-generation
-- capacity wait. Started/uncertain runs keep the existing replay fences. Every job and paid usage row records requested vs actual.
ALTER TABLE studio.studio_jobs ADD COLUMN route jsonb CHECK (route IS NULL OR (jsonb_typeof(route)='object' AND octet_length(route::text)<=4096));
ALTER TABLE studio.studio_ai_usage ADD COLUMN route jsonb CHECK (route IS NULL OR (jsonb_typeof(route)='object' AND octet_length(route::text)<=4096));

-- The kinds an admin ordered, or the no-paid default until one is saved. Same default as DEFAULT_AI_ROUTING.
CREATE FUNCTION studio.studio_location_ai_chain(p_location text) RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
begin
 return coalesce((select array_agg(s->>'kind' order by n) from public.settings_documents d, jsonb_array_elements(d.payload#>'{aiRouting,chain}') with ordinality e(s,n)
   where d.scope_type::text='LOCATION' and d.scope_id=p_location and d.domain='location.ai' and jsonb_typeof(d.payload#>'{aiRouting,chain}')='array'),
  (select case when exists(select 1 from public.settings_documents d where d.scope_type::text='LOCATION' and d.scope_id=p_location and d.domain='location.ai'
   and jsonb_typeof(d.payload#>'{aiRouting,chain}')='array') then ARRAY[]::text[] end),
  ARRAY['device_codex','device_claude','chatgpt_subscription']);
end $$;
REVOKE ALL ON FUNCTION studio.studio_location_ai_chain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_location_ai_chain(text) TO service_role;

-- The requester's own ready Mac for one subscription provider. A Mac whose companion does not report `textRouteVersion: 1`
-- only runs the provider its Setup selected (older companions reject any other provider before generation).
CREATE FUNCTION studio.studio_pick_text_device(p_location text,p_app text,p_user text,p_workflow text,p_command jsonb,p_snapshot jsonb,p_provider text,p_device uuid)
RETURNS studio.studio_devices LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 select * from studio.studio_devices where location_id=p_location and app=p_app and created_by=p_user and (p_device is null or id=p_device)
  and revoked_at is null and not paused and processing_enabled and 'studio.text_run'=any(allowed_kinds)
  and seen_at<=clock_timestamp() and seen_at>clock_timestamp()-interval '90 seconds' and coalesce(report->>'draining','false')='false'
  and report->'handlers' ? 'studio.text_run'
  and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'outline' or report->>'knowledgeOutlineVersion'='2')
  and (p_snapshot->>'curationVersion' is distinct from '1' or report->>'knowledgeCurationVersion'='1')
  and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'script_template' or report->>'videoTemplateVersion'='1')
  and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'source_assist' or report->>'sourceAssistVersion'='1')
  and (p_snapshot->>'selectedOutline' is null or report->>'knowledgeCurationVersion'='1')
  and desired_config#>>'{features,text}'='true' and config_version=applied_config_version and config_status='applied'
  and (desired_config->>'textProvider'=p_provider or report->>'textRouteVersion'='1')
  and report#>>ARRAY[p_provider,'ready']='true' and report#>>ARRAY[p_provider,'authenticated']='true'
  and report#>>ARRAY[p_provider,'loginMethod']=case p_provider when 'codex' then 'chatgpt' else 'claudeai' end
  and report#>>ARRAY['capacity',p_provider]='true'
  and coalesce(report->'processingBlocked','[]'::jsonb)='[]'::jsonb
  order by seen_at desc limit 1 for update;
$$;
REVOKE ALL ON FUNCTION studio.studio_pick_text_device(text,text,text,text,jsonb,jsonb,text,uuid) FROM PUBLIC;

-- Paid precheck only: the atomic reservation still happens when the hosted attempt begins (studio_reserve_ai_spend).
CREATE FUNCTION studio.studio_openai_route_reason(p_location text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
begin
 return case
  when not exists(select 1 from public.settings_secrets where scope_type::text='LOCATION' and scope_id=p_location and domain='location.ai' and secret_key='openai_api_key') then 'OpenAI API isn''t connected'
  when coalesce((select monthly_budget_micros from studio.studio_location_ai_settings where location_id=p_location),0)<=0 then 'OpenAI API: no monthly cap set'
  when (select coalesce(sum(case status when 'settled' then cost_micros when 'reserved' then reserved_micros else 0 end),0) from studio.studio_ai_usage
        where location_id=p_location and usage_month=date_trunc('month',now() at time zone 'UTC')::date)+10000
       >(select monthly_budget_micros from studio.studio_location_ai_settings where location_id=p_location) then 'OpenAI API: monthly cap reached'
 end;
end $$;
REVOKE ALL ON FUNCTION studio.studio_openai_route_reason(text) FROM PUBLIC;

CREATE FUNCTION studio.studio_route_label(p_kind text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 select case p_kind when 'device_codex' then 'Codex' when 'device_claude' then 'Claude' when 'openai_key' then 'OpenAI API' else p_kind end;
$$;

-- Try each remaining candidate in order on an existing review/job; returns the updated route, or {"rejected": skipped} when none can run now.
-- Device candidates move the job to that Mac; openai_key leaves/moves it to the hosted paid path.
CREATE FUNCTION studio.studio_admit_text_route(p_location text,p_app text,p_user text,p_review uuid,p_command jsonb,p_route jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare run studio.studio_idea_reviews%rowtype; d studio.studio_devices%rowtype; c jsonb; i integer:=0; p text; m text; why text; skipped jsonb:=coalesce(p_route->'skipped','[]'::jsonb);
 chain text[]:=studio.studio_location_ai_chain(p_location); n integer:=jsonb_array_length(p_route->'candidates'); first_skip text:=p_reason;
begin
 select * into run from studio.studio_idea_reviews where id=p_review and location_id=p_location for update;
 for c in select value from jsonb_array_elements(p_route->'candidates') loop
  i:=i+1; why:=null;
  if not (c->>'kind'=any(chain)) then why:=studio.studio_route_label(c->>'kind')||' isn''t in this Location''s order';
  elsif c->>'kind' in ('device_codex','device_claude') then
   p:=case c->>'kind' when 'device_codex' then 'codex' else 'claude' end;
   perform studio.studio_lock_ai_manager(p_location,p_app,p_user);
   d:=studio.studio_pick_text_device(p_location,p_app,p_user,run.workflow,p_command,run.snapshot,p,nullif(c->>'deviceId','')::uuid);
   if d.id is null then why:=studio.studio_route_label(c->>'kind')||' on your Mac isn''t ready';
   else
    -- A pre-route companion pins the Setup model; a route-aware one runs the candidate's model.
    m:=case when d.report->>'textRouteVersion'='1' then coalesce(c->>'model',d.desired_config->>'textModel') else d.desired_config->>'textModel' end;
    update studio.studio_idea_reviews set execution_provider='subscription',model='mac_'||p||':'||coalesce(m,'native-default') where id=run.id;
    update studio.studio_jobs set kind='studio.text_run',execution_target='device',device_id=d.id,max_attempts=1,
     payload=payload||jsonb_build_object('workflow',run.workflow,'snapshot',run.snapshot,'promptVersion',run.prompt_version,'provider',p,'model',to_jsonb(m),'configVersion',d.config_version)
     where id=run.job_id;
   end if;
  elsif c->>'kind'='openai_key' then
   why:=studio.studio_openai_route_reason(p_location);
   if why is null then
    update studio.studio_idea_reviews set execution_provider='openai',model=default where id=run.id;
    update studio.studio_jobs set kind='studio.'||run.workflow,execution_target='hosted',device_id=null,max_attempts=5,payload=payload-'provider'-'model'-'configVersion' where id=run.job_id;
   end if;
  else why:=studio.studio_route_label(c->>'kind')||' isn''t supported for Studio text';
  end if;
  if why is null then
   update studio.studio_jobs set route=jsonb_build_object('requested',p_route->'requested',
     'actual',jsonb_build_object('kind',c->>'kind','model',case when c->>'kind'='openai_key' then null else to_jsonb(m) end),
     'reason',case when p_route#>>'{requested,kind}' is distinct from c->>'kind' and first_skip is not null then left(first_skip||' → '||studio.studio_route_label(c->>'kind'),300) end,
     'candidates',coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(p_route->'candidates') with ordinality t(x,o) where o>i),'[]'::jsonb),
     'skipped',skipped) where id=run.job_id;
   return (select route from studio.studio_jobs where id=run.job_id);
  end if;
  first_skip:=coalesce(first_skip,why);
  skipped:=skipped||jsonb_build_array(jsonb_build_object('kind',c->>'kind','reason',why));
 end loop;
 return jsonb_build_object('rejected',skipped);
end $$;
REVOKE ALL ON FUNCTION studio.studio_admit_text_route(text,text,text,uuid,jsonb,jsonb,text) FROM PUBLIC;

CREATE FUNCTION studio.studio_valid_text_route(p_route jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 select jsonb_typeof(p_route)='object' and octet_length(p_route::text)<=4096
  and not exists(select 1 from jsonb_object_keys(p_route) k where k not in ('requested','candidates','skipped'))
  and jsonb_typeof(p_route->'candidates')='array' and jsonb_array_length(p_route->'candidates') between 1 and 5
  and not exists(select 1 from jsonb_array_elements(p_route->'candidates') c where jsonb_typeof(c)<>'object'
   or exists(select 1 from jsonb_object_keys(c) k where k not in ('kind','model','deviceId'))
   or c->>'kind' not in ('device_codex','device_claude','openai_key')
   or (c ? 'model' and jsonb_typeof(c->'model')<>'null' and coalesce(c->>'model','') !~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$')
   or (c ? 'deviceId' and coalesce(c->>'deviceId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and (select count(distinct c->>'kind') from jsonb_array_elements(p_route->'candidates') c)=jsonb_array_length(p_route->'candidates')
  and (not p_route ? 'requested' or (jsonb_typeof(p_route->'requested')='object' and p_route#>>'{requested,kind}' ~ '^[a-z_]{1,40}$'
   and (p_route#>'{requested,model}' is null or jsonb_typeof(p_route#>'{requested,model}')='null' or p_route#>>'{requested,model}' ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$')))
  and (not p_route ? 'skipped' or (jsonb_typeof(p_route->'skipped')='array' and jsonb_array_length(p_route->'skipped')<=8
   and not exists(select 1 from jsonb_array_elements(p_route->'skipped') s where jsonb_typeof(s)<>'object' or s->>'kind' !~ '^[a-z_]{1,40}$' or length(coalesce(s->>'reason',''))>300)));
$$;

-- Routed admission. Without `route` the explicit single-provider contract is unchanged (and now records requested = actual).
ALTER FUNCTION studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb) RENAME TO studio_enqueue_routed_text_run_before_chain;
CREATE FUNCTION studio.studio_enqueue_routed_text_run(p_location_id text,p_actor_app text,p_clerk_user_id text,p_workflow text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare r jsonb; route jsonb; prior uuid; j studio.studio_jobs%rowtype; v_reason text;
begin
 if not p_command ? 'route' then
  r:=studio.studio_enqueue_routed_text_run_before_chain(p_location_id,p_actor_app,p_clerk_user_id,p_workflow,p_command);
  select * into j from studio.studio_jobs where id=(r->>'jobId')::uuid;
  if j.route is null then
   update studio.studio_jobs set route=jsonb_build_object('requested',x.step,'actual',x.step) from (select case when j.execution_target='device'
     then jsonb_build_object('kind','device_'||(j.payload->>'provider'),'model',j.payload->'model') else jsonb_build_object('kind','openai_key','model',null) end step) x
    where id=j.id;
  end if;
  return r;
 end if;
 route:=p_command->'route';
 if not studio.studio_valid_text_route(route) or p_workflow not in ('idea_review','script_brief','knowledge_extract') then raise exception 'Invalid AI route' using errcode='22023'; end if;
 if p_workflow='knowledge_extract' and p_command->>'mode'='script_template' then
  perform studio.studio_lock_script_template_actor(p_location_id,p_actor_app,p_clerk_user_id,false);
 else
  perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location_id,0));
 select id into prior from studio.studio_idea_reviews where location_id=p_location_id and request_id=(p_command->>'requestId')::uuid;
 -- Same review/job creation as the explicit path. The hosted job never runs as created: this transaction moves it to the
 -- admitted candidate (or leaves it on the paid path only when openai_key was admitted), or raises and rolls back.
 if p_workflow='knowledge_extract' then
  r:=studio.studio_enqueue_knowledge_extraction(p_location_id,p_actor_app,p_clerk_user_id,(p_command->>'requestId')::uuid,(p_command->>'sourceId')::uuid,(p_command->>'expectedVersion')::bigint,p_command->>'mode',p_command->>'inputId',(p_command->>'startUnit')::integer,(p_command->>'unitCount')::integer,p_command->>'focus',true);
 else
  r:=studio.studio_enqueue_text_run(p_location_id,p_actor_app,p_clerk_user_id,(p_command->>'requestId')::uuid,p_command->'ideas',p_command->>'focus',true,p_workflow);
 end if;
 if prior is not null then return r; end if;
 select s->>'reason' into v_reason from jsonb_array_elements(coalesce(route->'skipped','[]'::jsonb)) s where s->>'kind'=route#>>'{requested,kind}' limit 1;
 route:=studio.studio_admit_text_route(p_location_id,p_actor_app,p_clerk_user_id,(r->>'reviewId')::uuid,p_command,route,v_reason);
 if route ? 'rejected' then
  raise exception 'No AI connection in this Location''s order can run this now' using errcode='P2020',
   detail=coalesce((select string_agg(s->>'reason','; ') from jsonb_array_elements(route->'rejected') s),'No candidate');
 end if;
 return r;
end $$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION studio.studio_enqueue_routed_text_run_before_chain(text,text,text,text,jsonb) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb) TO service_role;

-- A Mac reporting a retryable capacity wait (before generation) moves the job to the next candidate in its route.
-- Anything else, or no eligible next candidate, keeps the existing behavior (retry the same route, or terminal + replay fence).
ALTER FUNCTION studio.studio_text_device_command(text,text,text,jsonb,text) RENAME TO studio_text_device_command_before_route;
CREATE FUNCTION studio.studio_text_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; next jsonb; label text;
begin
 if p_operation='fail' and p_body#>>'{failure,code}'='subscription_capacity' and p_body#>>'{failure,retryable}'='true'
  and coalesce(p_body->>'jobId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
  if found and (d.app<>'estio' or p_estio_authorized_by is not distinct from d.created_by) then
   perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
   select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by
    and execution_target='device' and kind='studio.text_run' and status='running' and lease_owner=p_body->>'workerId'
    and lease_token=(nullif(p_body->>'leaseToken',''))::uuid and lease_expires_at>clock_timestamp() and jsonb_array_length(coalesce(route->'candidates','[]'::jsonb))>0 for update;
   if found then
    label:=studio.studio_route_label(j.route#>>'{actual,kind}');
    -- Clear the attempt first so the replay fence sees no started execution (a capacity wait never generated output).
    update studio.studio_jobs set attempts=0 where id=j.id;
    update studio.studio_jobs set status='queued',lease_owner=null,lease_token=null,lease_expires_at=null,run_after=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
    next:=studio.studio_admit_text_route(j.location_id,d.app,d.created_by,(j.payload->>'reviewId')::uuid,'{}'::jsonb||jsonb_build_object('mode',j.payload#>>'{snapshot,mode}'),
      jsonb_build_object('requested',j.route->'requested','candidates',j.route->'candidates','skipped',coalesce(j.route->'skipped','[]'::jsonb)||jsonb_build_array(jsonb_build_object('kind',j.route#>>'{actual,kind}','reason',label||' limit reached'))),
      label||' limit reached');
    if not next ? 'rejected' then
     insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,0,'requeued',p_body->>'workerId');
     return to_jsonb('retry_scheduled'::text);
    end if;
    -- No next candidate: restore the running lease so the original path records its usual retry on the same route.
    update studio.studio_jobs set status='running',attempts=j.attempts,lease_owner=j.lease_owner,lease_token=j.lease_token,lease_expires_at=j.lease_expires_at where id=j.id;
   end if;
  end if;
 end if;
 return studio.studio_text_device_command_before_route(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
end $$;
REVOKE ALL ON FUNCTION studio.studio_text_device_command(text,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION studio.studio_text_device_command_before_route(text,text,text,jsonb,text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION studio.studio_text_device_command(text,text,text,jsonb,text) TO service_role;

-- Paid usage rows carry the job's requested/actual route.
CREATE FUNCTION studio.studio_usage_route() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 update studio.studio_ai_usage u set route=j.route from studio.studio_jobs j where u.id=new.usage_id and j.id=new.job_id and j.route is not null and u.route is null;
 return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_usage_route() FROM PUBLIC;
CREATE TRIGGER studio_usage_route AFTER INSERT ON studio.studio_ai_attempts FOR EACH ROW EXECUTE FUNCTION studio.studio_usage_route();
COMMIT;
