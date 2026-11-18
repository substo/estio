create table public.settings_documents(scope_type text,scope_id text,domain text,payload jsonb);
create table public.settings_secrets(scope_type text,scope_id text,domain text,secret_key text);
-- Real SQL against an isolated local cluster; no credentials or providers.
create function pg_temp.pair_text_device(w text,actor text,code text,hash text) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,desired_config='{"features":{"text":true},"textProvider":"codex","textModel":null}',config_version=2,applied_config_version=2,config_status='applied',seen_at=clock_timestamp(),report='{"handlers":["studio.text_run"],"codex":{"ready":true,"authenticated":true,"loginMethod":"chatgpt"},"capacity":{"codex":true}}' where id=d;
 return d;
end $$;
do $$
declare w text:='ac000000-0000-4000-8000-000000000001'; w2 text:='ac000000-0000-4000-8000-000000000002';
 idea uuid:=gen_random_uuid(); src uuid:=gen_random_uuid(); d uuid; d2 uuid; r jsonb; again jsonb; cmd jsonb; body jsonb; claim jsonb; output jsonb; j uuid; run uuid; a uuid; u uuid; req uuid:=gen_random_uuid();
begin
 perform studio.studio_create_substo_location(w,'AI routing','text-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','text-other');
 d:=pg_temp.pair_text_device(w,'text-owner','TEXTAAAA',repeat('a',64));
 d2:=pg_temp.pair_text_device(w2,'text-other','TEXTBBBB',repeat('b',64));
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,idea,'content','Idea','{"stage":"idea","notes":"Saved notes"}'),(w,src,'reference','Source','{"notes":"Exact saved evidence.","transcript":"Exact saved evidence."}');
 insert into studio.studio_record_links values(w,idea,src);
 cmd:=jsonb_build_object('requestId',req,'ideas',jsonb_build_array(jsonb_build_object('id',idea,'version',1)),'focus','','provider','subscription','confirmSubscription',true);
 begin perform studio.studio_enqueue_routed_text_run(w,'estio','text-owner','idea_review',cmd);raise exception 'Cross app accepted';exception when sqlstate '42501' then null;end;
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','text-other','idea_review',cmd);raise exception 'Cross tenant accepted';exception when sqlstate '42501' then null;end;
 update studio.studio_devices set created_by='text-teammate' where id=d;
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','text-owner','idea_review',cmd);raise exception 'Teammate subscription borrowed';exception when sqlstate '22023' then null;end;
 update studio.studio_devices set created_by='text-owner',applied_config_version=1 where id=d;
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','text-owner','idea_review',cmd);raise exception 'Pending settings accepted';exception when sqlstate '22023' then null;end;
 update studio.studio_devices set applied_config_version=2 where id=d;
 r:=studio.studio_enqueue_routed_text_run(w,'substo','text-owner','idea_review',cmd);j:=(r->>'jobId')::uuid;run:=(r->>'reviewId')::uuid;
 if studio.studio_enqueue_routed_text_run(w,'substo','text-owner','idea_review',cmd)<>r then raise exception 'Duplicate enqueue';end if;
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','text-owner','idea_review',cmd||'{"provider":"openai","confirmPaid":true}');raise exception 'Provider changed on replay';exception when unique_violation then null;end;
 if (select execution_target from studio.studio_jobs where id=j)<>'device' or exists(select 1 from studio.studio_ai_usage where location_id=w) then raise exception 'Subscription routed/billed as API';end if;
 perform studio.studio_claim_jobs('hosted',50,60);
 if (select status from studio.studio_jobs where id=j)<>'queued' then raise exception 'Hosted claimed subscription';end if;
 claim:=studio.studio_text_device_command(repeat('b',64),'substo','claim','{"workerId":"mac2","limit":1,"leaseSeconds":60,"textReady":true}');
 if claim<>'[]' then raise exception 'Cross account claim';end if;
 claim:=studio.studio_text_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 if claim->0->>'id'<>j::text then raise exception 'No text claim %',claim;end if;
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 output:=jsonb_build_object('recommendation',idea,'reason','Useful','verificationGap','Check facts','scores',jsonb_build_array(jsonb_build_object('ideaId',idea,'relevance',4,'evidence',4,'timeliness',4,'differentiation',4,'ease',4,'rationale','Saved evidence','sourceIds',jsonb_build_array(src))));
 begin perform studio.studio_text_device_command(repeat('b',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('output',output,'provider','codex','model','native-default')));raise exception 'Cross account completion';exception when sqlstate '42501' then null;end;
 begin perform studio.studio_text_device_command(repeat('a',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('output',output,'provider','claude','model','native-default')));raise exception 'Provider mismatch accepted';exception when sqlstate '22023' then null;end;
 update studio.studio_records set version=2 where id=src;
 if studio.studio_text_device_command(repeat('a',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('output',output,'provider','codex','model','native-default')))<>'true' then raise exception 'Completion failed';end if;
 if not (select stale_at_completion from studio.studio_idea_reviews where id=run) then raise exception 'Stale result current';end if;
 if exists(select 1 from studio.studio_ai_attempts where job_id=j) or exists(select 1 from studio.studio_ai_usage where location_id=w) then raise exception 'Subscription metering hold';end if;
 -- Script and extraction follow their original validators and separate application paths.
 cmd:=jsonb_set(cmd,'{requestId}',to_jsonb(gen_random_uuid()));r:=studio.studio_enqueue_routed_text_run(w,'substo','text-owner','script_brief',cmd);
 if (select payload->>'promptVersion' from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'studio.script-brief.v2' then raise exception 'Wrong prompt version';end if;
 update studio.studio_devices set config_version=3 where id=d;
 perform studio.studio_text_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 if (select status from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'cancelled' then raise exception 'Changed settings ran';end if;
 update studio.studio_devices set config_version=2 where id=d;
 cmd:=jsonb_set(cmd,'{requestId}',to_jsonb(gen_random_uuid()));r:=studio.studio_enqueue_routed_text_run(w,'substo','text-owner','script_brief',cmd);j:=(r->>'jobId')::uuid;run:=(r->>'reviewId')::uuid;
 claim:=studio.studio_text_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 output:=jsonb_build_object('audiencePromise','Useful evidence','angle','An original angle','hook','Start here','outline',jsonb_build_array('Problem','Method'),'claims',jsonb_build_array(jsonb_build_object('claim','A source assertion','sourceIds',jsonb_build_array(src),'verificationNeeded',true)),'verificationGaps',jsonb_build_array('Check assertion'),'script','A complete draft [VERIFY assertion].');
 perform studio.studio_text_device_command(repeat('a',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('output',output,'provider','codex','model','native-default')));
 if (select payload->>'script' from studio.studio_records where id=idea) is not null then raise exception 'Brief auto-applied';end if;
 perform studio.studio_apply_script_brief(w,'substo','text-owner',run,gen_random_uuid(),1,true);
 if (select payload->>'script' from studio.studio_records where id=idea) is distinct from output->>'script' then raise exception 'Explicit script apply failed';end if;

 cmd:=jsonb_build_object('requestId',gen_random_uuid(),'sourceId',src,'expectedVersion',2,'mode','record_text','inputId','transcript','startUnit',0,'unitCount',1,'focus','','provider','subscription','confirmSubscription',true);
 r:=studio.studio_enqueue_routed_text_run(w,'substo','text-owner','knowledge_extract',cmd);j:=(r->>'jobId')::uuid;
 claim:=studio.studio_text_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 begin perform studio.studio_text_device_command(repeat('a',64),'substo','complete',body||'{"result":{"provider":"codex","model":"native-default","output":{"findings":[{"kind":"claim","unitId":"madeup","statement":"Made up","suggestedTopic":"Test","quote":"not evidence"}]}}}');raise exception 'Invented quote accepted';exception when sqlstate '22023' then null;end;
 perform studio.studio_text_device_command(repeat('a',64),'substo','fail',body||'{"failure":{"code":"timeout","message":"Uncertain","retryable":true}}');
 begin perform studio.studio_member_job_action(w,'substo','text-owner',j,'retry');raise exception 'Uncertain retry accepted';exception when sqlstate '40001' then null;end;
 begin perform studio.studio_member_job_action(w,'substo','text-owner',j,'retry');raise exception 'Second uncertain retry accepted';exception when sqlstate '40001' then null;end;
 if (select status from studio.studio_jobs where id=j)<>'failed' then raise exception 'Uncertain job replayed';end if;
 -- Complete another extraction through the same SQL validator, then explicitly apply as pending knowledge.
 cmd:=jsonb_set(cmd,'{requestId}',to_jsonb(gen_random_uuid()));r:=studio.studio_enqueue_routed_text_run(w,'substo','text-owner','knowledge_extract',cmd);j:=(r->>'jobId')::uuid;run:=(r->>'reviewId')::uuid;
 claim:=studio.studio_text_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"textReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 output:=jsonb_build_object('findings',jsonb_build_array(jsonb_build_object('kind','claim','unitId',claim#>>'{0,payload,snapshot,units,0,id}','statement','The source asserts this evidence.','suggestedTopic','Evidence','quote','Exact saved evidence.')));
 perform studio.studio_text_device_command(repeat('a',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('output',output,'provider','codex','model','native-default')));
 if exists(select 1 from studio.studio_knowledge_extraction_findings where review_id=run) then raise exception 'Extraction auto-applied';end if;
 perform studio.studio_apply_knowledge_extraction(w,'substo','text-owner',run,gen_random_uuid(),2,'[0]',true);
 if not exists(select 1 from studio.studio_knowledge_extraction_findings where review_id=run) then raise exception 'Pending knowledge apply failed';end if;
 -- Explicit API route remains hosted; subscription consent cannot authorize spend.
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','text-owner','knowledge_extract',cmd||jsonb_build_object('requestId',gen_random_uuid(),'provider','openai'));raise exception 'API spend consent missing';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_enqueue_routed_text_run(w,'substo','text-owner','knowledge_extract',cmd||jsonb_build_object('requestId',gen_random_uuid(),'provider','openai','confirmPaid',true));raise exception 'Missing API key queued';exception when sqlstate '22023' then null;end;
 insert into public.settings_secrets values('LOCATION',w,'location.ai','openai_api_key');
 perform studio.studio_set_ai_budget(w,'substo','text-owner',1000000);
 r:=studio.studio_enqueue_routed_text_run(w,'substo','text-owner','knowledge_extract',cmd||jsonb_build_object('requestId',gen_random_uuid(),'provider','openai','confirmPaid',true));
 if (select execution_target from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'hosted' then raise exception 'API route changed';end if;
 j:=(r->>'jobId')::uuid;run:=(r->>'reviewId')::uuid;
 perform studio.studio_claim_jobs('api-worker',50,60);
 select jsonb_build_object('leaseToken',lease_token) into body from studio.studio_jobs where id=j;
 a:=(studio.studio_begin_text_run_attempt(w,run,j,'api-worker',(body->>'leaseToken')::uuid)->>'attempt_id')::uuid;
 select usage_id into u from studio.studio_ai_attempts where id=a;
 if (select status from studio.studio_ai_usage where id=u)<>'reserved' then raise exception 'API hold missing';end if;
 perform studio.studio_finish_text_run_attempt(w,run,j,'api-worker',(body->>'leaseToken')::uuid,a,'{"findings":[]}',100,100,'test-response','gpt-6-luna-standard-2026-10-23');
 if (select status from studio.studio_ai_usage where id=u)<>'settled' then raise exception 'API settlement missing';end if;

 if has_function_privilege('anon','studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','studio.studio_text_device_command(text,text,text,jsonb,text)','EXECUTE') then raise exception 'Unsafe grants';end if;
end $$;
