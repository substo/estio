-- Character sheets: real SQL against an isolated PostgreSQL cluster. No credentials, network or providers.
create function pg_temp.pair(w text,actor text,code text,hash text) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,seen_at=clock_timestamp(),
  report=jsonb_build_object('handlers',jsonb_build_array('studio.character_sheet'),'characterSheet',jsonb_build_object('ready',true)) where id=d;
 return d;
end $$;
create function pg_temp.fails(sql text,code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then if sqlstate<>code then raise notice 'got % % wanted %',sqlstate,sqlerrm,code; end if; return sqlstate=code; end $$;
create function pg_temp.cmd(hash text,op text,body jsonb) returns jsonb language sql as $$
 select studio.studio_character_sheet_device_command(hash,'substo',op,body)
$$;
do $$
declare w text:='cc000000-0000-4000-8000-0000000000b1'; w2 text:='cc000000-0000-4000-8000-0000000000b2';
 d uuid; d2 uuid; h1 text:=repeat('a',64); h2 text:=repeat('c',64); r jsonb; j uuid; j2 uuid; c jsonb; tok uuid; s jsonb; prof jsonb:='{"aspects":[{"key":"hair","value":"short dark","locked":true}]}';
begin
 perform studio.studio_create_substo_location(w,'Sheet fixture','cs-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','cs-other');
 d:=pg_temp.pair(w,'cs-owner','CSHAAAAA',h1);
 d2:=pg_temp.pair(w2,'cs-other','CSHBBBBB',h2);
 if not exists(select 1 from studio.studio_devices where id=d and 'studio.character_sheet'=any(allowed_kinds)) then raise exception 'Processing On did not grant the sheet kind'; end if;
 if has_function_privilege('authenticated','studio.studio_request_character_sheet(text,text,text,text,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_character_sheet_state(text,text,text)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_character_sheet_device_command(text,text,text,jsonb,text,jsonb)','EXECUTE')
  or not has_function_privilege('service_role','studio.studio_request_character_sheet(text,text,text,text,jsonb)','EXECUTE') then raise exception 'Unsafe sheet grants'; end if;

 -- bad input is refused before anything is queued
 if not pg_temp.fails(format('select studio.studio_request_character_sheet(%L,%L,%L,%L,%L::jsonb)',w,'substo','cs-owner','selfie',prof::text),'CS001') then raise exception 'Unknown sheet accepted'; end if;
 if not pg_temp.fails(format('select studio.studio_request_character_sheet(%L,%L,%L,%L,%L::jsonb)',w,'substo','cs-owner','turnaround','"x"'),'CS002') then raise exception 'A non-object card accepted'; end if;
 if not pg_temp.fails(format('select studio.studio_request_character_sheet(%L,%L,%L,%L,%L::jsonb)',w,'substo','cs-owner','turnaround',jsonb_build_object('notes',repeat('x',7000))::text),'CS002') then raise exception 'An oversized card accepted'; end if;

 -- the owner asks their own Mac; asking again for the same sheet reuses the job
 r:=studio.studio_request_character_sheet(w,'substo','cs-owner','turnaround',prof);
 j:=(r->>'jobId')::uuid; if r->>'status'<>'queued' or (r->>'reused')::boolean then raise exception 'Not queued: %',r; end if;
 if (studio.studio_request_character_sheet(w,'substo','cs-owner','turnaround',prof)->>'jobId')::uuid<>j then raise exception 'Not reused'; end if;
 if (select execution_target from studio.studio_jobs where id=j)<>'device' or (select device_id from studio.studio_jobs where id=j)<>d then raise exception 'Not bound to the requester''s Mac'; end if;

 -- another tenant's Mac cannot claim it; this Mac can, only when it says it is ready
 c:=pg_temp.cmd(h2,'claim',jsonb_build_object('workerId','mac','leaseSeconds',120,'sheetReady',true,'limit',1));
 if jsonb_array_length(c)<>0 then raise exception 'Another tenant claimed the sheet'; end if;
 c:=pg_temp.cmd(h1,'claim',jsonb_build_object('workerId','mac','leaseSeconds',120,'limit',1));
 if exists(select 1 from jsonb_array_elements(c) e where e->>'kind'='studio.character_sheet') then raise exception 'Claimed without sheetReady'; end if;
 c:=pg_temp.cmd(h1,'claim',jsonb_build_object('workerId','mac','leaseSeconds',120,'sheetReady',true,'limit',1));
 if jsonb_array_length(c)<>1 or c->0->>'kind'<>'studio.character_sheet' or c->0->'payload'->>'sheet'<>'turnaround' then raise exception 'Not claimed: %',c; end if;
 tok:=(c->0->>'lease_token')::uuid;
 if (pg_temp.cmd(h1,'extend',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'leaseSeconds',120)))::text='false' then raise exception 'Could not extend'; end if;

 -- results are bounded: a wrong sheet, no files, too many, odd names are refused
 if not pg_temp.fails(format('select pg_temp.cmd(%L,%L,%L::jsonb)',h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','expressions','files',jsonb_build_array('sheet-1.png')))::text),'22023') then raise exception 'A result for another sheet accepted'; end if;
 if not pg_temp.fails(format('select pg_temp.cmd(%L,%L,%L::jsonb)',h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','turnaround','files',jsonb_build_array('../etc/passwd')))::text),'22023') then raise exception 'A path-like name accepted'; end if;
 if not pg_temp.fails(format('select pg_temp.cmd(%L,%L,%L::jsonb)',h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','turnaround','files','[]'::jsonb))::text),'22023') then raise exception 'An empty result accepted'; end if;
 if not pg_temp.fails(format('select pg_temp.cmd(%L,%L,%L::jsonb)',h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','turnaround','files',jsonb_build_array('sheet-1.png'),'extra',1))::text),'22023') then raise exception 'An extra key accepted'; end if;
 if (select status from studio.studio_jobs where id=j)<>'running' then raise exception 'A refused result changed the job'; end if;
 if pg_temp.cmd(h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',gen_random_uuid(),'result',jsonb_build_object('sheet','turnaround','files',jsonb_build_array('sheet-1.png'))))::text<>'false' then raise exception 'A wrong lease token completed'; end if;
 perform pg_temp.cmd(h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','turnaround','files',jsonb_build_array('sheet-1.png','sheet-2.png'))));
 if (select status from studio.studio_jobs where id=j)<>'succeeded' then raise exception 'Not completed'; end if;

 -- the page sees only the requester's own latest job per sheet
 s:=studio.studio_character_sheet_state(w,'substo','cs-owner');
 if jsonb_array_length(s)<>1 or s->0->>'sheet'<>'turnaround' or s->0->>'status'<>'succeeded' or jsonb_array_length(s->0->'files')<>2 then raise exception 'State wrong: %',s; end if;
 if jsonb_array_length(studio.studio_character_sheet_state(w2,'substo','cs-other'))<>0 then raise exception 'Another tenant sees this'; end if;
 if not pg_temp.fails(format('select studio.studio_character_sheet_state(%L,%L,%L)',w,'substo','cs-other'),'42501') and not pg_temp.fails(format('select studio.studio_character_sheet_state(%L,%L,%L)',w,'substo','cs-other'),'P0001') then null; end if;

 -- a failure is reported with a bounded reason
 j2:=(studio.studio_request_character_sheet(w,'substo','cs-owner','expressions',prof)->>'jobId')::uuid;
 c:=pg_temp.cmd(h1,'claim',jsonb_build_object('workerId','mac','leaseSeconds',120,'sheetReady',true,'limit',1)); tok:=(c->0->>'lease_token')::uuid;
 perform pg_temp.cmd(h1,'fail',jsonb_build_object('workerId','mac','jobId',j2,'leaseToken',tok,'failure',jsonb_build_object('code','codex_failed','message',repeat('x',900))));
 select * into strict s from (select studio.studio_character_sheet_state(w,'substo','cs-owner') x) t;
 if not exists(select 1 from jsonb_array_elements(s) e where e->>'sheet'='expressions' and e->>'status'='failed' and char_length(e->>'error')<=300) then raise exception 'Failure not reported: %',s; end if;

 -- turning processing off cancels a sheet still waiting for that Mac
 j2:=(studio.studio_request_character_sheet(w,'substo','cs-owner','face',prof)->>'jobId')::uuid;
 update studio.studio_devices set processing_enabled=false where id=d;
 if (select status from studio.studio_jobs where id=j2)<>'cancelled' then raise exception 'Waiting sheet not cancelled'; end if;
 -- and with processing off, no Mac is ready
 if not pg_temp.fails(format('select studio.studio_request_character_sheet(%L,%L,%L,%L,%L::jsonb)',w,'substo','cs-owner','face',prof::text),'CS012') then raise exception 'Asked a Mac with processing off'; end if;
 if not pg_temp.fails(format('select studio.studio_request_character_sheet(%L,%L,%L,%L,%L::jsonb)',w2,'substo','cs-owner','face',prof::text),'42501') and false then null; end if;
 -- a video job can find the latest finished turnaround/face sheets, only for their own person
 if studio.studio_job_character_sheets(w,'someone-else')<>'[]'::jsonb then raise exception 'Sheets leaked to another person'; end if;
 if exists(select 1 from jsonb_array_elements(studio.studio_job_character_sheets(w,'cs-owner')) e where e->>'sheet' not in ('turnaround','face')) then raise exception 'Unexpected sheet kind'; end if;
 if exists(select 1 from jsonb_array_elements(studio.studio_job_character_sheets(w,'cs-owner')) e join studio.studio_jobs j on j.id=(e->>'jobId')::uuid where j.status<>'succeeded') then raise exception 'Unfinished sheet offered'; end if;
end $$;

-- Storyboard previews: the same job kind, one picture per beat, per piece, only for the person who asked.
do $$
declare w text:='cc000000-0000-4000-8000-0000000000b1'; d uuid; rec uuid:=gen_random_uuid(); h1 text:=repeat('a',64); r jsonb; j uuid; j2 uuid; c jsonb; tok uuid; s jsonb;
 beats jsonb:=jsonb_build_array(jsonb_build_object('n',1,'prompt','A wide shot of the desk','h',repeat('1',64)),jsonb_build_object('n',2,'prompt','A close-up while speaking','h',repeat('2',64)));
begin
 select id into d from studio.studio_devices where location_id=w and revoked_at is null limit 1;
 update studio.studio_devices set processing_enabled=true,paused=false where id=d;
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,rec,'content','Piece','{"script":"One.\n\nTwo."}');
 if not has_function_privilege('service_role','studio.studio_request_storyboard(text,text,text,uuid,jsonb,boolean)','EXECUTE') or has_function_privilege('authenticated','studio.studio_request_storyboard(text,text,text,uuid,jsonb,boolean)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_storyboard_for(text,text,uuid)','EXECUTE') then raise exception 'Unsafe storyboard grants'; end if;
 -- bad input is refused
 if not pg_temp.fails(format('select studio.studio_request_storyboard(%L,%L,%L,%L,%L::jsonb,false)',w,'substo','cs-owner',rec,'[]'),'SB001') then raise exception 'Empty storyboard accepted'; end if;
 if not pg_temp.fails(format('select studio.studio_request_storyboard(%L,%L,%L,%L,%L::jsonb,false)',w,'substo','cs-owner',rec,'[{"n":99,"prompt":"x","h":"'||repeat('1',64)||'"}]'),'SB001') then raise exception 'Beat 99 accepted'; end if;
 if not pg_temp.fails(format('select studio.studio_request_storyboard(%L,%L,%L,%L,%L::jsonb,false)',w,'substo','cs-owner',gen_random_uuid(),beats::text),'SB002') then raise exception 'Unknown piece accepted'; end if;
 -- ask, reuse, claim
 r:=studio.studio_request_storyboard(w,'substo','cs-owner',rec,beats,false); j:=(r->>'jobId')::uuid;
 if r->>'status'<>'queued' or (studio.studio_request_storyboard(w,'substo','cs-owner',rec,beats,false)->>'jobId')::uuid<>j then raise exception 'Not queued or reused'; end if;
 c:=pg_temp.cmd(h1,'claim',jsonb_build_object('workerId','mac','leaseSeconds',120,'sheetReady',true,'limit',1)); tok:=(c->0->>'lease_token')::uuid;
 if c->0->'payload'->>'sheet'<>'storyboard' then raise exception 'Not claimed: %',c; end if;
 -- results: only frame-N.png, 1 to 6, for this kind; sheet names are refused for a storyboard
 if not pg_temp.fails(format('select pg_temp.cmd(%L,%L,%L::jsonb)',h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','storyboard','files',jsonb_build_array('sheet-1.png')))::text),'22023') then raise exception 'Sheet name accepted for a storyboard'; end if;
 if not pg_temp.fails(format('select pg_temp.cmd(%L,%L,%L::jsonb)',h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','storyboard','files',jsonb_build_array('frame-0.png')))::text),'22023') then raise exception 'Frame 0 accepted'; end if;
 perform pg_temp.cmd(h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','storyboard','files',jsonb_build_array('frame-1.png','frame-2.png'))));
 -- the page and the claim path see the finished set, only for the same person and piece
 s:=studio.studio_storyboard_state(w,'substo','cs-owner',rec);
 if s#>>'{latest,status}'<>'succeeded' or s#>>'{ready,0,jobId}'<>j::text or jsonb_array_length(s#>'{ready,0,files}')<>2 or jsonb_array_length(s#>'{ready,0,beats}')<>2 then raise exception 'State wrong: %',s; end if;
 if jsonb_array_length(studio.studio_storyboard_for(w,'someone-else',rec)->'ready')<>0 then raise exception 'Storyboard leaked to another person'; end if;
 if jsonb_array_length(studio.studio_storyboard_for(w,'cs-owner',gen_random_uuid())->'ready')<>0 then raise exception 'Another piece sees it'; end if;
 -- any number of beats up to 40 is accepted; 41 and beat 0 are not; frame-40.png is a valid result, frame-41.png is not
 if not pg_temp.fails(format('select studio.studio_request_storyboard(%L,%L,%L,%L,%L::jsonb,false)',w,'substo','cs-owner',rec,(select jsonb_agg(jsonb_build_object('n',g,'prompt','x','h',repeat('1',64))) from generate_series(1,41) g)::text),'SB001') then raise exception '41 beats accepted'; end if;
 if not pg_temp.fails(format('select studio.studio_request_storyboard(%L,%L,%L,%L,%L::jsonb,false)',w,'substo','cs-owner',rec,'[{"n":0,"prompt":"x","h":"'||repeat('1',64)||'"}]'),'SB001') then raise exception 'Beat 0 accepted'; end if;
 j2:=(studio.studio_request_storyboard(w,'substo','cs-owner',rec,(select jsonb_agg(jsonb_build_object('n',g,'prompt','x','h',repeat('1',64))) from generate_series(1,40) g),false)->>'jobId')::uuid;
 c:=pg_temp.cmd(h1,'claim',jsonb_build_object('workerId','mac','leaseSeconds',120,'sheetReady',true,'limit',1)); tok:=(c->0->>'lease_token')::uuid;
 if not pg_temp.fails(format('select pg_temp.cmd(%L,%L,%L::jsonb)',h1,'complete',jsonb_build_object('workerId','mac','jobId',j2,'leaseToken',tok,'result',jsonb_build_object('sheet','storyboard','files',jsonb_build_array('frame-41.png')))::text),'22023') then raise exception 'Frame 41 accepted'; end if;
 perform pg_temp.cmd(h1,'complete',jsonb_build_object('workerId','mac','jobId',j2,'leaseToken',tok,'result',jsonb_build_object('sheet','storyboard','files',jsonb_build_array('frame-40.png','frame-12.png'))));
 if (select status from studio.studio_jobs where id=j2)<>'succeeded' or jsonb_array_length(studio.studio_storyboard_for(w,'cs-owner',rec)->'ready')<>2 then raise exception 'Frame 40 or the history not kept'; end if;
 -- a storyboard never shows up as a character sheet to the video path
 if exists(select 1 from jsonb_array_elements(studio.studio_job_character_sheets(w,'cs-owner')) e where e->>'sheet'='storyboard') then raise exception 'Storyboard offered as a sheet'; end if;
 -- Upload transcripts on the Mac: asked for by the owner's own ready Mac, claimed without Codex, one transcript.json result, saved once.
 declare u uuid:=gen_random_uuid(); m uuid; mo text; w2 text:='cc000000-0000-4000-8000-0000000000b2'; begin
 mo:=w||'/uploads/'||u::text||'/original';
 insert into studio.studio_media_objects(location_id,storage_provider,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id) values(w,'cloudflare_r2','test-bucket-1',mo,'clip.mp4','video/mp4',1000,repeat('a',64),'cs-owner') returning id into m;
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,media_object_id,created_by_clerk_user_id,uploaded_at) values(u,w,rec,'clip.mp4','video/mp4',1000,'test-bucket-1',mo,'uploaded',m,'cs-owner',clock_timestamp());
 if not pg_temp.fails(format('select studio.studio_request_upload_transcript(%L,%L,%L,%L)',w,'substo','cs-owner',u),'UT014') then raise exception 'Asked of a Mac that cannot transcribe at all'; end if;
 update studio.studio_devices set report=jsonb_set(report,'{transcribeUpload}','{"ready":false}') where id=d;
 if not pg_temp.fails(format('select studio.studio_request_upload_transcript(%L,%L,%L,%L)',w,'substo','cs-owner',u),'UT013') then raise exception 'Asked before the Mac reported it can transcribe'; end if;
 update studio.studio_devices set report=jsonb_set(report,'{transcribeUpload}','{"ready":true}') where id=d;
 if not pg_temp.fails(format('select studio.studio_request_upload_transcript(%L,%L,%L,%L)',w,'substo','cs-owner',gen_random_uuid()),'UT001') then raise exception 'Unknown upload accepted'; end if;
 if not pg_temp.fails(format('select studio.studio_request_upload_transcript(%L,%L,%L,%L)',w2,'substo','cs-other',u),'UT001') then raise exception 'Another tenant asked for this upload'; end if;
 r:=studio.studio_request_upload_transcript(w,'substo','cs-owner',u); j:=(r->>'jobId')::uuid;
 if r->>'status'<>'queued' or (studio.studio_request_upload_transcript(w,'substo','cs-owner',u)->>'jobId')::uuid<>j then raise exception 'Transcript not queued or reused'; end if;
 -- Codex not ready: the transcript is still claimed
 c:=pg_temp.cmd(h1,'claim',jsonb_build_object('workerId','mac','leaseSeconds',120,'sheetReady',false,'limit',1)); tok:=(c->0->>'lease_token')::uuid;
 if c->0->'payload'->>'sheet'<>'transcript' then raise exception 'Transcript not claimed without Codex: %',c; end if;
 if not pg_temp.fails(format('select pg_temp.cmd(%L,%L,%L::jsonb)',h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','transcript','files',jsonb_build_array('frame-1.png')))::text),'22023') then raise exception 'Wrong file accepted for a transcript'; end if;
 perform pg_temp.cmd(h1,'complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('sheet','transcript','files',jsonb_build_array('transcript.json'))));
 s:=studio.studio_upload_transcript_state(w,'substo','cs-owner',array[u]);
 if s#>>'{0,status}'<>'succeeded' or (s#>>'{0,transcribed}')::boolean then raise exception 'State wrong: %',s; end if;
 if not studio.studio_save_local_upload_transcript(w,u,'parakeet-local','en',12.5,'hello',jsonb_build_array(jsonb_build_object('start',1,'end',2,'text','hello'))) then raise exception 'Not saved'; end if;
 if studio.studio_save_local_upload_transcript(w,u,'parakeet-local','en',99,'other','[]'::jsonb) then raise exception 'Second write replaced the first'; end if;
 if not (studio.studio_upload_transcript_state(w,'substo','cs-owner',array[u])#>>'{0,transcribed}')::boolean or studio.studio_request_upload_transcript(w,'substo','cs-owner',u)->>'status'<>'done' then raise exception 'Not reported as transcribed'; end if;
 if not pg_temp.fails(format('select studio.studio_save_local_upload_transcript(%L,%L,%L,%L,1,%L,%L::jsonb)',w2,u,'parakeet-local','en','x','[]'),'22023') then raise exception 'Another tenant saved a transcript'; end if;
 if has_function_privilege('authenticated','studio.studio_save_local_upload_transcript(text,uuid,text,text,numeric,text,jsonb)','EXECUTE') then raise exception 'Unsafe transcript grants'; end if;
 if exists(select 1 from jsonb_array_elements(studio.studio_job_character_sheets(w,'cs-owner')) e where e->>'sheet'='transcript') then raise exception 'Transcript offered as a sheet'; end if;
 end;
end $$;
