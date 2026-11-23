-- Real SQL against an isolated PostgreSQL cluster. No credentials, network or providers.
create function pg_temp.pair(w text,actor text,code text,hash text,ready boolean default true) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,seen_at=clock_timestamp(),
  report=jsonb_build_object('handlers',jsonb_build_array('studio.video_assemble'),'videoAssembly',jsonb_build_object('ready',ready)) where id=d;
 return d;
end $$;
create function pg_temp.claim(hash text,ready boolean default true) returns jsonb language sql as $$
 select studio.studio_video_assembly_device_command(hash,'substo','claim',jsonb_build_object('workerId','mac','limit',1,'leaseSeconds',120,'assembleReady',ready))
$$;
create function pg_temp.fails(sql text,code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then if sqlstate<>code then raise notice 'got % % wanted %',sqlstate,sqlerrm,code; end if; return sqlstate=code; end $$;
do $$
declare w text:='ae000000-0000-4000-8000-0000000000a1'; w2 text:='ae000000-0000-4000-8000-0000000000a2';
 d uuid; d2 uuid; rec uuid:=gen_random_uuid(); rec2 uuid:=gen_random_uuid(); rec3 uuid:=gen_random_uuid(); up uuid:=gen_random_uuid(); mo uuid; r jsonb; c jsonb; j uuid; tok uuid; ex jsonb;
 h1 text:=repeat('a',64); sha text:=repeat('b',64); bucket text:='studio-test-bucket';
begin
 perform studio.studio_create_substo_location(w,'VA fixture','va-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','va-other');
 d:=pg_temp.pair(w,'va-owner','TVAAAAAA',h1);
 d2:=pg_temp.pair(w2,'va-other','TVABBBBB',repeat('c',64));
 if not exists(select 1 from studio.studio_devices where id=d and 'studio.video_assemble'=any(allowed_kinds)) then raise exception 'Processing On did not grant video assembly'; end if;
 if has_function_privilege('authenticated','studio.studio_request_video_assembly(text,text,text,uuid,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_video_assembly_device_command(text,text,text,jsonb,text,jsonb)','EXECUTE')
  or not has_function_privilege('service_role','studio.studio_request_video_assembly(text,text,text,uuid,jsonb)','EXECUTE') then raise exception 'Unsafe video assembly grants'; end if;

 insert into studio.studio_records(location_id,id,kind,title,payload) values
  (w,rec,'content','Launch video','{"script":"Welcome.\n\nThanks."}'),(w,rec2,'content','No script','{"stage":"idea"}'),(w,rec3,'content','Other script','{"script":"Hi."}');
 insert into studio.studio_media_objects(id,location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
  values(gen_random_uuid(),w,bucket,w||'/uploads/'||up::text||'/original','shot.mp4','video/mp4',5000,repeat('1',64),'va-owner') returning id into mo;
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,media_object_id,uploaded_at,created_by_clerk_user_id)
  values(up,w,rec,'shot.mp4','video/mp4',5000,bucket,w||'/uploads/'||up::text||'/original','uploaded',mo,now(),'va-owner');

 -- Admission fences.
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','va-owner',%L,'{"voiceover":true}')$q$,w,rec2),'VA002') then raise exception 'Script-less content was queued'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','va-owner',%L,'{"bogus":true}')$q$,w,rec),'22023') then raise exception 'Unknown option accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','va-owner',%L,'{}')$q$,w,rec3),'VA004') then raise exception 'Footage-less, voice-less video was queued'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','va-other',%L,'{}')$q$,w2,rec),'VA001') then raise exception 'Another Location queued this record'; end if;
 update studio.studio_devices set report=report||'{"videoAssembly":{"ready":false}}' where id=d;
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','va-owner',%L,'{}')$q$,w,rec),'VA013') then raise exception 'Not-ready Mac accepted'; end if;
 update studio.studio_devices set report=report||'{"videoAssembly":{"ready":true}}' where id=d;

 r:=studio.studio_request_video_assembly(w,'substo','va-owner',rec,'{"voiceover":true,"music":false,"portrait":false}');
 j:=(r->>'jobId')::uuid;
 if r->>'reused' is distinct from 'false' or (select payload#>>'{media,0,name}' from studio.studio_jobs where id=j) is distinct from 'shot.mp4'
  or (select payload->>'script' from studio.studio_jobs where id=j) is distinct from E'Welcome.\n\nThanks.' then raise exception 'Payload snapshot wrong'; end if;
 if (studio.studio_request_video_assembly(w,'substo','va-owner',rec,'{}')->>'reused') is distinct from 'true' then raise exception 'Active job was not reused'; end if;

 -- Claim fences: not-ready claim gets nothing; another Mac cannot claim it; the owner can.
 if jsonb_array_length(pg_temp.claim(h1,false))<>0 then raise exception 'Claimed while not ready'; end if;
 if jsonb_array_length(pg_temp.claim(repeat('c',64)))<>0 then raise exception 'Another Location Mac claimed the job'; end if;
 c:=pg_temp.claim(h1);
 if jsonb_array_length(c)<>1 or c#>>'{0,kind}' is distinct from 'studio.video_assemble' then raise exception 'Claim failed'; end if;
 tok:=(c#>>'{0,lease_token}')::uuid;

 -- Export: wrong lease refused, then reserve -> verify binds a normal upload and the job completes.
 if not pg_temp.fails(format($q$select studio.studio_video_assembly_device_command(%L,'substo','video_export_reserve',jsonb_build_object('workerId','mac','jobId',%L,'leaseToken',%L,'sha256',%L,'byteSize',2000),null,jsonb_build_object('bucket',%L))$q$,h1,j,gen_random_uuid(),sha,bucket),'40001') then raise exception 'Reserve accepted a stale lease'; end if;
 r:=studio.studio_video_assembly_device_command(h1,'substo','video_export_reserve',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'sha256',sha,'byteSize',2000),null,jsonb_build_object('bucket',bucket));
 if r->>'state'<>'reserved' or r->>'objectKey' !~ ('^'||w||'/uploads/[0-9a-f-]{36}/original$') then raise exception 'Reserve result wrong'; end if;
 if not pg_temp.fails(format($q$select studio.studio_video_assembly_device_command(%L,'substo','video_export_verify',jsonb_build_object('workerId','mac','jobId',%L,'leaseToken',%L),null,jsonb_build_object('bucket',%L,'sha256',%L,'byteSize',1999))$q$,h1,j,tok,bucket,sha),'22023') then raise exception 'Verify accepted different bytes'; end if;
 if not pg_temp.fails(format($q$select studio.studio_video_assembly_device_command(%L,'substo','complete',jsonb_build_object('workerId','mac','jobId',%L,'leaseToken',%L,'result',jsonb_build_object('assembly',jsonb_build_object('uploadId',%L))))$q$,h1,j,tok,r->>'uploadId'),'22023') then raise exception 'Completed before the export was verified'; end if;
 r:=studio.studio_video_assembly_device_command(h1,'substo','video_export_verify',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok),null,jsonb_build_object('bucket',bucket,'sha256',sha,'byteSize',2000));
 if r->>'state'<>'verified' or not exists(select 1 from studio.studio_uploads u where u.id=(r->>'uploadId')::uuid and u.record_id=rec and u.status='uploaded' and u.media_object_id is not null and u.original_filename like 'Edited video %') then raise exception 'Export was not saved as an upload'; end if;
 if not pg_temp.fails(format($q$select studio.studio_video_assembly_device_command(%L,'substo','complete',jsonb_build_object('workerId','mac','jobId',%L,'leaseToken',%L,'result',jsonb_build_object('assembly',jsonb_build_object('evil','x'))))$q$,h1,j,tok),'22023') then raise exception 'Unknown result key accepted'; end if;
 c:=studio.studio_video_assembly_device_command(h1,'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('assembly',jsonb_build_object('uploadId',r->>'uploadId','bytes',2000,'summary','ok'))));
 if c is distinct from 'true'::jsonb or (select status from studio.studio_jobs where id=j)<>'succeeded' then raise exception 'Complete failed: %',c; end if;

 -- A footage upload excludes earlier exports, and a new request is allowed once the first finished.
 r:=studio.studio_request_video_assembly(w,'substo','va-owner',rec,'{}');
 if jsonb_array_length((select payload->'media' from studio.studio_jobs where id=(r->>'jobId')::uuid))<>1 then raise exception 'Export counted as footage'; end if;

 -- Revoking processing cancels the queued job.
 update studio.studio_devices set processing_enabled=false where id=d;
 if (select status from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'cancelled' then raise exception 'Queued assembly survived consent withdrawal'; end if;
end $$;
