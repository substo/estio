-- Ordered AI fallback chain (migration 20261120120001_ai_route_chain). Real SQL, isolated cluster, no providers.
create table if not exists public.settings_documents(scope_type text,scope_id text,domain text,payload jsonb);
create table if not exists public.settings_secrets(scope_type text,scope_id text,domain text,secret_key text);
create function pg_temp.pair_route_device(w text,actor text,code text,hash text,p_report jsonb) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Route Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,desired_config='{"features":{"text":true},"textProvider":"codex","textModel":null}',config_version=2,applied_config_version=2,config_status='applied',seen_at=clock_timestamp(),report=p_report where id=d;
 return d;
end $$;
do $$
declare w text:='f7a10000-0000-4000-8000-000000000001'; idea uuid:=gen_random_uuid(); src uuid:=gen_random_uuid(); d uuid; mate uuid;
 rep jsonb:='{"handlers":["studio.text_run"],"codex":{"ready":true,"authenticated":true,"loginMethod":"chatgpt"},"claude":{"ready":true,"authenticated":true,"loginMethod":"claudeai"},"capacity":{"codex":true,"claude":true}}';
 cmd jsonb; r jsonb; j studio.studio_jobs%rowtype; claim jsonb; body jsonb; res jsonb; n integer; a jsonb;
 rt jsonb:=jsonb_build_object('requested',jsonb_build_object('kind','device_codex','model',null),'candidates',jsonb_build_array(jsonb_build_object('kind','device_codex'),jsonb_build_object('kind','device_claude','model','sonnet'),jsonb_build_object('kind','openai_key')));
begin
 perform studio.studio_create_substo_location(w,'Route chain','route-owner');
 d:=pg_temp.pair_route_device(w,'route-owner','RTCHAAAA',repeat('7c',32),rep||'{"capacity":{"codex":false,"claude":true}}');
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,idea,'content','Idea','{"stage":"idea","notes":"Saved notes"}'),(w,src,'reference','Source','{"notes":"Exact saved evidence."}');
 insert into studio.studio_record_links values(w,idea,src);
 cmd:=jsonb_build_object('requestId',gen_random_uuid(),'ideas',jsonb_build_array(jsonb_build_object('id',idea,'version',1)),'focus','','route',rt);

 -- Paid step absent from the Location order (default chain): never admitted, nothing created.
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',jsonb_set(cmd,'{route,candidates}','[{"kind":"openai_key"}]'));
  raise exception 'Paid step outside the chain admitted'; exception when sqlstate 'P2020' then null; end;
 if exists(select 1 from studio.studio_idea_reviews where location_id=w) then raise exception 'Rejected route left a review'; end if;
 -- Codex at its limit; Claude ready but this companion predates per-job providers: nothing can run, visibly.
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',cmd);
  raise exception 'Pre-route companion given another provider'; exception when sqlstate 'P2020' then null; end;
 -- A route-aware companion takes Claude with the candidate model; the switch reason is recorded.
 update studio.studio_devices set report=report||'{"textRouteVersion":1}' where id=d;
 r:=studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',cmd);
 select * into j from studio.studio_jobs where id=(r->>'jobId')::uuid;
 if j.device_id<>d or j.payload->>'provider'<>'claude' or j.payload->>'model'<>'sonnet' or j.route#>>'{actual,kind}'<>'device_claude'
  or j.route->>'reason'<>'Codex on your Mac isn''t ready → Claude' or j.route#>>'{requested,kind}'<>'device_codex' or jsonb_array_length(j.route->'candidates')<>1 then raise exception 'Claude admission wrong %',j.route; end if;
 if (select model from studio.studio_idea_reviews where id=(r->>'reviewId')::uuid)<>'mac_claude:sonnet' then raise exception 'Review model not actual'; end if;
 if studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',cmd)<>r then raise exception 'Routed replay not idempotent'; end if;
 update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp() where id=j.id;

 -- A teammate's ready Mac is never used, even when named.
 mate:=pg_temp.pair_route_device(w,'route-owner','RTCHBBBB',repeat('8d',32),rep);
 update studio.studio_devices set created_by='route-mate' where id=mate;
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',jsonb_set(jsonb_set(cmd,'{requestId}',to_jsonb(gen_random_uuid())),'{route,candidates}',jsonb_build_array(jsonb_build_object('kind','device_codex','deviceId',mate))));
  raise exception 'Teammate Mac borrowed'; exception when sqlstate 'P2020' then null; end;
 update studio.studio_devices set revoked_at=clock_timestamp() where id=mate;

 -- Admin order includes the paid API: Codex → Claude → OpenAI, with a key and a monthly cap.
 insert into public.settings_documents values('LOCATION',w,'location.ai','{"aiRouting":{"version":1,"chain":[{"kind":"device_codex","model":null},{"kind":"device_claude","model":null},{"kind":"openai_key","model":null}],"taskDefaults":{}}}');
 insert into public.settings_secrets values('LOCATION',w,'location.ai','openai_api_key');
 update studio.studio_devices set report=report||'{"capacity":{"codex":true,"claude":true}}' where id=d;
 cmd:=jsonb_set(cmd,'{requestId}',to_jsonb(gen_random_uuid()));
 r:=studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',cmd);
 select * into j from studio.studio_jobs where id=(r->>'jobId')::uuid;
 if j.payload->>'provider'<>'codex' or j.route->>'reason' is not null then raise exception 'Requested step not used first %',j.route; end if;
 -- Codex reports its limit before generating: the job moves to Claude on the same Mac.
 claim:=studio.studio_text_device_command(repeat('7c',32),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 if claim->0->>'id'<>j.id::text then raise exception 'No claim %',claim; end if;
 body:=jsonb_build_object('workerId','mac','jobId',j.id,'leaseToken',claim->0->>'lease_token');
 res:=studio.studio_text_device_command(repeat('7c',32),'substo','fail',body||'{"failure":{"code":"subscription_capacity","message":"Waiting","retryable":true,"retryAfterSeconds":300}}');
 select * into j from studio.studio_jobs where id=j.id;
 if res<>'"retry_scheduled"' or j.status<>'queued' or j.attempts<>0 or j.payload->>'provider'<>'claude' or j.route->>'reason'<>'Codex limit reached → Claude'
  or j.run_after>clock_timestamp() or jsonb_array_length(j.route->'candidates')<>1 then raise exception 'Capacity switch wrong % %',res,j.route; end if;
 -- Claude is also at its limit; no monthly cap yet, so the paid step is skipped and the original retry applies.
 update studio.studio_devices set report=report||'{"capacity":{"codex":false,"claude":false}}' where id=d;
 claim:=studio.studio_text_device_command(repeat('7c',32),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',j.id,'leaseToken',claim->0->>'lease_token');
 res:=studio.studio_text_device_command(repeat('7c',32),'substo','fail',body||'{"failure":{"code":"subscription_capacity","message":"Waiting","retryable":true,"retryAfterSeconds":300}}');
 select * into j from studio.studio_jobs where id=j.id;
 if res<>'"retry_scheduled"' or j.execution_target<>'device' or j.payload->>'provider'<>'claude' or j.run_after<=clock_timestamp() then raise exception 'Uncapped paid step used % %',res,j.route; end if;
 -- With a cap, the next pre-generation wait moves the job onto the hosted paid path; the usage row records the route.
 perform studio.studio_set_ai_budget(w,'substo','route-owner',1000000);
 update studio.studio_jobs set run_after=clock_timestamp() where id=j.id;
 claim:=studio.studio_text_device_command(repeat('7c',32),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',j.id,'leaseToken',claim->0->>'lease_token');
 perform studio.studio_text_device_command(repeat('7c',32),'substo','fail',body||'{"failure":{"code":"subscription_capacity","message":"Waiting","retryable":true,"retryAfterSeconds":300}}');
 select * into j from studio.studio_jobs where id=j.id;
 if j.execution_target<>'hosted' or j.device_id is not null or j.kind<>'studio.idea_review' or j.route#>>'{actual,kind}'<>'openai_key' or j.route->>'reason'<>'Claude limit reached → OpenAI API'
  or (select execution_provider from studio.studio_idea_reviews where id=(r->>'reviewId')::uuid)<>'openai' then raise exception 'Paid switch wrong %',j.route; end if;
 perform studio.studio_claim_jobs('route-worker',50,60);
 select * into j from studio.studio_jobs where id=j.id;
 a:=studio.studio_begin_idea_review_attempt(w,(r->>'reviewId')::uuid,j.id,'route-worker',j.lease_token);
 if a->>'outcome'<>'started' then raise exception 'Paid attempt not started %',a; end if;
 if (select u.route#>>'{actual,kind}' from studio.studio_ai_usage u join studio.studio_ai_attempts t on t.usage_id=u.id where t.id=(a->>'attempt_id')::uuid)<>'openai_key' then raise exception 'Usage route missing'; end if;

 -- OpenAI first can switch to the requester's Mac only after a proven rejection.
 update public.settings_documents set payload='{"aiRouting":{"version":1,"chain":[{"kind":"openai_key"},{"kind":"device_codex"}]}}' where scope_id=w;
 update studio.studio_devices set report=report||'{"capacity":{"codex":true,"claude":true}}' where id=d;
 cmd:=jsonb_set(jsonb_set(cmd,'{requestId}',to_jsonb(gen_random_uuid())),'{route}',
   '{"requested":{"kind":"openai_key","model":"gpt-6-luna"},"candidates":[{"kind":"openai_key"},{"kind":"device_codex"}]}');
 r:=studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',cmd);
 perform studio.studio_claim_jobs('route-worker',50,60);
 select * into j from studio.studio_jobs where id=(r->>'jobId')::uuid;
 if j.route#>>'{actual,model}'<>'gpt-6-luna' then raise exception 'Paid model attribution missing'; end if;
 a:=studio.studio_begin_idea_review_attempt(w,(r->>'reviewId')::uuid,j.id,'route-worker',j.lease_token);
 if a->>'outcome'<>'started' then raise exception 'OpenAI-first attempt did not begin %',a; end if;
 perform studio.studio_close_ai_attempt(w,j.id,'route-worker',j.lease_token,(a->>'attempt_id')::uuid,true);
 if studio.studio_fail_job(j.id,'route-worker',j.lease_token,'text_provider_rejected','Rejected',false)<>'retry_scheduled' then
  raise exception 'Confirmed OpenAI rejection did not advance'; end if;
 select * into j from studio.studio_jobs where id=j.id;
 if j.status<>'queued' or j.attempts<>0 or j.payload->>'provider'<>'codex' or j.device_id<>d then
  raise exception 'OpenAI-first handoff is not claimable: %',j; end if;
 update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp() where id=j.id;

 -- Remove a paid step after enqueue. An untouched reservation ledger proves dispatch did not start.
 cmd:=jsonb_set(cmd,'{requestId}',to_jsonb(gen_random_uuid()));
 r:=studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',cmd);
 perform studio.studio_claim_jobs('route-worker',50,60);
 select * into j from studio.studio_jobs where id=(r->>'jobId')::uuid;
 update public.settings_documents set payload='{"aiRouting":{"version":1,"chain":[{"kind":"device_codex"},{"kind":"device_claude"}]}}' where scope_id=w;
 a:=studio.studio_begin_idea_review_attempt(w,(r->>'reviewId')::uuid,j.id,'route-worker',j.lease_token);
 if a->>'outcome'<>'route_unavailable' or exists(select 1 from studio.studio_ai_attempts where job_id=j.id) then raise exception 'Removed paid route dispatched %',a; end if;
 if studio.studio_fail_job(j.id,'route-worker',j.lease_token,'ai_route_unavailable','Removed',false)<>'retry_scheduled' then
  raise exception 'Removed paid route did not hand off'; end if;
 update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp() where id=j.id;
 cmd:=jsonb_set(cmd,'{route}',rt);

 -- A full-source outline admits its batches using the same Location order.
 update studio.studio_devices set report=report||'{"knowledgeOutlineVersion":2,"knowledgeCurationVersion":1}' where id=d;
 r:=studio.studio_enqueue_knowledge_outline(w,'substo','route-owner',jsonb_build_object(
   'sourceId',src,'expectedVersion',1,'requestId',gen_random_uuid(),'mode','record_text','inputId','notes',
   'provider','location_order','curationVersion',1,'route',rt));
 if not exists(select 1 from studio.studio_idea_reviews o join studio.studio_jobs jb on jb.id=o.job_id
   where o.location_id=w and o.snapshot->>'inputId'=r->>'outlineId' and jb.route#>>'{actual,kind}'='device_codex') then
  raise exception 'Outline did not use the routed submission'; end if;
 update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp() where location_id=w and kind='studio.text_run' and status='queued';

 -- An uncertain run is never moved to the next step.
 update studio.studio_devices set report=report||'{"capacity":{"codex":true,"claude":true}}' where id=d;
 cmd:=jsonb_set(cmd,'{requestId}',to_jsonb(gen_random_uuid()));
 r:=studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',cmd);
 claim:=studio.studio_text_device_command(repeat('7c',32),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',r->>'jobId','leaseToken',claim->0->>'lease_token');
 res:=studio.studio_text_device_command(repeat('7c',32),'substo','fail',body||'{"failure":{"code":"timeout","message":"Uncertain","retryable":true}}');
 select * into j from studio.studio_jobs where id=(r->>'jobId')::uuid;
 if res<>'"failed"' or j.status<>'failed' or j.last_error_code<>'text_execution_uncertain' or j.payload->>'provider'<>'codex' then raise exception 'Uncertain run rerouted % %',res,j.status; end if;
 begin update studio.studio_jobs set status='queued' where id=j.id; raise exception 'Replay fence bypassed'; exception when sqlstate '40001' then null; end;

 -- The explicit single-provider path is unchanged and records requested = actual.
 cmd:=(cmd-'route')||jsonb_build_object('requestId',gen_random_uuid(),'provider','subscription','confirmSubscription',true);
 r:=studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',cmd);
 if (select route from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'{"actual":{"kind":"device_codex","model":null},"requested":{"kind":"device_codex","model":null}}' then raise exception 'Explicit route not recorded'; end if;
 -- Malformed routes are refused.
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',jsonb_set(cmd,'{route}','{"candidates":[{"kind":"device_codex"},{"kind":"device_codex"}]}'));
  raise exception 'Duplicate candidate accepted'; exception when sqlstate '22023' then null; end;
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','route-owner','idea_review',jsonb_set(cmd,'{route}','{"candidates":[{"kind":"gemini_key"}]}'));
  raise exception 'Unsupported Studio provider accepted'; exception when sqlstate '22023' then null; end;
 raise notice 'AI route chain assertions passed';
end $$;
