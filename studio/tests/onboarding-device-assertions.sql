DO $$
declare w text:='research-test'; d uuid:=gen_random_uuid(); d2 uuid:=gen_random_uuid(); j jsonb; claim jsonb; body jsonb; k text[]; n int; r uuid:=gen_random_uuid();
 ok_result jsonb:=jsonb_build_object('research',jsonb_build_object('businessName','Acme','fields','[]'::jsonb),'provider','claude','model','native-default');
 pl jsonb:='{"batch":"b1","topic":"business","actorId":null,"app":"substo","input":{"name":"Acme"},"pages":[]}';
begin
 perform studio.studio_create_substo_location(w,'Research','research-owner');
 insert into studio.studio_devices(id,location_id,app,name,token_hash,request_id,created_by,processing_enabled,desired_config)
  values(d,w,'substo','Mac',repeat('c',64),gen_random_uuid(),'research-owner',true,'{"features":{"text":true}}');
 insert into studio.studio_devices(id,location_id,app,name,token_hash,request_id,created_by) values(d2,w,'substo','Off',repeat('d',64),gen_random_uuid(),'research-owner');
 select allowed_kinds into k from studio.studio_devices where id=d;
 if not ('studio.onboarding_research'=any(k) and 'studio.library_summary'=any(k)) then raise exception 'Processing opt-in did not grant kinds %',k; end if;
 if (select allowed_kinds from studio.studio_devices where id=d2)<>ARRAY['studio.diagnostic'] then raise exception 'Off device granted processing kinds'; end if;
 begin update studio.studio_devices set allowed_kinds=ARRAY['studio.script_brief'] where id=d2; raise exception 'Unknown kind accepted'; exception when sqlstate '23514' then null; end;
 begin perform studio.studio_enqueue_device_onboarding_research(w,d2,pl,'onboarding:b1:business:mac','research-owner'); raise exception 'Off device accepted research'; exception when sqlstate '42501' then null; end;

 j:=studio.studio_enqueue_device_onboarding_research(w,d,pl,'onboarding:b1:business:mac','research-owner');
 if studio.studio_enqueue_device_onboarding_research(w,d,pl,'onboarding:b1:business:mac','research-owner')->>'jobId'<>j->>'jobId' then raise exception 'Enqueue not idempotent'; end if;
 if (select execution_target from studio.studio_jobs where id=(j->>'jobId')::uuid)<>'device' then raise exception 'Research not bound to the device'; end if;
 if exists(select 1 from studio.studio_claim_jobs('hosted',10,60) x where x.id=(j->>'jobId')::uuid) then raise exception 'Hosted worker claimed device research'; end if;
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}')<>'[]' then raise exception 'Claimed without local readiness'; end if;
 claim:=studio.studio_onboarding_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}');
 if jsonb_array_length(claim)<>1 or claim->0->>'kind'<>'studio.onboarding_research' then raise exception 'Research claim %',claim; end if;
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token','leaseSeconds',60);
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','extend',body)<>'true' then raise exception 'Extend failed'; end if;
 begin perform studio.studio_onboarding_device_command(repeat('c',64),'substo','complete',body || '{"result":{"research":{},"provider":"openai","model":"native-default"}}'); raise exception 'Unknown provider accepted'; exception when sqlstate '22023' then null; end;
 begin perform studio.studio_onboarding_device_command(repeat('c',64),'substo','complete',body || '{"result":{"research":{},"provider":"codex","model":"native-default","raw":"x"}}'); raise exception 'Extra result key accepted'; exception when sqlstate '22023' then null; end;
 begin perform studio.studio_onboarding_device_command(repeat('d',64),'substo','complete',body || jsonb_build_object('result',ok_result)); raise exception 'Other device completed research'; exception when sqlstate '42501' then null; end;
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','complete',jsonb_set(body,'{leaseToken}',to_jsonb(gen_random_uuid())) || jsonb_build_object('result',ok_result))<>'false' then raise exception 'Lease bypass'; end if;
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','complete',body || jsonb_build_object('result',ok_result))<>'true' then raise exception 'Completion failed'; end if;
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','complete',body || jsonb_build_object('result',ok_result))<>'false' then raise exception 'Completion replay'; end if;
 select count(*) into n from studio.studio_jobs where location_id=w and kind='studio.onboarding_apply' and execution_target='hosted' and payload->>'status'='succeeded'
  and payload#>>'{result,research,businessName}'='Acme' and payload->>'topic'='business' and payload->>'jobId'=claim->0->>'id';
 if n<>1 then raise exception 'Apply job missing for completion'; end if;

 -- Capacity waits keep their attempt; a final failure is handed to the apply job too.
 j:=studio.studio_enqueue_device_onboarding_research(w,d,pl || '{"topic":"contact"}','onboarding:b1:contact:mac','research-owner');
 claim:=studio.studio_onboarding_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','fail',body || '{"failure":{"code":"subscription_capacity","message":"Waiting","retryable":true,"retryAfterSeconds":1}}')<>'"retry_scheduled"' then raise exception 'Capacity wait not retried'; end if;
 if (select attempts from studio.studio_jobs where id=(j->>'jobId')::uuid)<>0 then raise exception 'Capacity wait used an attempt'; end if;
 update studio.studio_jobs set run_after=clock_timestamp()-interval '1 second' where id=(j->>'jobId')::uuid;
 claim:=studio.studio_onboarding_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','fail',body || '{"failure":{"code":"research_invalid","message":"No valid reply","retryable":false}}')<>'"failed"' then raise exception 'Final failure'; end if;
 if not exists(select 1 from studio.studio_jobs where location_id=w and kind='studio.onboarding_apply' and payload->>'jobId'=j->>'jobId' and payload->>'status'='failed' and payload->>'error'='No valid reply') then raise exception 'Apply job missing for failure'; end if;

 -- Turning processing off withdraws the grant and releases queued research to the apply job.
 j:=studio.studio_enqueue_device_onboarding_research(w,d,pl || '{"topic":"online"}','onboarding:b1:online:mac','research-owner');
 perform studio.studio_manage_device(w,'substo','research-owner','set_processing',null,d,null,null,'false'::jsonb);
 if (select allowed_kinds from studio.studio_devices where id=d)<>ARRAY['studio.diagnostic'] then raise exception 'Processing off kept kinds'; end if;
 if (select status from studio.studio_jobs where id=(j->>'jobId')::uuid)<>'cancelled' then raise exception 'Queued research kept waiting'; end if;
 if not exists(select 1 from studio.studio_jobs where location_id=w and kind='studio.onboarding_apply' and payload->>'jobId'=j->>'jobId' and payload->>'status'='cancelled') then raise exception 'Cancelled research not reported'; end if;
 perform studio.studio_manage_device(w,'substo','research-owner','set_processing',null,d,null,null,'true'::jsonb);
 if not exists(select 1 from studio.studio_devices where id=d and 'studio.onboarding_research'=any(allowed_kinds)) then raise exception 'Processing on did not re-grant'; end if;

 -- Library summaries also need their grant.
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,r,'reference','Source','{"description":"evidence"}');
 perform studio.studio_request_library_summary(w,'substo','research-owner',r);
 update studio.studio_devices set allowed_kinds=ARRAY['studio.diagnostic'] where id=d;
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"summaryReady":true,"researchReady":true}')<>'[]' then raise exception 'Summary claimed without grant'; end if;
 update studio.studio_devices set allowed_kinds=ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research'] where id=d;
 claim:=studio.studio_onboarding_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"summaryReady":true,"researchReady":true}');
 if claim->0->>'kind'<>'studio.library_summary' then raise exception 'Library summary not delegated %',claim; end if;

 -- Paused, revoked and cross-realm devices never claim research.
 j:=studio.studio_enqueue_device_onboarding_research(w,d,pl || '{"topic":"offer"}','onboarding:b1:offer:mac','research-owner');
 update studio.studio_devices set paused=true where id=d;
 if studio.studio_onboarding_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}')<>'[]' then raise exception 'Paused device claimed'; end if;
 update studio.studio_devices set paused=false where id=d;
 begin perform studio.studio_onboarding_device_command(repeat('c',64),'estio','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}'); raise exception 'Cross realm accepted'; exception when sqlstate '42501' then null; end;
 perform studio.studio_manage_device(w,'substo','research-owner','revoke',null,d);
 if (select status from studio.studio_jobs where id=(j->>'jobId')::uuid)<>'cancelled' then raise exception 'Revoked device kept research'; end if;
 begin perform studio.studio_onboarding_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}'); raise exception 'Revoked accepted'; exception when sqlstate '42501' then null; end;
end $$;
