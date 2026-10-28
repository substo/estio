do $$
declare
  a text := '40000000-0000-0000-0000-000000000001';
  b text := '40000000-0000-0000-0000-000000000002';
  e text := '40000000-0000-0000-0000-000000000003';
  r uuid := '50000000-0000-0000-0000-000000000001';
  c uuid := '50000000-0000-0000-0000-000000000002';
  t uuid := '50000000-0000-0000-0000-000000000003';
  n uuid := '50000000-0000-0000-0000-000000000004';
  f uuid := '60000000-0000-0000-0000-000000000001';
  snapshot jsonb;
  changed jsonb;
  raw_snapshot jsonb;
  raw_text text;
  result jsonb;
  initial_run text;
begin
  if has_function_privilege('anon','studio.studio_import_library(text,text,jsonb,text)','EXECUTE')
    or has_table_privilege('authenticated','studio.studio_library_import_runs','SELECT') then
    raise exception 'Client can access import surface';
  end if;
  perform studio.studio_create_substo_location(a,'Import A','import-owner-a');
  perform studio.studio_create_substo_location(b,'Import B','import-owner-b');
  insert into studio.studio_locations(location_id,app,name)
    values(e,'estio','Import Estio');
  snapshot := pg_catalog.jsonb_build_object(
    'schema','studio.legacy-library.v1','mode','dry-run','valid',true,'mediaReady',true,
    'records',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',r,'kind','reference','title','Source','linkedIds',pg_catalog.jsonb_build_array(c),
        'payload',pg_catalog.jsonb_build_object('id',r,'kind','reference','title','Source','linkedIds',pg_catalog.jsonb_build_array(c),'transcript',E'Words\nexactly','approved',true)),
      pg_catalog.jsonb_build_object('id',c,'kind','channel','title','Channel','linkedIds','[]'::jsonb,
        'payload',pg_catalog.jsonb_build_object('id',c,'kind','channel','title','Channel')),
      pg_catalog.jsonb_build_object('id',t,'kind','content','title','Script','linkedIds',pg_catalog.jsonb_build_array(r),
        'payload',pg_catalog.jsonb_build_object('id',t,'kind','content','title','Script','linkedIds',pg_catalog.jsonb_build_array(r),'script','Untouched words'))),
    'files',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',f,'recordId',t,
      'payload',pg_catalog.jsonb_build_object('id',f,'recordId',t,'name','original.mov','size',42,'type','video/quicktime'))),
    'counts','{"records":3,"library":1,"channels":1,"content":1,"files":1,"links":2}'::jsonb);
  raw_snapshot := pg_catalog.jsonb_build_object('version',1,
    'records',pg_catalog.jsonb_build_array(snapshot->'records'->0->'payload',snapshot->'records'->1->'payload',snapshot->'records'->2->'payload'),
    'files',pg_catalog.jsonb_build_array(snapshot->'files'->0->'payload'));
  raw_text := raw_snapshot::text;
  snapshot := pg_catalog.jsonb_set(snapshot,'{sourceCanonicalJson}',pg_catalog.to_jsonb(raw_text),true);
  snapshot := pg_catalog.jsonb_set(snapshot,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(raw_text,'UTF8')),'hex')),true);

  begin
    perform studio.studio_import_library(a,snapshot->>'sourceDigest',snapshot,'wrong-owner');
    raise exception 'Wrong owner imported';
  exception when insufficient_privilege then null; end;
  begin
    perform studio.studio_import_library(e,snapshot->>'sourceDigest',snapshot,'import-owner-a');
    raise exception 'Standalone importer accepted Estio location';
  exception when insufficient_privilege then null; end;

  result := studio.studio_import_library(a,snapshot->>'sourceDigest',snapshot,'import-owner-a');
  initial_run := result->>'runId';
  if result->'counts' <> snapshot->'counts' or result->'replayed' <> 'false'::jsonb
    or (result->>'mediaPending')::int <> 1 then raise exception 'Initial result did not reconcile'; end if;
  if (select count(*) from studio.studio_records where location_id=a) <> 3
    or (select count(*) from studio.studio_record_links where location_id=a) <> 2
    or (select count(*) from studio.studio_legacy_files where location_id=a and media_object_id is null) <> 1 then
    raise exception 'Imported rows did not reconcile';
  end if;
  if (select payload <> legacy_payload from studio.studio_records where location_id=a and id=r) then
    raise exception 'Legacy payload was changed';
  end if;
  perform studio.studio_save_record(a,r,'reference','Hosted edit','{"notes":"New reviewed note"}',1,'import-owner-a');
  result := studio.studio_import_library(a,snapshot->>'sourceDigest',snapshot,'import-owner-a');
  if result->>'runId' <> initial_run or result->'replayed' <> 'true'::jsonb
    or (select version from studio.studio_records where location_id=a and id=r) <> 2
    or (select title from studio.studio_records where location_id=a and id=r) <> 'Hosted edit'
    or (select legacy_payload->>'transcript' from studio.studio_records where location_id=a and id=r) <> E'Words\nexactly' then
    raise exception 'Identical snapshot retry overwrote hosted edits or original evidence';
  end if;

  changed := pg_catalog.jsonb_set(snapshot,'{records,0,title}','"Different"'::jsonb);
  begin
    perform studio.studio_import_library(a,changed->>'sourceDigest',changed,'import-owner-a');
    raise exception 'Changed normalized projection accepted against pinned source';
  exception when invalid_parameter_value then null; end;

  changed := pg_catalog.jsonb_set(snapshot,'{records,0,payload,transcript}','"Edited transcript"'::jsonb);
  begin
    perform studio.studio_import_library(a,changed->>'sourceDigest',changed,'import-owner-a');
    raise exception 'Consistently edited payload accepted against old source digest';
  exception when invalid_parameter_value then null; end;

  changed := pg_catalog.jsonb_set(snapshot,'{sourceCanonicalJson}',pg_catalog.to_jsonb(raw_text || ' '));
  begin
    perform studio.studio_import_library(a,changed->>'sourceDigest',changed,'import-owner-a');
    raise exception 'Stale digest accepted changed canonical snapshot';
  exception when invalid_parameter_value then null; end;

  changed := pg_catalog.jsonb_set(snapshot,'{records}',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('id',n,'kind','reference','title','Must rollback','linkedIds','[]'::jsonb,
      'payload',pg_catalog.jsonb_build_object('id',n,'kind','reference','title','Must rollback'))
  ) || (snapshot->'records'));
  raw_snapshot := pg_catalog.jsonb_build_object('version',1,
    'records',pg_catalog.jsonb_build_array(changed->'records'->0->'payload',changed->'records'->1->'payload',changed->'records'->2->'payload',changed->'records'->3->'payload'),
    'files',pg_catalog.jsonb_build_array(changed->'files'->0->'payload'));
  raw_text := raw_snapshot::text;
  changed := pg_catalog.jsonb_set(changed,'{sourceCanonicalJson}',pg_catalog.to_jsonb(raw_text),true);
  changed := pg_catalog.jsonb_set(changed,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(raw_text,'UTF8')),'hex')),true);
  changed := pg_catalog.jsonb_set(changed,'{counts}', '{"records":4,"library":2,"channels":1,"content":1,"files":1,"links":2}'::jsonb);
  begin
    perform studio.studio_import_library(a,changed->>'sourceDigest',changed,'import-owner-a');
    raise exception 'Different snapshot overwrote an existing record';
  exception when unique_violation then null; end;
  if exists(select 1 from studio.studio_records where location_id=a and id=n)
    or exists(select 1 from studio.studio_library_import_runs where location_id=a and source_digest=changed->>'sourceDigest') then
    raise exception 'Conflict did not roll back the entire snapshot';
  end if;

  -- The same legacy IDs are valid in another location and cannot change A.
  result := studio.studio_import_library(b,snapshot->>'sourceDigest',snapshot,'import-owner-b');
  if result->>'runId'=initial_run or (select title from studio.studio_records where location_id=b and id=r) <> 'Source'
    or (select title from studio.studio_records where location_id=a and id=r) <> 'Hosted edit' then
    raise exception 'Composite location identity was lost';
  end if;

  -- An existing target in a location is insufficient: links must be in this snapshot.
  changed := pg_catalog.jsonb_build_object('schema','studio.legacy-library.v1','sourceDigest',repeat('c',64),
    'mode','dry-run','valid',true,'mediaReady',true,'files','[]'::jsonb,
    'records',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',n,'kind','reference','title','Dangling link',
      'linkedIds',pg_catalog.jsonb_build_array(r),'payload',pg_catalog.jsonb_build_object('id',n,'kind','reference','title','Dangling link','linkedIds',pg_catalog.jsonb_build_array(r)))),
    'counts','{"records":1,"library":1,"channels":0,"content":0,"files":0,"links":1}'::jsonb);
  begin
    perform studio.studio_import_library(b,repeat('c',64),changed,'import-owner-b');
    raise exception 'Snapshot linked an outside record';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from studio.studio_records where location_id=b and id=n) then
    raise exception 'Invalid link left a partial import';
  end if;
  changed := pg_catalog.jsonb_set(changed,'{records,0,linkedIds}','[]'::jsonb);
  changed := pg_catalog.jsonb_set(changed,'{records,0,payload,linkedIds}','[]'::jsonb);
  -- Counts still claim one link: the late reconciliation failure rolls back the row.
  begin
    perform studio.studio_import_library(b,repeat('c',64),changed,'import-owner-b');
    raise exception 'Incorrect declared counts were accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from studio.studio_records where location_id=b and id=n)
    or exists(select 1 from studio.studio_library_import_runs where location_id=b and source_digest=repeat('c',64)) then
    raise exception 'Count mismatch left a partial import or ledger';
  end if;
end;
$$;
select 'Studio import assertions passed' as result;
