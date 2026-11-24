-- Real SQL against an isolated PostgreSQL cluster. No credentials, network or providers.
create function pg_temp.pair(w text,actor text,code text,hash text) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,seen_at=clock_timestamp(),
  report=jsonb_build_object('handlers',jsonb_build_array('studio.video_assemble','studio.video_edit','studio.open_editor'),'videoAssembly',jsonb_build_object('ready',true)) where id=d;
 return d;

 raise notice 'workspace timeline assertions ok';
end $$;
create function pg_temp.claim(hash text) returns jsonb language sql as $$
 select studio.studio_video_assembly_device_command(hash,'substo','claim',jsonb_build_object('workerId','mac','limit',1,'leaseSeconds',120,'assembleReady',true))
$$;
create function pg_temp.fails(sql text,code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then if sqlstate<>code then raise notice 'got % % wanted %',sqlstate,sqlerrm,code; end if; return sqlstate=code; 
 raise notice 'workspace timeline assertions ok';
end $$;
create function pg_temp.complete(hash text,j uuid,tok uuid,result jsonb) returns jsonb language sql as $$
 select studio.studio_video_assembly_device_command(hash,'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',result))
$$;
create function pg_temp.timeline(clips integer,label_len integer) returns jsonb language sql as $$
 select jsonb_build_object('d',60,'tracks',jsonb_build_array(jsonb_build_object('n','Text','k','video','c',
  (select coalesce(jsonb_agg(jsonb_build_object('s',i,'e',i+1,'l',repeat('x',label_len),'k','text')),'[]'::jsonb) from generate_series(1,clips) i))))
$$;
do $$
declare w text:='ae000000-0000-4000-8000-0000000000c1'; d uuid; rec uuid:=gen_random_uuid(); up uuid:=gen_random_uuid(); mo uuid;
 r jsonb; c jsonb; ja uuid; tok uuid; st jsonb; h1 text:=repeat('a',64); bucket text:='studio-test-bucket';
begin
 perform studio.studio_create_substo_location(w,'Workspace fixture','el-owner');
 d:=pg_temp.pair(w,'el-owner','TWSAAAAA',h1);
 insert into studio.studio_records(location_id,id,kind,title,payload) values (w,rec,'content','Launch video','{"script":"Welcome.\n\nThanks."}');
 insert into studio.studio_media_objects(id,location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
  values(gen_random_uuid(),w,bucket,w||'/uploads/'||up::text||'/original','shot.mp4','video/mp4',5000,repeat('1',64),'el-owner') returning id into mo;
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,media_object_id,uploaded_at,created_by_clerk_user_id)
  values(up,w,rec,'shot.mp4','video/mp4',5000,bucket,w||'/uploads/'||up::text||'/original','uploaded',mo,now(),'el-owner');
 r:=studio.studio_request_video_assembly(w,'substo','el-owner',rec,'{"voiceover":false,"music":false,"portrait":false}');
 ja:=(r->>'jobId')::uuid; c:=pg_temp.claim(h1); tok:=(c#>>'{0,lease_token}')::uuid;
 -- The Mac's export is verified (simulated exactly as the export steps leave the payload), then the result carries a timeline.
 up:=gen_random_uuid();
 insert into studio.studio_media_objects(id,location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
  values(gen_random_uuid(),w,bucket,w||'/uploads/'||up::text||'/original','Edited video 2026-11-23 1325.mp4','video/mp4',9000,repeat('2',64),'el-owner') returning id into mo;
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,media_object_id,uploaded_at,created_by_clerk_user_id)
  values(up,w,rec,'Edited video 2026-11-23 1325.mp4','video/mp4',9000,bucket,w||'/uploads/'||up::text||'/original','uploaded',mo,now(),'el-owner');
 update studio.studio_jobs set payload=payload||jsonb_build_object('export',jsonb_build_object('uploadId',up,'state','verified')) where id=ja;

 -- Shape and size fences (statement-level, so a rejected result leaves the job running).
 if not pg_temp.fails(format($q$select pg_temp.complete(%L,%L,%L,%L::jsonb)$q$,h1,ja,tok,jsonb_build_object('assembly',jsonb_build_object('summary','x','timeline','"nope"'::jsonb,'uploadId',up))::text),'22023') then raise exception 'Non-object timeline accepted'; end if;
 if not pg_temp.fails(format($q$select pg_temp.complete(%L,%L,%L,%L::jsonb)$q$,h1,ja,tok,jsonb_build_object('assembly',jsonb_build_object('summary','x','timeline',jsonb_build_object('d',1,'tracks','{}'::jsonb),'uploadId',up))::text),'22023') then raise exception 'Timeline without a tracks array accepted'; end if;
 if not pg_temp.fails(format($q$select pg_temp.complete(%L,%L,%L,%L::jsonb)$q$,h1,ja,tok,jsonb_build_object('assembly',jsonb_build_object('summary','x','timeline',pg_temp.timeline(400,80),'uploadId',up))::text),'22023') then raise exception 'Oversized timeline accepted'; end if;
 if not pg_temp.fails(format($q$select pg_temp.complete(%L,%L,%L,%L::jsonb)$q$,h1,ja,tok,jsonb_build_object('assembly',jsonb_build_object('summary','x','bogus',true))::text),'22023') then raise exception 'Unknown assembly key accepted'; end if;
 if (select status from studio.studio_jobs where id=ja)<>'running' then raise exception 'Rejected results ended the job'; end if;

 -- A bounded timeline completes the job and is returned with its version and as the latest.
 if pg_temp.complete(h1,ja,tok,jsonb_build_object('assembly',jsonb_build_object('summary','Draft','projectKept',true,'uploadId',up,'timeline',pg_temp.timeline(150,28)))) is distinct from 'true'::jsonb then raise exception 'Timeline result rejected'; end if;
 st:=studio.studio_video_loop_state(w,'substo','el-owner',rec);
 if jsonb_array_length(st->'versions')<>1 or jsonb_array_length(st#>'{versions,0,timeline,tracks,0,c}')<>150 then raise exception 'Version timeline missing: %',left(st::text,300); end if;
 -- Without a timeline (older Mac) the version simply has none.
 if (select count(*) from studio.studio_jobs where result#>'{assembly,timeline}' is not null)<>1 then raise exception 'Timeline stored wrongly'; end if;

 raise notice 'workspace timeline assertions ok';
end $$;
