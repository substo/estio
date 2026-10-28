-- Synthetic fixtures only; helper mimics the normalized wrapper contract.
create function pg_temp.schedule_manifest(s jsonb) returns jsonb language sql as $$
 select jsonb_build_object('schema','studio.legacy-schedules.v1','mode','dry-run','valid',true,
   'executionEnabled',false,'applySupported',false,'snapshotCheckedUnchanged',true,
   'sourceCanonicalJson',s::text,'sourceDigest',encode(sha256(convert_to(s::text,'UTF8')),'hex'),
   'schedules',(select coalesce(jsonb_agg(jsonb_build_object('sourceIndex',ordinality-1,'id',lower(value->>'id'),'payload',value,
     'draft',jsonb_build_object('presetId',value->'presetId','query',value->'query','intervalHours',value->'intervalHours','dailyTime',value->'dailyTime')) order by ordinality),'[]') from jsonb_array_elements(s->'schedules') with ordinality),
   'runs',(select coalesce(jsonb_agg(jsonb_build_object('sourceIndex',ordinality-1,'id',lower(value->>'id'),'scheduleId',lower(value->>'scheduleId'),'payload',value) order by ordinality),'[]') from jsonb_array_elements(s->'runs') with ordinality),
   'counts',jsonb_build_object('schedules',jsonb_array_length(s->'schedules'),'runs',jsonb_array_length(s->'runs'),
     'legacyEnabled',(select count(*) from jsonb_array_elements(s->'schedules') r where r->'enabled'='true'::jsonb),
     'discovery',(select count(*) from jsonb_array_elements(s->'schedules') r where r->>'presetId'='youtube-discovery'),
     'inFlightRuns',(select count(*) from jsonb_array_elements(s->'runs') r where r->>'status' in ('running','queued'))),
   'issues','[]'::jsonb,'sourceFiles',jsonb_build_array(jsonb_build_object('relativePath','schedules.json','bytes',octet_length(s::text),'sha256',encode(sha256(convert_to(s::text,'UTF8')),'hex'))));
$$;
do $$
declare
 w text := '83000000-0000-4000-8000-000000000001';
 other_w text := '83000000-0000-4000-8000-000000000002';
 estio_w text := '83000000-0000-4000-8000-000000000003';
 sid uuid := '84000000-0000-4000-8000-000000000001';
 rid uuid := '85000000-0000-4000-8000-000000000001';
 source jsonb; manifest jsonb; changed jsonb; result jsonb; replay jsonb; raw jsonb;
 relation text; role_name text; operation text;
begin
 foreach relation in array array['studio_schedule_import_runs','studio_schedule_legacy_definitions','studio_schedule_legacy_runs'] loop
   if not (select relrowsecurity from pg_class where oid=('studio.'||relation)::regclass) then raise exception 'Missing schedule import RLS'; end if;
   foreach role_name in array array['anon','authenticated','service_role'] loop
     foreach operation in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
       if has_table_privilege(role_name,'studio.'||relation,operation) then raise exception 'Unsafe direct schedule import mutation'; end if;
     end loop;
     if has_table_privilege(role_name,'studio.'||relation,'SELECT') is distinct from (role_name='service_role') then raise exception 'Unsafe schedule import reads'; end if;
   end loop;
 end loop;
 if has_function_privilege('anon','studio.studio_import_schedules(text,text,jsonb,text)','EXECUTE')
   or has_function_privilege('authenticated','studio.studio_import_schedules(text,text,jsonb,text)','EXECUTE')
   or not has_function_privilege('service_role','studio.studio_import_schedules(text,text,jsonb,text)','EXECUTE') then raise exception 'Unsafe schedule import RPC grants'; end if;
 perform studio.studio_create_substo_location(w,'Import schedule fixture','schedule-import-owner');
 perform studio.studio_create_substo_location(other_w,'Other fixture','other-owner');
 insert into studio.studio_locations(location_id,app,name)
   values(estio_w,'estio','Estio fixture');
 source := jsonb_build_object('version',1,'unknownTop',jsonb_build_object('preserved',true),
   'schedules',jsonb_build_array(jsonb_build_object('id',sid,'presetId','youtube-discovery','query','  exact focus  ',
     'intervalHours',24,'dailyTime','09:00','timeZone','Asia/Nicosia','enabled',true,'autoKnowledgeScan',true,
     'createdAt','2026-01-01T00:00:00.000Z','updatedAt','2026-01-02T00:00:00.000Z','nextRunAt','2026-01-03T07:00:00.000Z',
     'channelTargets',jsonb_build_array(jsonb_build_object('role','owner','url','https://www.youtube.com/@example','title','owner')))),
   'runs',jsonb_build_array(jsonb_build_object('id',rid,'scheduleId',sid,'presetId','idea-review','status','running',
     'startedAt','2026-01-02T07:00:00.000Z','completedAt',null,'output',E' exact output\n transcript/citations ','error',E' exact stderr\n','jobId','local-job')));
 manifest := pg_temp.schedule_manifest(source);
 begin perform studio.studio_import_schedules(estio_w,manifest->>'sourceDigest',manifest,'schedule-import-owner'); raise exception 'Estio target accepted'; exception when insufficient_privilege then null; end;
 begin perform studio.studio_import_schedules(w,manifest->>'sourceDigest',manifest,'other-owner'); raise exception 'Wrong owner accepted'; exception when insufficient_privilege then null; end;
 changed := jsonb_set(manifest,'{schedules,0,draft,query}','"tampered"');
 begin perform studio.studio_import_schedules(w,changed->>'sourceDigest',changed,'schedule-import-owner'); raise exception 'Tampered draft accepted'; exception when invalid_parameter_value then null; end;
 if exists(select 1 from studio.studio_schedule_import_runs where location_id=w) then raise exception 'Failed projection left ledger'; end if;
 changed := jsonb_set(manifest,'{counts,runs}','99');
 begin perform studio.studio_import_schedules(w,changed->>'sourceDigest',changed,'schedule-import-owner'); raise exception 'False counts accepted'; exception when invalid_parameter_value then null; end;
 begin perform studio.studio_import_schedules(w,repeat('0',64),jsonb_set(manifest,'{sourceDigest}',to_jsonb(repeat('0',64))),'schedule-import-owner'); raise exception 'Bad digest accepted'; exception when invalid_parameter_value then null; end;

 -- Failure after definitions are inserted must roll back drafts, raw rows and ledger.
 changed := pg_temp.schedule_manifest(jsonb_set(source,'{runs,0,scheduleId}',to_jsonb('84000000-0000-4000-8000-000000000099'::text)));
 begin perform studio.studio_import_schedules(w,changed->>'sourceDigest',changed,'schedule-import-owner'); raise exception 'Orphan history accepted'; exception when foreign_key_violation then null; end;
 if exists(select 1 from studio.studio_schedules where location_id=w)
   or exists(select 1 from studio.studio_schedule_legacy_definitions where location_id=w)
   or exists(select 1 from studio.studio_schedule_import_runs where location_id=w) then raise exception 'Partial schedule import survived'; end if;
 changed := pg_temp.schedule_manifest(jsonb_set(source,'{runs,0,startedAt}','"2026-02-31T00:00:00Z"'));
 begin perform studio.studio_import_schedules(w,changed->>'sourceDigest',changed,'schedule-import-owner'); raise exception 'Invalid timestamp accepted'; exception when invalid_parameter_value then null; end;

 result := studio.studio_import_schedules(w,manifest->>'sourceDigest',manifest,'schedule-import-owner');
 if result->'counts' is distinct from manifest->'counts' or result->'executionEnabled' is distinct from 'false'::jsonb or result->'replayed' <> 'false'::jsonb
   or (select payload from studio.studio_schedule_legacy_definitions where location_id=w and id=sid) is distinct from source->'schedules'->0
   or (select payload from studio.studio_schedule_legacy_runs where location_id=w and id=rid) is distinct from source->'runs'->0
   or (select preview_evidence->'sourceFiles' from studio.studio_schedule_import_runs where location_id=w) is distinct from manifest->'sourceFiles'
   or (select source_canonical_json from studio.studio_schedule_import_runs where location_id=w)::jsonb is distinct from source
   or (select created_at from studio.studio_schedules where location_id=w and id=sid) <> '2026-01-01T00:00:00Z'::timestamptz then raise exception 'Schedule fidelity/counts failed'; end if;
 perform studio.studio_save_schedule(w,sid,1,'substo','schedule-import-owner','script-brief','hosted edit',168,'10:00');
 replay := studio.studio_import_schedules(w,manifest->>'sourceDigest',manifest,'schedule-import-owner');
 if replay->'replayed' <> 'true'::jsonb or replay->'runId' is distinct from result->'runId'
   or (select focus from studio.studio_schedules where location_id=w and id=sid) <> 'hosted edit'
   or (select version from studio.studio_schedules where location_id=w and id=sid) <> 2 then raise exception 'Replay overwrote hosted draft'; end if;
 changed := jsonb_set(manifest,'{sourceFiles,0,bytes}','999');
 begin perform studio.studio_import_schedules(w,changed->>'sourceDigest',changed,'schedule-import-owner'); raise exception 'Different manifest replay accepted'; exception when unique_violation then null; end;
 changed := pg_temp.schedule_manifest(jsonb_set(source,'{unknownTop,preserved}','false'));
 begin perform studio.studio_import_schedules(w,changed->>'sourceDigest',changed,'schedule-import-owner'); raise exception 'New overlapping snapshot overwrote drafts'; exception when unique_violation then null; end;
 if (select count(*) from studio.studio_schedule_import_runs where location_id=w) <> 1 then raise exception 'Conflict left ledger'; end if;

 -- Same IDs in another authorized location are independent, and cannot be linked across locations/imports.
 perform studio.studio_import_schedules(other_w,manifest->>'sourceDigest',manifest,'other-owner');
 begin
   insert into studio.studio_schedule_legacy_runs(location_id,id,schedule_id,import_run_id,source_index,payload)
     values(w,'85000000-0000-4000-8000-000000000099',sid,
       (select id from studio.studio_schedule_import_runs where location_id=other_w),99,source->'runs'->0);
   raise exception 'Cross-location history FK accepted';
 exception when foreign_key_violation then null; end;
 delete from studio.studio_location_members where location_id=w and clerk_user_id='schedule-import-owner';
 begin perform studio.studio_import_schedules(w,manifest->>'sourceDigest',manifest,'schedule-import-owner'); raise exception 'Revoked owner replay accepted'; exception when insufficient_privilege then null; end;
end;
$$;
select 'Studio schedule import assertions passed' as result;
