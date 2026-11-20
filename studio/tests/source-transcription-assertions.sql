DO $$
declare w text:='transcribe-test'; d uuid:=gen_random_uuid(); d2 uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); r3 uuid:=gen_random_uuid(); r4 uuid:=gen_random_uuid();
 req jsonb; claim jsonb; body jsonb; n int; p jsonb; pb jsonb; big text;
 ok jsonb:='{"source":{"decision":"transcribed","method":"local-parakeet-tdt-v3","text":"hello world transcript","timedText":"0.0 hello world transcript","visualNotes":"[3s] On screen (OCR): Slide","durationSeconds":42,"language":"en"},"provider":"mac_local","model":"native-default"}';
 cmd text:='studio.studio_transcribe_device_command';
begin
 perform studio.studio_create_substo_location(w,'Transcribe','tr-owner');
 insert into studio.studio_devices(id,location_id,app,name,token_hash,request_id,created_by,processing_enabled,desired_config,config_version,applied_config_version,config_status)
  values(d,w,'substo','Mac',repeat('e',64),gen_random_uuid(),'tr-owner',true,'{"features":{"transcription":true,"text":true}}',1,1,'applied');
 insert into studio.studio_devices(id,location_id,app,name,token_hash,request_id,created_by) values(d2,w,'substo','Off',repeat('f',64),gen_random_uuid(),'tr-owner');
 if not exists(select 1 from studio.studio_devices where id=d and 'studio.source_transcribe'=any(allowed_kinds)) then raise exception 'Processing opt-in did not grant the kind'; end if;
 if (select allowed_kinds from studio.studio_devices where id=d2)<>ARRAY['studio.diagnostic'] then raise exception 'Off device granted'; end if;

 insert into studio.studio_records(location_id,id,kind,title,payload) values
  (w,r,'reference','Pasted','{"url":"https://youtu.be/9DBJXRy5dvk","description":"d"}'),
  (w,r2,'reference','Not video','{"url":"https://example.com/x"}'),
  (w,r3,'reference','Human text','{"url":"https://youtu.be/AAAAAAAAAAA","transcript":"typed by a person"}'),
  (w,r4,'reference','Approved one','{"url":"https://youtu.be/BBBBBBBBBBB","approved":true,"aiSummary":"about thumbnails"}');
 if studio.studio_request_source_transcription(w,'substo','tr-owner',r2)->>'status'<>'unsupported' then raise exception 'Non-video accepted'; end if;
 begin perform studio.studio_request_source_transcription(w,'substo','intruder',r); raise exception 'Non member requested'; exception when others then if sqlerrm like 'Non member%' then raise; end if; end;

 req:=studio.studio_request_source_transcription(w,'substo','tr-owner',r);
 if req->>'status'<>'queued' then raise exception 'Not queued %',req; end if;
 if studio.studio_request_source_transcription(w,'substo','tr-owner',r)->>'jobId'<>req->>'jobId' then raise exception 'Request not idempotent'; end if;
 if (select execution_target from studio.studio_jobs where id=(req->>'jobId')::uuid)<>'device' then raise exception 'Not device bound'; end if;
 if exists(select 1 from studio.studio_claim_jobs('hosted',10,60) x where x.id=(req->>'jobId')::uuid) then raise exception 'Hosted worker claimed it'; end if;
 if (select payload->>'transcriptionStatus' from studio.studio_records where id=r)<>'queued' then raise exception 'Status not queued'; end if;

 -- Needs the owner's opt-in, local readiness and an applied config.
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}')<>'[]' then raise exception 'Claimed without readiness'; end if;
 update studio.studio_devices set desired_config='{"features":{"transcription":false}}' where id=d;
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}')<>'[]' then raise exception 'Claimed with transcription off'; end if;
 update studio.studio_devices set desired_config='{"features":{"transcription":true,"text":true}}' where id=d;
 claim:=studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}');
 if jsonb_array_length(claim)<>1 or claim->0->>'kind'<>'studio.source_transcribe' then raise exception 'Claim %',claim; end if;
 if (select payload->>'transcriptionStatus' from studio.studio_records where id=r)<>'running' then raise exception 'Status not running'; end if;
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token','leaseSeconds',60);
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','extend',body)<>'true' then raise exception 'Extend failed'; end if;
 begin perform studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || '{"result":{"source":{"decision":"transcribed","method":"x","text":"t"},"provider":"mac_local","model":"native-default"}}'); raise exception 'Bad method accepted'; exception when sqlstate '22023' then null; end;
 begin perform studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || '{"result":{"source":{"decision":"transcribed","method":"local-parakeet-tdt-v3","text":" "},"provider":"mac_local","model":"native-default"}}'); raise exception 'Empty text accepted'; exception when sqlstate '22023' then null; end;
 begin perform studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || '{"result":{"source":{"decision":"transcribed","method":"local-parakeet-tdt-v3","text":"t","extra":1},"provider":"mac_local","model":"native-default"}}'); raise exception 'Extra key accepted'; exception when sqlstate '22023' then null; end;
 begin perform studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || '{"result":{"source":{"decision":"transcribed","method":"local-parakeet-tdt-v3","text":"t"},"provider":"openai","model":"native-default"}}'); raise exception 'Provider accepted'; exception when sqlstate '22023' then null; end;
 begin perform studio.studio_transcribe_device_command(repeat('f',64),'substo','complete',body || jsonb_build_object('result',ok)); raise exception 'Other device completed'; exception when sqlstate '42501' then null; end;
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',jsonb_set(body,'{leaseToken}',to_jsonb(gen_random_uuid())) || jsonb_build_object('result',ok))<>'false' then raise exception 'Lease bypass'; end if;
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || jsonb_build_object('result',ok))<>'true' then raise exception 'Completion failed'; end if;
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || jsonb_build_object('result',ok))<>'false' then raise exception 'Completion replay'; end if;
 select payload into p from studio.studio_records where id=r;
 if p->>'transcript'<>'hello world transcript' or p->>'transcriptionStatus'<>'ready' or p#>>'{transcriptSource,method}'<>'local-parakeet-tdt-v3' or p->>'visualNotes' not like '%Slide%' or p->>'timedTranscript' is null then raise exception 'Record not updated %',p; end if;
 if (select version from studio.studio_records where id=r)<>2 then raise exception 'Version not advanced'; end if;
 if not exists(select 1 from studio.studio_library_summary_requests where location_id=w and record_id=r) then raise exception 'Summary not requested for the new transcript'; end if;

 -- A large transcript passes (the 32 KiB limit applies to every other command).
 big:=repeat('word ',19000);
 req:=studio.studio_request_source_transcription(w,'substo','tr-owner',r);
 claim:=studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || jsonb_build_object('result',jsonb_build_object('source',jsonb_build_object('decision','transcribed','method','youtube-captions-fallback','text',big),'provider','mac_local','model','native-default')))<>'true' then raise exception 'Large completion failed'; end if;
 if length((select payload->>'transcript' from studio.studio_records where id=r))<>length(big) then raise exception 'Large transcript truncated'; end if;
 begin perform studio.studio_transcribe_device_command(repeat('e',64),'substo','extend',body || jsonb_build_object('pad',big)); raise exception 'Large non-complete command accepted'; exception when sqlstate '22023' then null; end;

 -- A typed transcript is never overwritten.
 perform studio.studio_request_source_transcription(w,'substo','tr-owner',r3);
 claim:=studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');
 perform studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || jsonb_build_object('result',ok));
 select payload into p from studio.studio_records where id=r3;
 if p->>'transcript'<>'typed by a person' or p->>'transcriptionStatus'<>'kept_existing' or p->>'machineTranscript' is null then raise exception 'Human transcript overwritten %',p; end if;

 -- Edited after a machine transcript: the person's words win on a retry too.
 update studio.studio_records set payload=payload || '{"transcript":"edited by a person"}' where id=r;
 perform studio.studio_request_source_transcription(w,'substo','tr-owner',r);
 claim:=studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');
 perform studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || jsonb_build_object('result',ok));
 if (select payload->>'transcript' from studio.studio_records where id=r)<>'edited by a person' then raise exception 'Edited transcript overwritten'; end if;

 -- Discovery runs carry the relevance context; low scores are skipped, borderline ones wait for the owner.
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,gen_random_uuid(),'reference','Found','{"url":"https://youtu.be/CCCCCCCCCCC","channelName":"Chan"}');
 req:=studio.studio_request_source_transcription(w,'substo','tr-owner',(select id from studio.studio_records where title='Found'),'discovery');
 claim:=studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}');
 if claim->0#>>'{payload,trigger}'<>'discovery' or jsonb_array_length(claim->0#>'{payload,gate,approved}')<>1 or claim->0#>>'{payload,gate,approved,0,title}'<>'Approved one' then raise exception 'Gate context missing %',claim; end if;
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');
 perform studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || '{"result":{"source":{"decision":"skipped","score":12,"reason":"Off topic"},"provider":"mac_local","model":"native-default"}}');
 select payload into p from studio.studio_records where title='Found';
 if p->>'transcriptionStatus'<>'skipped' or (p->>'relevanceScore')::int<>12 or p ? 'transcript' then raise exception 'Skip not recorded %',p; end if;
 req:=studio.studio_request_source_transcription(w,'substo','tr-owner',(select id from studio.studio_records where title='Found'),'discovery');
 claim:=studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');
 perform studio.studio_transcribe_device_command(repeat('e',64),'substo','complete',body || '{"result":{"source":{"decision":"needs_confirmation","score":55,"reason":"Unclear"},"provider":"mac_local","model":"native-default"}}');
 if (select payload->>'transcriptionStatus' from studio.studio_records where title='Found')<>'needs_confirmation' then raise exception 'Confirmation not recorded'; end if;
 -- Owner confirms: a user-trigger request runs the transcription directly.
 req:=studio.studio_request_source_transcription(w,'substo','tr-owner',(select id from studio.studio_records where title='Found'));
 if (select payload->>'trigger' from studio.studio_jobs where id=(req->>'jobId')::uuid)<>'user' or (select payload ? 'gate' from studio.studio_jobs where id=(req->>'jobId')::uuid) then raise exception 'Confirmation not direct'; end if;
 claim:=studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');

 -- Scheduled approved-channel discovery hands NEW finds to the Mac with the gate; other sources and reused videos are ignored.
 set session_replication_role=replica;
 alter table studio.studio_youtube_schedule_runs enable always trigger studio_youtube_source_discovery;
 insert into studio.studio_youtube_channels(location_id,channel_id,label,approved_by) values(w,'UCaaaaaaaaaaaaaaaaaaaaaa','Approved','tr-owner');
 insert into studio.studio_records(location_id,id,kind,title,payload) values
  (w,'00000000-0000-4000-8000-0000000000a1','reference','Ch · new1','{"url":"https://www.youtube.com/watch?v=DDDDDDDDDDD"}'),
  (w,'00000000-0000-4000-8000-0000000000a2','reference','Ch · new2','{"url":"https://www.youtube.com/watch?v=EEEEEEEEEEE"}'),
  (w,'00000000-0000-4000-8000-0000000000a3','reference','Srch · new3','{"url":"https://www.youtube.com/watch?v=FFFFFFFFFFF"}');
 insert into studio.studio_youtube_schedule_runs(location_id,schedule_id,activation_token,job_id,actor_app,created_by_clerk_user_id,manual,source_mode,channel_id,title_prefix)
  values(w,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'substo','tr-owner',false,'approved_channel','UCaaaaaaaaaaaaaaaaaaaaaa','Ch'),
        (w,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'substo','tr-owner',false,'search',null,'Srch');
 update studio.studio_youtube_schedule_runs set result='{"links":[{"videoId":"DDDDDDDDDDD","recordId":"00000000-0000-4000-8000-0000000000a1","reused":false},{"videoId":"EEEEEEEEEEE","recordId":"00000000-0000-4000-8000-0000000000a2","reused":true}]}' where source_mode='approved_channel';
 update studio.studio_youtube_schedule_runs set result='{"links":[{"videoId":"FFFFFFFFFFF","recordId":"00000000-0000-4000-8000-0000000000a3","reused":false}]}' where source_mode='search';
 set session_replication_role=origin;
 if not exists(select 1 from studio.studio_jobs where kind='studio.source_transcribe' and payload->>'recordId'='00000000-0000-4000-8000-0000000000a1' and payload->>'trigger'='discovery' and payload ? 'gate') then raise exception 'Approved-channel find not queued with the gate'; end if;
 if exists(select 1 from studio.studio_jobs where kind='studio.source_transcribe' and payload->>'recordId' in ('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3')) then raise exception 'Reused or search find transcribed automatically'; end if;
 -- Drain it so the later claims in this script stay deterministic.
 delete from studio.studio_jobs where kind='studio.source_transcribe' and payload->>'recordId'='00000000-0000-4000-8000-0000000000a1';

 -- Waits before downloading retry without using an attempt; execution failures are terminal and visible.
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','fail',body || '{"failure":{"code":"transcription_tools_missing","message":"missing yt-dlp","retryable":true,"retryAfterSeconds":1}}')<>'"retry_scheduled"' then raise exception 'Tools wait not retried'; end if;
 if (select attempts from studio.studio_jobs where id=(claim->0->>'id')::uuid)<>0 then raise exception 'Wait used attempt'; end if;
 if (select payload->>'transcriptionStatus' from studio.studio_records where title='Found')<>'waiting_for_device' then raise exception 'Wait not shown'; end if;
 update studio.studio_jobs set run_after=clock_timestamp()-interval '1 second' where id=(claim->0->>'id')::uuid;
 claim:=studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',claim->0->>'id','leaseToken',claim->0->>'lease_token');
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','fail',body || '{"failure":{"code":"no_transcript_available","message":"No captions","retryable":false}}')<>'"failed"' then raise exception 'Final failure'; end if;
 if (select payload->>'transcriptionStatus' from studio.studio_records where title='Found')<>'failed' then raise exception 'Failure not shown'; end if;

 -- One transcription at a time per Mac.
 req:=studio.studio_request_source_transcription(w,'substo','tr-owner',r4);
 insert into studio.studio_jobs(location_id,kind,payload,execution_target,device_id,created_by_clerk_user_id,status,lease_owner,lease_token,lease_expires_at,attempts)
  values(w,'studio.diagnostic','{}','device',d,'tr-owner','running','mac',gen_random_uuid(),clock_timestamp()+interval '1 minute',1);
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac2","limit":1,"leaseSeconds":60,"transcribeReady":true}')<>'[]' then raise exception 'Parallel claim'; end if;
 delete from studio.studio_jobs where kind='studio.diagnostic' and device_id=d;

 -- Paused, off and revoked devices never claim; turning processing off releases queued work visibly.
 update studio.studio_devices set paused=true where id=d;
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}')<>'[]' then raise exception 'Paused claimed'; end if;
 update studio.studio_devices set paused=false where id=d;
 perform studio.studio_manage_device(w,'substo','tr-owner','set_processing',null,d,null,null,'false'::jsonb);
 if (select status from studio.studio_jobs where id=(req->>'jobId')::uuid)<>'cancelled' or (select payload->>'transcriptionStatus' from studio.studio_records where id=r4)<>'no_device' then raise exception 'Queued transcription kept waiting'; end if;
 if studio.studio_request_source_transcription(w,'substo','tr-owner',r4)->>'status'<>'no_device' then raise exception 'Requested with no eligible Mac'; end if;
 -- Other kinds still flow through the wrapper chain.
 perform studio.studio_manage_device(w,'substo','tr-owner','set_processing',null,d,null,null,'true'::jsonb);
 begin perform studio.studio_transcribe_device_command(repeat('e',64),'estio','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"transcribeReady":true}'); raise exception 'Cross realm accepted'; exception when sqlstate '42501' then null; end;
 if studio.studio_transcribe_device_command(repeat('e',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}') is null then raise exception 'Wrapper chain broken'; end if;
end $$;
