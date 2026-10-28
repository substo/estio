-- Minimal operational aggregates and process-lifetime identity; no queue claim or customer payload output.
do $$ declare s jsonb; t timestamptz:=clock_timestamp(); before_jobs bigint; before_attempts bigint;
begin
 if has_function_privilege('authenticated','studio.studio_readiness_snapshot()','execute') or
 has_function_privilege('anon','studio.studio_report_worker(text,text,timestamptz,text,text[],boolean,boolean)','execute') then raise exception 'Browser readiness grant'; end if;
 if not has_function_privilege('service_role','studio.studio_readiness_snapshot()','execute') then raise exception 'Missing service readiness grant'; end if;
 select count(*) into before_jobs from studio.studio_jobs;
 select count(*) into before_attempts from studio.studio_ai_attempts;
 perform studio.studio_report_worker('readiness-fixture','build-ready',t,'instance-ready',array['studio.diagnostic'],false,false);
 s:=studio.studio_readiness_snapshot();
 if s->>'schema'<>'29' or s->>'protocol'<>'1' or not (s ? 'queue') or not(s ? 'keyIds') then raise exception 'Missing contract'; end if;
 if exists(select 1 from jsonb_array_elements(s->'workers') w where w->>'instance_id'='instance-ready' and (w->>'healthy')::boolean) then raise exception 'Unproven claim reported healthy'; end if;
 perform studio.studio_report_worker('readiness-fixture','build-ready',t,'instance-ready',array['studio.diagnostic'],true,false);
 if not (select healthy from studio.studio_worker_heartbeats where worker_id='readiness-fixture') then raise exception 'Successful claim not healthy'; end if;
 perform studio.studio_report_worker('readiness-fixture','build-ready',t,'instance-ready',array['studio.diagnostic'],false,true);
 perform studio.studio_report_worker('readiness-fixture','build-ready',t,'instance-ready',array['studio.diagnostic'],true,false);
 if (select healthy or not draining from studio.studio_worker_heartbeats where worker_id='readiness-fixture') then raise exception 'Late pulse revived draining worker'; end if;
 begin perform studio.studio_report_worker('readiness-fixture','build-other',t,'instance-other',array['studio.diagnostic'],true,false); raise exception 'Conflicting identity accepted'; exception when unique_violation then null; end;
 begin perform studio.studio_report_worker('bad-worker','build-ready',t,'instance-ready',array['not.a.handler'],true,false); raise exception 'Invalid handler accepted'; exception when invalid_parameter_value then null; end;
 perform studio.studio_worker_heartbeat('readiness-fixture','build-ready',t);
 if exists(select 1 from studio.studio_worker_heartbeats where worker_id='readiness-fixture' and (healthy or protocol is not null)) then raise exception 'Legacy report retained readiness'; end if;
 -- Legacy workers can continue reporting liveness but never satisfy protocol/capability readiness.
 perform studio.studio_worker_heartbeat('legacy-readiness-fixture','build-ready',t);
 if exists(select 1 from studio.studio_worker_heartbeats where worker_id='legacy-readiness-fixture' and (healthy or protocol is not null)) then raise exception 'Legacy heartbeat became ready'; end if;
 if (select count(*) from studio.studio_jobs)<>before_jobs or (select count(*) from studio.studio_ai_attempts)<>before_attempts then raise exception 'Readiness mutated paid queue'; end if;
 if exists(select 1 from jsonb_array_elements(s->'workers') w where w ? 'worker_id' or w ? 'payload' or w ? 'clerk_user_id') then raise exception 'Readiness leaked principal or payload'; end if;
end $$;
set role service_role;
select studio.studio_readiness_snapshot() is not null as service_readiness_access;
reset role;
select 'Studio readiness assertions passed' as result;
