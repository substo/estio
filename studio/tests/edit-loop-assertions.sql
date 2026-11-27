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
end $$;
create function pg_temp.claim(hash text) returns jsonb language sql as $$
 select studio.studio_video_assembly_device_command(hash,'substo','claim',jsonb_build_object('workerId','mac','limit',1,'leaseSeconds',120,'assembleReady',true))
$$;
create function pg_temp.fails(sql text,code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then if sqlstate<>code then raise notice 'got % % wanted %',sqlstate,sqlerrm,code; end if; return sqlstate=code; end $$;
create function pg_temp.complete(hash text,j uuid,tok uuid,result jsonb) returns jsonb language sql as $$
 select studio.studio_video_assembly_device_command(hash,'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',result))
$$;
do $$
declare w text:='ae000000-0000-4000-8000-0000000000b1'; w2 text:='ae000000-0000-4000-8000-0000000000b2';
 d uuid; d2 uuid; rec uuid:=gen_random_uuid(); rec2 uuid:=gen_random_uuid(); up uuid:=gen_random_uuid(); mo uuid; r jsonb; c jsonb; ja uuid; je uuid; jo uuid; tok uuid; st jsonb; run uuid;
 h1 text:=repeat('a',64); h2 text:=repeat('c',64); bucket text:='studio-test-bucket';
begin
 perform studio.studio_create_substo_location(w,'Loop fixture','el-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','el-other');
 d:=pg_temp.pair(w,'el-owner','TVCAAAAA',h1);
 d2:=pg_temp.pair(w2,'el-other','TVCBBBBB',h2);
 if not exists(select 1 from studio.studio_devices where id=d and allowed_kinds @> ARRAY['studio.video_edit','studio.open_editor','studio.voice_preview','studio.video_assemble']) then raise exception 'Processing On did not grant the loop kinds'; end if;
 if exists(select 1 from studio.studio_devices where id=d and processing_enabled=false) then raise exception 'fixture'; end if;
 if has_function_privilege('authenticated','studio.studio_request_video_edit(text,text,text,uuid,text)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_request_open_editor(text,text,text,uuid)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_video_loop_state(text,text,text,uuid)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_begin_narration_run(text,text,text,uuid,integer)','EXECUTE')
  or has_table_privilege('authenticated','studio.studio_video_edit_messages','SELECT')
  or has_table_privilege('authenticated','studio.studio_narration_runs','SELECT')
  or not has_function_privilege('service_role','studio.studio_request_video_edit(text,text,text,uuid,text)','EXECUTE') then raise exception 'Unsafe loop grants'; end if;

 insert into studio.studio_records(location_id,id,kind,title,payload) values (w,rec,'content','Launch video','{"script":"Welcome.\n\nThanks."}'),(w,rec2,'content','Never edited','{"script":"Hi."}');
 insert into studio.studio_media_objects(id,location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
  values(gen_random_uuid(),w,bucket,w||'/uploads/'||up::text||'/original','shot.mp4','video/mp4',5000,repeat('1',64),'el-owner') returning id into mo;
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,media_object_id,uploaded_at,created_by_clerk_user_id)
  values(up,w,rec,'shot.mp4','video/mp4',5000,bucket,w||'/uploads/'||up::text||'/original','uploaded',mo,now(),'el-owner');

 -- Nothing to edit or open before a kept edit exists.
 if not pg_temp.fails(format($q$select studio.studio_request_video_edit(%L,'substo','el-owner',%L,'make it shorter')$q$,w,rec2),'VE003') then raise exception 'Edit queued without a kept project'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_open_editor(%L,'substo','el-owner',%L)$q$,w,rec2),'VE003') then raise exception 'Open queued without a kept project'; end if;

 -- First edit: assemble and complete, saying the Mac kept the project.
 r:=studio.studio_request_video_assembly(w,'substo','el-owner',rec,'{"voiceover":false,"music":false,"portrait":false}');
 ja:=(r->>'jobId')::uuid; c:=pg_temp.claim(h1); tok:=(c#>>'{0,lease_token}')::uuid;
 if jsonb_array_length(c)<>1 or c#>>'{0,kind}' is distinct from 'studio.video_assemble' then raise exception 'Assemble claim failed'; end if;
 if pg_temp.complete(h1,ja,tok,'{"assembly":{"summary":"First cut","projectKept":true,"projectName":"Launch-video-abc"}}') is distinct from 'true'::jsonb then raise exception 'Assemble complete failed'; end if;
 if not pg_temp.fails(format($q$select pg_temp.complete(%L,%L,%L,'{"assembly":{"summary":"x","projectKept":"yes"}}')$q$,h1,ja,tok),'22023') and (select status from studio.studio_jobs where id=ja)<>'succeeded' then raise exception 'Non-boolean projectKept accepted'; end if;
 st:=studio.studio_video_loop_state(w,'substo','el-owner',rec);
 if st->>'projectKept' is distinct from 'true' or (st->>'busy')<>'false' or jsonb_array_length(st->'thread')<>0 then raise exception 'Loop state after first edit wrong: %',st; end if;

 -- Edit fences.
 if not pg_temp.fails(format($q$select studio.studio_request_video_edit(%L,'substo','el-owner',%L,'   ')$q$,w,rec),'VE002') then raise exception 'Empty instruction accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_edit(%L,'substo','el-owner',%L,%L)$q$,w,rec,repeat('x',1001)),'VE002') then raise exception 'Oversized instruction accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_edit(%L,'substo','el-other',%L,'shorter')$q$,w2,rec),'VE001') then raise exception 'Another Location edited this record'; end if;
 update studio.studio_devices set report=report||'{"videoAssembly":{"ready":false}}' where id=d;
 if not pg_temp.fails(format($q$select studio.studio_request_video_edit(%L,'substo','el-owner',%L,'shorter')$q$,w,rec),'VE013') then raise exception 'Not-ready Mac accepted'; end if;
 update studio.studio_devices set report=jsonb_build_object('handlers',jsonb_build_array('studio.video_assemble'),'videoAssembly',jsonb_build_object('ready',true)) where id=d;
 if not pg_temp.fails(format($q$select studio.studio_request_video_edit(%L,'substo','el-owner',%L,'shorter')$q$,w,rec),'VE014') then raise exception 'Outdated companion accepted'; end if;
 update studio.studio_devices set report=jsonb_build_object('handlers',jsonb_build_array('studio.video_assemble','studio.video_edit','studio.open_editor'),'videoAssembly',jsonb_build_object('ready',true)) where id=d;

 -- Queue an edit with history; a second one while it is active is refused.
 r:=studio.studio_request_video_edit(w,'substo','el-owner',rec,'Make the intro shorter');
 je:=(r->>'jobId')::uuid;
 if (select payload->>'instruction' from studio.studio_jobs where id=je) is distinct from 'Make the intro shorter' or (select execution_target from studio.studio_jobs where id=je)<>'device' then raise exception 'Edit payload wrong'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_edit(%L,'substo','el-owner',%L,'and louder')$q$,w,rec),'VE004') then raise exception 'Two edits ran at once'; end if;
 if (studio.studio_video_loop_state(w,'substo','el-owner',rec)->>'busy')<>'true' then raise exception 'Busy flag missing'; end if;
 if jsonb_array_length(pg_temp.claim(h2))<>0 then raise exception 'Another Location Mac claimed the edit'; end if;

 -- Reading state recovers an expired Mac lease even when no new claim arrives after a deploy.
 c:=pg_temp.claim(h1); tok:=(c#>>'{0,lease_token}')::uuid;
 update studio.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=je;
 st:=studio.studio_video_loop_state(w,'substo','el-owner',rec);
 if st->>'busy'<>'false' or st->>'retryJobId' is distinct from je::text or (select status from studio.studio_jobs where id=je)<>'failed'
  or (select last_error_code from studio.studio_jobs where id=je)<>'worker_report_timeout' then raise exception 'Expired edit was not made visibly retryable: %',st; end if;
 perform studio.studio_member_job_action(w,'substo','el-owner',je,'retry');

 -- The Mac claims and completes it; no export is needed to finish an edit, and the reply is read from the job.
 c:=pg_temp.claim(h1); tok:=(c#>>'{0,lease_token}')::uuid;
 if c#>>'{0,kind}' is distinct from 'studio.video_edit' then raise exception 'Edit claim wrong: %',c; end if;
 if pg_temp.complete(h1,je,tok,'{"assembly":{"summary":"Trimmed the intro by 4 s","projectKept":true}}') is distinct from 'true'::jsonb then raise exception 'Edit complete failed'; end if;
 st:=studio.studio_video_loop_state(w,'substo','el-owner',rec);
 if jsonb_array_length(st->'thread')<>1 or st#>>'{thread,0,reply}' is distinct from 'Trimmed the intro by 4 s' or st#>>'{thread,0,status}' is distinct from 'succeeded' then raise exception 'Thread wrong: %',st; end if;
 r:=studio.studio_request_video_edit(w,'substo','el-owner',rec,'Now add a whoosh');
 if jsonb_array_length((select payload->'history' from studio.studio_jobs where id=(r->>'jobId')::uuid))<>1 then raise exception 'History not carried'; end if;
 update studio.studio_jobs set status='cancelled',finished_at=now() where id=(r->>'jobId')::uuid;

 -- Open in editor: dedup, claim, strict result shape, no export for this kind.
 r:=studio.studio_request_open_editor(w,'substo','el-owner',rec); jo:=(r->>'jobId')::uuid;
 if (studio.studio_request_open_editor(w,'substo','el-owner',rec)->>'reused')<>'true' then raise exception 'Active open job was not reused'; end if;
 c:=pg_temp.claim(h1); tok:=(c#>>'{0,lease_token}')::uuid;
 if c#>>'{0,kind}' is distinct from 'studio.open_editor' or (c#>>'{0,payload}')::jsonb ? 'path' then raise exception 'Open claim wrong'; end if;
 if not pg_temp.fails(format($q$select studio.studio_video_assembly_device_command(%L,'substo','video_export_reserve',jsonb_build_object('workerId','mac','jobId',%L,'leaseToken',%L,'sha256',%L,'byteSize',2000),null,jsonb_build_object('bucket',%L))$q$,h1,jo,tok,repeat('b',64),bucket),'22023') then raise exception 'Open job could reserve an export'; end if;
 if not pg_temp.fails(format($q$select pg_temp.complete(%L,%L,%L,'{"editor":{"opened":true,"path":"/Users/x"}}')$q$,h1,jo,tok),'22023') then raise exception 'Editor result with a path accepted'; end if;
 if pg_temp.complete(h1,jo,tok,'{"editor":{"opened":true,"projectName":"Launch-video-abc"}}') is distinct from 'true'::jsonb then raise exception 'Open complete failed'; end if;
 if (studio.studio_video_loop_state(w,'substo','el-owner',rec)#>>'{openEditor,status}') is distinct from 'succeeded' then raise exception 'Open status missing'; end if;

 -- Narration progress: begin, reuse, progress, finish, stale detection, tenant isolation.
 r:=studio.studio_begin_narration_run(w,'substo','el-owner',rec,6); run:=(r->>'runId')::uuid;
 if (studio.studio_begin_narration_run(w,'substo','el-owner',rec,6)->>'reused')<>'true' then raise exception 'Running narration was not reused'; end if;
 perform studio.studio_narration_progress(w,run,3);
 perform studio.studio_narration_progress(w,run,2);
 st:=studio.studio_narration_state(w,'substo','el-owner',rec);
 if st->>'status'<>'running' or (st->>'done')::int<>3 or (st->>'total')::int<>6 then raise exception 'Progress wrong or went backwards: %',st; end if;
 perform studio.studio_narration_progress(w2,run,6);
 if ((studio.studio_narration_state(w,'substo','el-owner',rec))->>'done')::int<>3 then raise exception 'Another Location moved progress'; end if;
 update studio.studio_narration_runs set updated_at=now()-interval '21 minutes' where id=run;
 if (studio.studio_narration_state(w,'substo','el-owner',rec)->>'status')<>'failed' then raise exception 'Stale run still running'; end if;
 r:=studio.studio_begin_narration_run(w,'substo','el-owner',rec,2); run:=(r->>'runId')::uuid;
 if r->>'reused'<>'false' then raise exception 'Stale run blocked a new one'; end if;
 perform studio.studio_finish_narration_run(w,run,true,null,ja);
 st:=studio.studio_narration_state(w,'substo','el-owner',rec);
 if st->>'status'<>'done' or (st->>'done')::int<>2 or st->>'jobId'<>ja::text then raise exception 'Finish wrong: %',st; end if;
 if not pg_temp.fails(format($q$select studio.studio_begin_narration_run(%L,'substo','el-other',%L,2)$q$,w2,rec),'VA001') then raise exception 'Another Location began narration for this record'; end if;

 -- Revoking processing cancels queued loop jobs.
 r:=studio.studio_request_video_edit(w,'substo','el-owner',rec,'One more change');
 update studio.studio_devices set processing_enabled=false where id=d;
 if (select status from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'cancelled' then raise exception 'Queued edit survived consent withdrawal'; end if;
end $$;
