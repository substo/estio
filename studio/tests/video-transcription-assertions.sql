create table if not exists public.settings_documents(scope_type text,scope_id text,domain text,payload jsonb);
create table if not exists public.settings_secrets(scope_type text,scope_id text,domain text,secret_key text);
-- Real SQL against an isolated PostgreSQL cluster. No credentials, network or providers.
create function pg_temp.pair_video_device(w text,actor text,code text,hash text,transcription boolean default true,ready boolean default true) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,
  desired_config=jsonb_build_object('features',jsonb_build_object('text',true,'transcription',transcription),'textProvider','codex','textModel',null),
  config_version=2,applied_config_version=2,config_status='applied',seen_at=clock_timestamp(),
  report=jsonb_build_object('handlers',jsonb_build_array('studio.video_transcribe','studio.text_run'),'video',jsonb_build_object('ready',ready),
   'codex',jsonb_build_object('ready',true,'authenticated',true,'loginMethod','chatgpt'),'capacity',jsonb_build_object('codex',true)) where id=d;
 return d;
end $$;
create function pg_temp.vt(w text,actor text,rec uuid,origin text,k text) returns jsonb language sql as $$
 select studio.studio_enqueue_video_transcription(w,'substo',actor,jsonb_build_object('requestKey',k,'recordId',rec,'origin',origin))
$$;
create function pg_temp.claim(hash text,worker text default 'mac') returns jsonb language sql as $$
 select studio.studio_video_device_command(hash,'substo','claim',jsonb_build_object('workerId',worker,'limit',1,'leaseSeconds',120,'videoReady',true))
$$;
create function pg_temp.segs(n int,base numeric default 0) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('start',base+i*5,'end',base+i*5+4.5,'text','Sentence number '||i||'.')) from generate_series(0,n-1) i
$$;

do $$
declare w text:='ad000000-0000-4000-8000-000000000001'; w2 text:='ad000000-0000-4000-8000-000000000002';
 d uuid; d2 uuid; ra uuid:=gen_random_uuid(); rb uuid:=gen_random_uuid(); rbad uuid:=gen_random_uuid(); rhuman uuid:=gen_random_uuid();
 r jsonb; again jsonb; claim jsonb; body jsonb; j uuid; t uuid; v jsonb; ver bigint; rows int; tx studio.studio_video_transcriptions%rowtype;
 sha text:=repeat('a',64); sha2 text:=repeat('b',64); frames jsonb; before_payload jsonb;
begin
 perform studio.studio_create_substo_location(w,'Video fixture','vt-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','vt-other');
 insert into studio.studio_location_members(location_id,location_app,clerk_user_id,role) values(w,'substo','vt-member','member') on conflict do nothing;
 d:=pg_temp.pair_video_device(w,'vt-owner','TVTAAAAA',repeat('1',64));
 d2:=pg_temp.pair_video_device(w2,'vt-other','TVTBBBBB',repeat('2',64));
 -- Grants and table safety.
 if not exists(select 1 from studio.studio_devices where id=d and 'studio.video_transcribe'=any(allowed_kinds)) then raise exception 'Processing On did not grant video work'; end if;
 if has_table_privilege('service_role','studio.studio_video_transcriptions','INSERT') or has_table_privilege('service_role','studio.studio_video_frames','UPDATE')
  or has_table_privilege('authenticated','studio.studio_video_frames','SELECT') or has_table_privilege('anon','studio.studio_video_transcriptions','SELECT')
  or has_function_privilege('authenticated','studio.studio_video_device_command(text,text,text,jsonb,text,jsonb)','EXECUTE')
  or has_function_privilege('service_role','studio.studio_video_enqueue_core(text,text,text,uuid,text,text,jsonb,boolean)','EXECUTE') then raise exception 'Unsafe video grants'; end if;
 insert into studio.studio_records(location_id,id,kind,title,payload) values
  (w,ra,'reference','Talk A','{"url":"https://www.youtube.com/watch?v=aaaaaaaaaaa","platform":"YouTube","description":"Intro"}'),
  (w,rb,'reference','Talk B','{"url":"https://www.youtube.com/watch?v=bbbbbbbbbbb","platform":"YouTube"}'),
  (w,rbad,'reference','Article','{"url":"https://example.com/post"}'),
  (w,rhuman,'reference','Human','{"url":"https://www.youtube.com/watch?v=hhhhhhhhhhh","transcript":"Human typed transcript."}');

 -- Authority: same app, location, Account; explicit origins only; canonical YouTube sources only.
 begin perform studio.studio_enqueue_video_transcription(w,'estio','vt-owner',jsonb_build_object('requestKey','k0','recordId',ra,'origin','paste'));raise exception 'Cross app accepted';exception when sqlstate '42501' then null;end;
 begin perform pg_temp.vt(w,'vt-other',ra,'paste','k0');raise exception 'Cross tenant accepted';exception when sqlstate '42501' then null;end;
 begin perform pg_temp.vt(w,'vt-owner',ra,'approved_channel','k0');raise exception 'User bypassed the relevance gate';exception when sqlstate '22023' then null;end;
 begin perform pg_temp.vt(w,'vt-owner',rbad,'paste','k0');raise exception 'Non-YouTube source accepted';exception when sqlstate '22023' then null;end;
 begin perform pg_temp.vt(w,'vt-owner',gen_random_uuid(),'paste','k0');raise exception 'Missing record accepted';exception when sqlstate '22023' then null;end;
 -- A teammate's Mac is never borrowed (and a member without AI-manager authority cannot enqueue Mac work).
 begin perform pg_temp.vt(w,'vt-member',ra,'paste','k0');raise exception 'Member without Mac authority enqueued';exception when sqlstate '42501' then null;end;
 update studio.studio_devices set created_by='vt-teammate' where id=d;
 begin perform pg_temp.vt(w,'vt-owner',ra,'paste','k0');raise exception 'Teammate Mac borrowed';exception when sqlstate 'VT001' then null;end;
 update studio.studio_devices set created_by='vt-owner',desired_config=jsonb_set(desired_config,'{features,transcription}','false') where id=d;
 begin perform pg_temp.vt(w,'vt-owner',ra,'paste','k0');raise exception 'Transcription off accepted';exception when sqlstate 'VT002' then null;end;
 update studio.studio_devices set desired_config=jsonb_set(desired_config,'{features,transcription}','true'),report=jsonb_set(report,'{video,ready}','false') where id=d;
 begin perform pg_temp.vt(w,'vt-owner',ra,'paste','k0');raise exception 'Missing tools accepted';exception when sqlstate 'VT003' then null;end;
 update studio.studio_devices set report=jsonb_set(report,'{video,ready}','true')-'handlers'||'{"handlers":["studio.text_run"]}' where id=d;
 begin perform pg_temp.vt(w,'vt-owner',ra,'paste','k0');raise exception 'Outdated companion accepted';exception when sqlstate 'VT004' then null;end;
 update studio.studio_devices set report=report||'{"handlers":["studio.video_transcribe"]}' where id=d;
 if exists(select 1 from studio.studio_video_transcriptions where location_id=w) or exists(select 1 from studio.studio_jobs where location_id=w and kind='studio.video_transcribe') then raise exception 'Rejected admission left rows'; end if;

 -- Offline Mac: the job waits (no paid fallback, no hosted claim) and an idempotent replay returns the same job.
 update studio.studio_devices set seen_at=clock_timestamp()-interval '3 hours' where id=d;
 r:=pg_temp.vt(w,'vt-owner',ra,'paste','paste-1');t:=(r->>'transcriptionId')::uuid;j:=(r->>'jobId')::uuid;
 if r->>'status'<>'queued' or pg_temp.vt(w,'vt-owner',ra,'paste','paste-1')->>'transcriptionId'<>t::text then raise exception 'Enqueue/replay %',r; end if;
 begin perform pg_temp.vt(w,'vt-owner',rb,'paste','paste-1');raise exception 'Request key reused for another source';exception when unique_violation then null;end;
 if pg_temp.vt(w,'vt-owner',ra,'search','another-key')->>'transcriptionId'<>t::text then raise exception 'Duplicate active request created a second job'; end if;
 if (select execution_target from studio.studio_jobs where id=j)<>'device' or (select device_id from studio.studio_jobs where id=j)<>d or exists(select 1 from studio.studio_ai_usage where location_id=w) or exists(select 1 from studio.studio_ai_attempts where job_id=j) then raise exception 'Video routed to API or wrong Mac'; end if;
 perform studio.studio_claim_jobs('hosted',50,60);
 if (select status from studio.studio_jobs where id=j)<>'queued' then raise exception 'Hosted worker claimed a Mac job'; end if;
 if pg_temp.claim(repeat('2',64))<>'[]'::jsonb then raise exception 'Another account claimed the job'; end if;
 if (select status from studio.studio_video_transcriptions where id=t)<>'queued' then raise exception 'Offline job did not wait'; end if;
 claim:=studio.studio_video_device_command(repeat('1',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":120,"videoReady":false}');
 if claim<>'[]'::jsonb then raise exception 'Claimed while tools not ready locally'; end if;
 -- Reconnect: the same queued job is claimed.
 update studio.studio_devices set seen_at=clock_timestamp() where id=d;
 claim:=pg_temp.claim(repeat('1',64));
 if claim->0->>'id'<>j::text or (select status from studio.studio_video_transcriptions where id=t)<>'running' then raise exception 'Reconnect claim failed %',claim; end if;
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 if pg_temp.claim(repeat('1',64),'mac2')<>'[]'::jsonb then raise exception 'Two jobs ran on one Mac'; end if;

 -- Lease / version / identity fences on every writing operation.
 begin perform studio.studio_video_device_command(repeat('2',64),'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',0,'segments',pg_temp.segs(2)));raise exception 'Cross account chunk';exception when sqlstate '42501' or sqlstate '40001' then null;end;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','video_transcript_chunk',(body||jsonb_build_object('chunkIndex',0,'segments',pg_temp.segs(2)))||jsonb_build_object('leaseToken',gen_random_uuid()));raise exception 'Wrong lease chunk';exception when sqlstate '40001' then null;end;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',0,'segments','[{"start":9,"end":3,"text":"backwards"}]'::jsonb));raise exception 'Backwards segment';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',0,'segments',jsonb_build_array(jsonb_build_object('start',1,'end',2,'text',repeat('x',2001)))));raise exception 'Oversized segment';exception when sqlstate '22023' then null;end;
 -- A transcript chunk sequence that does not match the declared result is rejected atomically and changes nothing.
 perform studio.studio_video_device_command(repeat('1',64),'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',0,'segments',pg_temp.segs(3)));
 perform studio.studio_video_device_command(repeat('1',64),'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',1,'segments',pg_temp.segs(2,100)));
 select payload,version into before_payload,ver from studio.studio_records where id=ra;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','method','local-parakeet-tdt-v3-4bit','language','en','durationSeconds',200,
   'transcript',jsonb_build_object('chunks',3,'segments',5),'visual',jsonb_build_object('status','ready','frames',0))));raise exception 'Missing chunk accepted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','method','openai','durationSeconds',200,
   'transcript',jsonb_build_object('chunks',2,'segments',5),'visual',jsonb_build_object('status','ready','frames',0))));raise exception 'Unknown method accepted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','relevance',jsonb_build_object('relevant',true,'score',99,'reason','x','matches','[]'::jsonb),'method','local-parakeet-tdt-v3-4bit','durationSeconds',200,
   'transcript',jsonb_build_object('chunks',2,'segments',5),'visual',jsonb_build_object('status','ready','frames',0))));raise exception 'Relevance on ungated job accepted';exception when sqlstate '22023' then null;end;
 if (select payload from studio.studio_records where id=ra)<>before_payload or (select version from studio.studio_records where id=ra)<>ver or (select status from studio.studio_jobs where id=j)<>'running' or (select status from studio.studio_video_transcriptions where id=t)<>'running' then raise exception 'Rejected completion mutated state'; end if;

 -- Frames: reserve, byte-for-byte server verification, then a successful visual pass.
 frames:=jsonb_build_array(jsonb_build_object('index',0,'timeSeconds',12.5,'sceneStart',10,'sceneEnd',40,'ocr','Slide one: Pricing tiers','audioContext','…as shown here…','selection','settled-visual-change','sha256',sha,'byteSize',2048),
  jsonb_build_object('index',1,'timeSeconds',50,'sceneStart',41,'sceneEnd',90,'ocr','','audioContext','','selection','completed-slide-reveal','sha256',sha2,'byteSize',4096));
 v:=studio.studio_video_device_command(repeat('1',64),'substo','video_frames_reserve',body||jsonb_build_object('frames',frames));
 if jsonb_array_length(v)<>2 or v->0->>'objectKey'<>w||'/video-frames/'||t::text||'/0-'||sha||'.jpg' or v->0->>'status'<>'pending' then raise exception 'Frame reservation %',v; end if;
 begin perform studio.studio_video_device_command(repeat('2',64),'substo','video_frames_reserve',body||jsonb_build_object('frames',frames));raise exception 'Cross account frames';exception when sqlstate '42501' or sqlstate '40001' then null;end;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','video_frames_reserve',body||jsonb_build_object('frames',jsonb_build_array(jsonb_build_object('index',9,'timeSeconds',1,'sceneStart',0,'sceneEnd',2,'ocr','x','audioContext','','selection','Bad Name','sha256',sha,'byteSize',10))));raise exception 'Bad frame accepted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','video_frames_reserve',body||jsonb_build_object('frames',jsonb_build_array(jsonb_build_object('index',9,'timeSeconds',1,'sceneStart',0,'sceneEnd',2,'ocr','x','audioContext','','selection','ok','sha256',sha,'byteSize',99999999))));raise exception 'Oversized frame accepted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','video_frames_verify',body,null,jsonb_build_object('bucket','studio-private','frames',jsonb_build_array(jsonb_build_object('index',0,'sha256',sha2,'byteSize',2048))));raise exception 'Wrong digest verified';exception when sqlstate '22023' then null;end;
 -- Completion with frames still unverified is rejected for a 'ready' visual pass.
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','method','local-parakeet-tdt-v3-4bit','language','en','durationSeconds',200,
   'transcript',jsonb_build_object('chunks',2,'segments',5),'visual',jsonb_build_object('status','ready','frames',2))));raise exception 'Unverified frames accepted';exception when sqlstate '22023' then null;end;
 perform studio.studio_video_device_command(repeat('1',64),'substo','video_frames_verify',body,null,jsonb_build_object('bucket','studio-private','frames',jsonb_build_array(jsonb_build_object('index',0,'sha256',sha,'byteSize',2048),jsonb_build_object('index',1,'sha256',sha2,'byteSize',4096))));
 if (select count(*) from studio.studio_media_objects where location_id=w and object_key like '%/video-frames/%')<>2 then raise exception 'Frames not registered as private media'; end if;
 -- Restart of the same upload is idempotent.
 perform studio.studio_video_device_command(repeat('1',64),'substo','video_frames_reserve',body||jsonb_build_object('frames',frames));
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','video_frames_reserve',body||jsonb_build_object('frames',jsonb_build_array((frames->0)||jsonb_build_object('sha256',repeat('c',64)))));raise exception 'Verified frame rebound';exception when unique_violation then null;end;
 if studio.studio_video_device_command(repeat('1',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','method','local-parakeet-tdt-v3-4bit','language','en','durationSeconds',200,
   'transcript',jsonb_build_object('chunks',2,'segments',5),'visual',jsonb_build_object('status','ready','frames',2))))<>'true'::jsonb then raise exception 'Completion failed'; end if;
 select * into tx from studio.studio_video_transcriptions where id=t;
 if tx.status<>'ready' or tx.visual_status<>'ready' or tx.frame_count<>2 or tx.segment_count<>5 or not tx.transcript_applied or tx.method<>'local-parakeet-tdt-v3-4bit' then raise exception 'Final state %',to_jsonb(tx); end if;
 if (select payload->>'transcript' from studio.studio_records where id=ra) not like '[00:00:00] Sentence number 0.%' or (select payload->>'transcript' from studio.studio_records where id=ra) not like '%[00:01:40] Sentence number 0.%'
  or (select payload->>'transcriptOrigin' from studio.studio_records where id=ra)<>'mac_local' or (select version from studio.studio_records where id=ra)<>ver+1 then raise exception 'Timestamped transcript not saved on source'; end if;
 if (select count(*) from studio.studio_knowledge_source_units where location_id=w and source_id=ra and transcription_id=t::text)<>1
  or not exists(select 1 from jsonb_array_elements(studio.studio_knowledge_extraction_inputs(w,'substo','vt-owner',ra)->'inputs') i where i->>'mode'='source_units' and i->>'inputId'=t::text)
  or not exists(select 1 from jsonb_array_elements(studio.studio_knowledge_extraction_inputs(w,'substo','vt-owner',ra)->'inputs') i where i->>'mode'='record_text' and i->>'inputId'='transcript') then raise exception 'OCR/transcript not offered to extraction'; end if;
 v:=studio.studio_outline_input(w,ra,ver+1,'record_text','transcript');
 if jsonb_array_length(v->'units')<>6
  or not exists(select 1 from jsonb_array_elements(v->'units') u where u->>'evidenceType'='speech' and u->>'startSeconds'='100')
  or not exists(select 1 from jsonb_array_elements(v->'units') u where u->>'evidenceType'='ocr'
    and u->>'text'='Slide one: Pricing tiers' and u->>'startSeconds'='12.5' and u->>'context'='…as shown here…')
  or v::text like '%objectKey%' then raise exception 'Joined outline evidence incorrect: %',v; end if;
 update studio.studio_records set payload=jsonb_set(payload,'{transcript}','"Edited text"'::jsonb) where id=ra;
 v:=studio.studio_outline_input(w,ra,ver+1,'record_text','transcript');
 if jsonb_array_length(v->'units')<>1 or v#>>'{units,0,text}'<>'Edited text'
   or v#>>'{units,0,startSeconds}' is not null then raise exception 'Stale Mac evidence attached to edited text'; end if;
 if studio.studio_video_device_command(repeat('1',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','method','local-parakeet-tdt-v3-4bit','durationSeconds',200,'transcript',jsonb_build_object('chunks',2,'segments',5),'visual',jsonb_build_object('status','ready','frames',2))))<>'false'::jsonb then raise exception 'Completed job completed twice'; end if;
 if exists(select 1 from studio.studio_ai_usage where location_id=w) or exists(select 1 from studio.studio_ai_attempts where location_id=w) then raise exception 'Local transcription was metered as paid usage'; end if;

 -- Failed visual pass keeps a usable transcript and exposes partial status; a human transcript is preserved.
 update studio.studio_records set payload=payload-'transcript' where id=rb;
 r:=pg_temp.vt(w,'vt-owner',rb,'search','search-1');t:=(r->>'transcriptionId')::uuid;j:=(r->>'jobId')::uuid;
 claim:=pg_temp.claim(repeat('1',64));body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 perform studio.studio_video_device_command(repeat('1',64),'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',0,'segments',pg_temp.segs(4)));
 perform studio.studio_video_device_command(repeat('1',64),'substo','video_frames_reserve',body||jsonb_build_object('frames',jsonb_build_array(jsonb_build_object('index',0,'timeSeconds',1,'sceneStart',0,'sceneEnd',2,'ocr','Partial','audioContext','','selection','first-stable-state','sha256',sha,'byteSize',100))));
 perform studio.studio_video_device_command(repeat('1',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','method','youtube-captions-fallback','durationSeconds',30,'transcript',jsonb_build_object('chunks',1,'segments',4),'visual',jsonb_build_object('status','failed','error','tesseract exited 1'))));
 select * into tx from studio.studio_video_transcriptions where id=t;
 if tx.status<>'partial' or tx.visual_status<>'failed' or tx.frame_count<>0 or tx.visual_error is null or tx.method<>'youtube-captions-fallback' or (select payload->>'transcript' from studio.studio_records where id=rb) is null
  or exists(select 1 from studio.studio_video_frames where transcription_id=t) or exists(select 1 from studio.studio_knowledge_source_units where transcription_id=t::text) then raise exception 'Partial status wrong %',to_jsonb(tx); end if;
 -- Human text wins.
 if pg_temp.vt(w,'vt-owner',rhuman,'paste','human-0')->>'status'<>'skipped_existing' then raise exception 'Paste re-ran an already transcribed source'; end if;
 r:=pg_temp.vt(w,'vt-owner',rhuman,'suggestion','human-1');t:=(r->>'transcriptionId')::uuid;j:=(r->>'jobId')::uuid;
 claim:=pg_temp.claim(repeat('1',64));body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 perform studio.studio_video_device_command(repeat('1',64),'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',0,'segments',pg_temp.segs(2)));
 perform studio.studio_video_device_command(repeat('1',64),'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','method','local-parakeet-tdt-v3-4bit','durationSeconds',9,'transcript',jsonb_build_object('chunks',1,'segments',2),'visual',jsonb_build_object('status','ready','frames',0))));
 if (select payload->>'transcript' from studio.studio_records where id=rhuman)<>'Human typed transcript.' or (select transcript_applied from studio.studio_video_transcriptions where id=t) then raise exception 'Human transcript overwritten'; end if;

 -- Retryable waits do not consume attempts; execution failures are terminal; settings changes cancel queued work.
 update studio.studio_records set payload=payload-'transcript' where id=ra;
 r:=pg_temp.vt(w,'vt-owner',ra,'suggestion','paste-2');t:=(r->>'transcriptionId')::uuid;j:=(r->>'jobId')::uuid;
 claim:=pg_temp.claim(repeat('1',64));body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 v:=studio.studio_video_device_command(repeat('1',64),'substo','fail',body||'{"failure":{"code":"video_tools_missing","message":"yt-dlp is not installed","retryable":true,"retryAfterSeconds":60}}');
 if v<>'"retry_scheduled"'::jsonb
  or (select attempts from studio.studio_jobs where id=j)<>0 or (select status from studio.studio_video_transcriptions where id=t)<>'queued' or (select error_code from studio.studio_video_transcriptions where id=t)<>'video_tools_missing' then raise exception 'Tool wait consumed attempt or lost status % % % %',v,(select attempts from studio.studio_jobs where id=j),(select status from studio.studio_video_transcriptions where id=t),(select error_code from studio.studio_video_transcriptions where id=t); end if;
 update studio.studio_jobs set run_after=clock_timestamp() where id=j;
 claim:=pg_temp.claim(repeat('1',64));body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
v:=studio.studio_video_device_command(repeat('1',64),'substo','fail',body||'{"failure":{"code":"video_no_transcript","message":"No audio or captions","retryable":false}}');
 if v<>'"failed"'::jsonb or (select status from studio.studio_video_transcriptions where id=t)<>'failed' then raise exception 'Terminal failure not recorded'; end if;
 r:=pg_temp.vt(w,'vt-owner',ra,'suggestion','paste-3');t:=(r->>'transcriptionId')::uuid;
 update studio.studio_devices set desired_config=jsonb_set(desired_config,'{features,transcription}','false') where id=d;
 if (select status from studio.studio_video_transcriptions where id=t)<>'cancelled' or (select status from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'cancelled' then raise exception 'Queued work survived withdrawn consent'; end if;
 update studio.studio_devices set desired_config=jsonb_set(desired_config,'{features,transcription}','true') where id=d;
 -- Revocation stops a running job's completion.
 r:=pg_temp.vt(w,'vt-owner',ra,'suggestion','paste-4');j:=(r->>'jobId')::uuid;
 claim:=pg_temp.claim(repeat('1',64));body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token');
 update studio.studio_devices set revoked_at=clock_timestamp() where id=d;
 begin perform studio.studio_video_device_command(repeat('1',64),'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',0,'segments',pg_temp.segs(1)));raise exception 'Revoked Mac wrote';exception when sqlstate '42501' then null;end;
end $$;

-- Approved-channel discovery: gated jobs; unapproved channels are suggestions only; borderline asks, low is logged.
do $$
declare w text:='ad100000-0000-4000-8000-000000000001'; s uuid:='ad300000-0000-4000-8000-000000000001'; s2 uuid:='ad300000-0000-4000-8000-000000000002';
 cv uuid:=gen_random_uuid(); channel text:='UCbbbbbbbbbbbbbbbbbbbbbb'; d uuid; r studio.studio_schedule_recurring%rowtype; result jsonb; run uuid; jj studio.studio_jobs%rowtype;
 out jsonb; vids text[]:=array['ccccccccccc','ddddddddddd','eeeeeeeeeee']; tid uuid; j uuid; claim jsonb; body jsonb; ctx jsonb; rec uuid; v text; ex jsonb; pre bigint;
 hash text:=repeat('3',64); code text:='TVTCCCCC'; h text:=encode(sha256(convert_to('TVTCCCCC','UTF8')),'hex'); pr jsonb;
begin
 perform studio.studio_create_substo_location(w,'Discovery fixture','vd-owner');
 pr:=studio.studio_device_pair_start('substo','Disc Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo','vd-owner','approve',code,gen_random_uuid());
 pr:=studio.studio_device_pair_poll('substo',(pr->>'pairingId')::uuid,h,hash);d:=(pr->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,desired_config='{"features":{"text":true,"transcription":true},"textProvider":"codex","textModel":null}',config_version=2,applied_config_version=2,config_status='applied',seen_at=clock_timestamp(),
  report='{"handlers":["studio.video_transcribe"],"video":{"ready":true}}' where id=d;
 insert into studio.platform_google_youtube_connections(app,clerk_user_id,client_id,refresh_cipher,granted_scopes,version)
  values('substo','vd-owner','client','{"ciphertext":"sealed","iv":"iv","authTag":"tag","keyId":"v1"}',array['https://www.googleapis.com/auth/youtube.readonly'],cv);
 insert into studio.studio_youtube_channels(location_id,channel_id,label,approved_by) values(w,channel,'Approved channel','vd-owner');
 -- Approved channel schedule.
 perform studio.studio_save_schedule(w,s,0,'substo','vd-owner','youtube-discovery','Approved research',24,'09:00');
 perform studio.studio_enable_youtube_schedule(w,'substo','vd-owner',s,1,0,gen_random_uuid(),cv,'approved_channel',channel,'Approved channel',true);
 update studio.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id=w and schedule_id=s returning * into r;
 result:=studio.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 select youtube_run_id,job_id into run,j from studio.studio_schedule_executions where id=(result->>'executionId')::uuid;
 perform studio.studio_claim_jobs('disc-worker',50,60); select * into jj from studio.studio_jobs where id=j;
 begin perform studio.studio_enqueue_discovered_video_transcriptions(w,run,j,'disc-worker',jj.lease_token,'{}');raise exception 'Enqueue before the discovery result is saved';exception when invalid_parameter_value then null;end;
 perform studio.studio_begin_youtube_discovery(w,run,j,'disc-worker',jj.lease_token);
 result:=studio.studio_finish_youtube_discovery(w,run,j,'disc-worker',jj.lease_token,to_jsonb(vids));
 begin perform studio.studio_enqueue_discovered_video_transcriptions(w,run,j,'disc-worker',gen_random_uuid(),'{}');raise exception 'Foreign lease enqueued';exception when serialization_failure then null;end;
 begin perform studio.studio_enqueue_discovered_video_transcriptions(w,run,j,'disc-worker',jj.lease_token,'{"thresholds":{"auto":50,"review":60}}');raise exception 'Inverted thresholds';exception when invalid_parameter_value then null;end;
 begin perform studio.studio_enqueue_discovered_video_transcriptions(w,run,j,'disc-worker',jj.lease_token,'{"secret":"x"}');raise exception 'Unknown context key';exception when invalid_parameter_value then null;end;
 ctx:=jsonb_build_object('thresholds','{"auto":70,"review":40}'::jsonb,'context',jsonb_build_object('approvedTitles',jsonb_build_array('Pricing talks'),'pinnedKnowledge',jsonb_build_array('Offer clarity'),'profile',jsonb_build_object('business','Acme')));
 out:=studio.studio_enqueue_discovered_video_transcriptions(w,run,j,'disc-worker',jj.lease_token,ctx);
 if jsonb_array_length(out->'videos')<>3 or (select count(*) from studio.studio_jobs where location_id=w and kind='studio.video_transcribe' and status='queued')<>3 or exists(select 1 from studio.studio_video_transcriptions where location_id=w and origin<>'approved_channel') then raise exception 'Approved channel did not enqueue gated jobs %',out; end if;
 if studio.studio_enqueue_discovered_video_transcriptions(w,run,j,'disc-worker',jj.lease_token,ctx)::text<>studio.studio_enqueue_discovered_video_transcriptions(w,run,j,'disc-worker',jj.lease_token,ctx)::text
  or (select count(*) from studio.studio_jobs where location_id=w and kind='studio.video_transcribe')<>3 then raise exception 'Discovery enqueue not idempotent'; end if;
 if (select payload->'gate'->'thresholds'->>'auto' from studio.studio_jobs where location_id=w and kind='studio.video_transcribe' limit 1)<>'70' then raise exception 'Thresholds not pinned to the job'; end if;
 -- Band enforcement: high transcribes, borderline suggests, low skips; a Mac claiming a different band is rejected.
 for v in select unnest(vids) loop
  rec:=(select id from studio.studio_records where location_id=w and source_url='https://www.youtube.com/watch?v='||v);
  tid:=(select id from studio.studio_video_transcriptions where record_id=rec);
  update studio.studio_jobs set run_after=clock_timestamp() where id=(select job_id from studio.studio_video_transcriptions where id=tid);
 end loop;
 for v in select unnest(vids) loop
  rec:=(select id from studio.studio_records where location_id=w and source_url='https://www.youtube.com/watch?v='||v); tid:=(select id from studio.studio_video_transcriptions where record_id=rec);
  claim:=studio.studio_video_device_command(hash,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":120,"videoReady":true}');
  j:=(claim->0->>'id')::uuid; body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim->0->>'lease_token'); tid:=(claim->0->'payload'->>'transcriptionId')::uuid;
  if v='ccccccccccc' then -- low score
   begin perform studio.studio_video_device_command(hash,'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','relevance',jsonb_build_object('relevant',true,'score',10,'reason','Off topic','matches','[]'::jsonb),'method','local-parakeet-tdt-v3-4bit','durationSeconds',9,'transcript',jsonb_build_object('chunks',1,'segments',1),'visual',jsonb_build_object('status','ready','frames',0))));raise exception 'Low score transcribed';exception when sqlstate '22023' then null;end;
   begin perform studio.studio_video_device_command(hash,'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','relevance_skipped','method','local-parakeet-tdt-v3-4bit')));raise exception 'Missing relevance accepted';exception when sqlstate '22023' then null;end;
   perform studio.studio_video_device_command(hash,'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','relevance_skipped','relevance',jsonb_build_object('relevant',false,'score',10,'reason','Off topic','matches','[]'::jsonb))));
   if (select status from studio.studio_video_transcriptions where id=tid)<>'skipped' or (select relevance->>'band' from studio.studio_video_transcriptions where id=tid)<>'skip' then raise exception 'Low relevance not logged/skipped'; end if;
  elsif v='ddddddddddd' then -- borderline
   begin perform studio.studio_video_device_command(hash,'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','relevance_skipped','relevance',jsonb_build_object('relevant',true,'score',55,'reason','Maybe','matches','[]'::jsonb))));raise exception 'Borderline skipped silently';exception when sqlstate '22023' then null;end;
   perform studio.studio_video_device_command(hash,'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','relevance_review','relevance',jsonb_build_object('relevant',true,'score',55,'reason','Maybe','matches',jsonb_build_array('Pricing talks')))));
   if (select status from studio.studio_video_transcriptions where id=tid)<>'suggested' or exists(select 1 from studio.studio_video_frames where transcription_id=tid) then raise exception 'Borderline not left for confirmation'; end if;
  else -- high but flagged not relevant is borderline, not automatic
   begin perform studio.studio_video_device_command(hash,'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','relevance',jsonb_build_object('relevant',false,'score',95,'reason','Contradictory','matches','[]'::jsonb),'method','local-parakeet-tdt-v3-4bit','durationSeconds',9,'transcript',jsonb_build_object('chunks',1,'segments',1),'visual',jsonb_build_object('status','ready','frames',0))));raise exception 'Not-relevant auto-transcribed';exception when sqlstate '22023' then null;end;
   perform studio.studio_video_device_command(hash,'substo','video_transcript_chunk',body||jsonb_build_object('chunkIndex',0,'segments','[{"start":0,"end":3,"text":"Pricing tiers explained."}]'::jsonb));
   perform studio.studio_video_device_command(hash,'substo','complete',body||jsonb_build_object('result',jsonb_build_object('outcome','transcribed','relevance',jsonb_build_object('relevant',true,'score',88,'reason','Matches approved pricing talks','matches',jsonb_build_array('Pricing talks')),'method','local-parakeet-tdt-v3-4bit','language','en','durationSeconds',9,'transcript',jsonb_build_object('chunks',1,'segments',1),'visual',jsonb_build_object('status','ready','frames',0))));
   if (select status from studio.studio_video_transcriptions where id=tid)<>'ready' or (select relevance->>'band' from studio.studio_video_transcriptions where id=tid)<>'high' then raise exception 'High relevance not transcribed'; end if;
  end if;
 end loop;
 -- Confirming a borderline suggestion runs the same job ungated.
 rec:=(select id from studio.studio_records where location_id=w and source_url='https://www.youtube.com/watch?v=ddddddddddd');
 ex:=studio.studio_enqueue_video_transcription(w,'substo','vd-owner',jsonb_build_object('requestKey','confirm-1','recordId',rec,'origin','suggestion'));
 if ex->>'status'<>'queued' or (select payload->'gate' from studio.studio_jobs where id=(ex->>'jobId')::uuid)<>'null'::jsonb or exists(select 1 from studio.studio_video_transcriptions where record_id=rec and status='suggested') then raise exception 'Confirmation %',ex; end if;
 -- Unapproved channel: search schedule saves suggestions only; never a job or download.
 perform studio.studio_save_schedule(w,s2,0,'substo','vd-owner','youtube-discovery','Public query',24,'10:00');
 perform studio.studio_enable_youtube_schedule(w,'substo','vd-owner',s2,1,0,gen_random_uuid(),cv,'search','','Search label',true);
 update studio.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id=w and schedule_id=s2 returning * into r;
 result:=studio.studio_dispatch_schedule(w,s2,r.activation_token,r.next_run_at,true);
 select youtube_run_id,job_id into run,j from studio.studio_schedule_executions where id=(result->>'executionId')::uuid;
 update studio.studio_jobs set run_after=clock_timestamp() where id=j; perform studio.studio_claim_jobs('disc-worker',50,60); select * into jj from studio.studio_jobs where id=j;
 perform studio.studio_begin_youtube_discovery(w,run,j,'disc-worker',jj.lease_token);
 pre:=(select count(*) from studio.studio_jobs where kind='studio.video_transcribe');
 perform studio.studio_finish_youtube_discovery(w,run,j,'disc-worker',jj.lease_token,'["fffffffffff"]');
 out:=studio.studio_enqueue_discovered_video_transcriptions(w,run,j,'disc-worker',jj.lease_token,ctx);
 if out#>>'{videos,0,status}'<>'suggested' or (select count(*) from studio.studio_jobs where kind='studio.video_transcribe')<>pre
  or (select origin from studio.studio_video_transcriptions where video_id='fffffffffff')<>'discovery_suggestion' then raise exception 'Unapproved channel was not suggestions-only %',out; end if;
 -- No ready Mac: the automatic path logs a skip instead of failing discovery or using a paid route.
 update studio.studio_devices set revoked_at=clock_timestamp() where id=d;
 rec:=gen_random_uuid();
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,rec,'reference','No Mac','{"url":"https://www.youtube.com/watch?v=ggggggggggg"}');
 ex:=studio.studio_video_enqueue_core(w,'substo','vd-owner',rec,'approved_channel','no-mac-1',studio.studio_video_gate('{}'),false);
 if ex->>'status'<>'skipped' or ex->>'reason'<>'no_mac' or (select error_code from studio.studio_video_transcriptions where record_id=rec)<>'video_no_mac' or exists(select 1 from studio.studio_jobs where payload->>'recordId'=rec::text) then raise exception 'No-Mac automatic path %',ex; end if;
end $$;
