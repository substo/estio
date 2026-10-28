do $$
declare
  v_location_id text := '30000000-0000-4000-8000-000000000001';
  v_other_location_id text := '30000000-0000-4000-8000-000000000002';
  v_missing_library_location_id text := '30000000-0000-4000-8000-000000000003';
  source_id uuid := '31000000-0000-4000-8000-000000000001';
  topic_id uuid := '32000000-0000-4000-8000-000000000001';
  insight_id uuid := '33000000-0000-4000-8000-000000000001';
  evidence_id uuid := '34000000-0000-4000-8000-000000000001';
  review_id uuid := '35000000-0000-4000-8000-000000000001';
  sidecar_id uuid := '36000000-0000-4000-8000-000000000001';
  unit_id uuid := '37000000-0000-4000-8000-000000000001';
  library_digest text;
  library_text text;
  library_snapshot jsonb;
  library_manifest jsonb;
  raw_snapshot jsonb;
  raw_text text;
  manifest jsonb;
  changed jsonb;
  changed_snapshot jsonb;
  changed_text text;
  changed_envelope jsonb;
  result jsonb;
  run_id text;
  record_payload jsonb;
  topic_row jsonb;
  source_row jsonb;
  insight_row jsonb;
  evidence_row jsonb;
  review_row jsonb;
  sidecar_envelope jsonb;
  unit_row jsonb;
begin
  if has_function_privilege('anon','studio.studio_import_knowledge(text,text,jsonb,text)','EXECUTE')
    or has_table_privilege('authenticated','studio.studio_knowledge_import_runs','SELECT') then
    raise exception 'Client can access knowledge import surface';
  end if;
  perform studio.studio_create_substo_location(v_location_id,'Knowledge apply','knowledge-owner');
  perform studio.studio_create_substo_location(v_other_location_id,'Knowledge other','other-owner');
  perform studio.studio_create_substo_location(v_missing_library_location_id,'Knowledge without library','missing-library-owner');

  record_payload := pg_catalog.jsonb_build_object('id',source_id,'kind','channel','title','Imported legacy source','url','https://example.test');
  library_snapshot := pg_catalog.jsonb_build_object('version',1,'records',pg_catalog.jsonb_build_array(record_payload),'files','[]'::jsonb);
  library_text := library_snapshot::text;
  library_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(library_text,'UTF8')),'hex');
  library_manifest := pg_catalog.jsonb_build_object(
    'schema','studio.legacy-library.v1','sourceDigest',library_digest,'sourceCanonicalJson',library_text,
    'mode','dry-run','valid',true,'mediaReady',true,
    'records',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',source_id,'kind','channel','title','Imported legacy source','linkedIds','[]'::jsonb,
      'payload',record_payload)), 'files','[]'::jsonb,
    'counts','{"records":1,"library":0,"channels":1,"content":0,"files":0,"links":0}'::jsonb);
  perform studio.studio_import_library(v_location_id,library_digest,library_manifest,'knowledge-owner');
  perform studio.studio_import_library(v_other_location_id,library_digest,library_manifest,'other-owner');

  topic_row := pg_catalog.jsonb_build_object('id',topic_id,'name','Topic','name_key','topic','summary','','created_at','2026-01-01T00:00:00Z','updated_at','2026-01-01T00:00:00Z');
  source_row := pg_catalog.jsonb_build_object('id',source_id,'title','Source','url','https://example.test','platform','youtube',
    'observed_at','2026-01-01T00:00:00Z','transcription_id','tx','total_units',1,'covered_units',1);
  insight_row := pg_catalog.jsonb_build_object('id',insight_id,'source_id',source_id,'topic_id',topic_id,'suggested_topic','Topic',
    'kind','claim','statement','  exact statement  ','status','approved','created_at','2026-01-01T00:00:00Z','updated_at','2026-01-01T00:00:00Z');
  evidence_row := pg_catalog.jsonb_build_object('id',evidence_id,'insight_id',insight_id,'source_id',source_id,'quote','exact quote',
    'start_sec',0,'end_sec',2,'frame_file','frame-01.jpg','source_url','https://example.test','observed_at','2026-01-01T00:00:00Z');
  review_row := pg_catalog.jsonb_build_object('id',review_id,'insight_id',insight_id,'action','approve','previous_status','pending','new_status','approved','at','2026-01-01T00:00:00Z');
  sidecar_envelope := pg_catalog.jsonb_build_object('recordId',source_id,'payload',pg_catalog.jsonb_build_object('transcriptionId','tx',
    'units',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('text','unit text','start',0,'end',2,'frameFile','frame-01.jpg'))));
  unit_row := pg_catalog.jsonb_build_object('id',unit_id,'sidecar_id',sidecar_id,'source_id',source_id,'transcription_id','tx','unit_index',0,
    'payload',pg_catalog.jsonb_build_object('unit',sidecar_envelope->'payload'->'units'->0));
  raw_snapshot := pg_catalog.jsonb_build_object('version',1,'topics',pg_catalog.jsonb_build_array(topic_row),'sources',pg_catalog.jsonb_build_array(source_row),
    'insights',pg_catalog.jsonb_build_array(insight_row),'evidence',pg_catalog.jsonb_build_array(evidence_row),'reviews',pg_catalog.jsonb_build_array(review_row),
    'sourceUnits',pg_catalog.jsonb_build_array(sidecar_envelope));
  raw_text := raw_snapshot::text;
  manifest := pg_catalog.jsonb_build_object(
    'schema','studio.legacy-knowledge.v1','sourceDigest',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(raw_text,'UTF8')),'hex'),
    'sourceCanonicalJson',raw_text,'mode','dry-run','valid',true,'snapshotCheckedUnchanged',true,'mediaReconciled',false,
    'librarySource',pg_catalog.jsonb_build_object('sourceDigest',library_digest,'sourceCanonicalJson',library_text),
    'topics',pg_catalog.jsonb_build_array(topic_row),'sources',pg_catalog.jsonb_build_array(source_row),
    'insights',pg_catalog.jsonb_build_array(insight_row),'evidence',pg_catalog.jsonb_build_array(evidence_row),'reviews',pg_catalog.jsonb_build_array(review_row),
    'sourceUnitSidecars',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',sidecar_id,'source_id',source_id,'transcription_id','tx','payload',sidecar_envelope)),
    'sourceUnits',pg_catalog.jsonb_build_array(unit_row),'issues','[]'::jsonb,
    'counts','{"topics":1,"sources":1,"insights":1,"evidence":1,"reviews":1,"sourceUnitSidecars":1,"sourceUnits":1,"pending":0,"approved":1,"rejected":0,"uncoveredUnits":0}'::jsonb);

  begin
    perform studio.studio_import_knowledge(v_location_id,manifest->>'sourceDigest',manifest,'wrong-owner');
    raise exception 'Wrong owner imported knowledge';
  exception when insufficient_privilege then null; end;
  begin
    perform studio.studio_import_knowledge(v_missing_library_location_id,manifest->>'sourceDigest',manifest,'missing-library-owner');
    raise exception 'Knowledge import skipped library dependency';
  exception when foreign_key_violation then null; end;

  result := studio.studio_import_knowledge(v_location_id,manifest->>'sourceDigest',manifest,'knowledge-owner');
  run_id := result->>'runId';
  if result->'counts' is distinct from manifest->'counts' or result->'replayed' is distinct from 'false'::jsonb
    or (select payload->>'statement' from studio.studio_knowledge_insights where location_id=v_location_id and id=insight_id) is distinct from '  exact statement  '
    or (select payload from studio.studio_knowledge_source_unit_sidecars where location_id=v_location_id and id=sidecar_id) is distinct from sidecar_envelope then
    raise exception 'Knowledge import did not preserve the snapshot';
  end if;

  update studio.studio_knowledge_insights set statement='hosted edit',payload=payload || '{"hosted_edit":true}'::jsonb where location_id=v_location_id and id=insight_id;
  result := studio.studio_import_knowledge(v_location_id,manifest->>'sourceDigest',manifest,'knowledge-owner');
  if result->>'runId' is distinct from run_id or result->'replayed' is distinct from 'true'::jsonb
    or (select statement from studio.studio_knowledge_insights where location_id=v_location_id and id=insight_id) is distinct from 'hosted edit'
    or (select count(*) from studio.studio_knowledge_import_runs where location_id=v_location_id) <> 1 then
    raise exception 'Identical knowledge retry overwrote edits or duplicated ledger';
  end if;

  changed := pg_catalog.jsonb_set(manifest,'{sources,0,covered_units}','0'::jsonb);
  begin
    perform studio.studio_import_knowledge(v_location_id,changed->>'sourceDigest',changed,'knowledge-owner');
    raise exception 'Changed wrapper accepted against pinned source';
  exception when invalid_parameter_value then null; end;

  changed := pg_catalog.jsonb_set(manifest,'{sourceCanonicalJson}',pg_catalog.to_jsonb(raw_text || ' '));
  begin
    perform studio.studio_import_knowledge(v_location_id,changed->>'sourceDigest',changed,'knowledge-owner');
    raise exception 'Stale knowledge digest accepted';
  exception when invalid_parameter_value then null; end;

  changed_snapshot := pg_catalog.jsonb_set(raw_snapshot,'{sourceUnits}','[]'::jsonb);
  changed_text := changed_snapshot::text;
  changed := pg_catalog.jsonb_set(manifest,'{sourceCanonicalJson}',pg_catalog.to_jsonb(changed_text));
  changed := pg_catalog.jsonb_set(changed,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(changed_text,'UTF8')),'hex')));
  changed := pg_catalog.jsonb_set(changed,'{sourceUnitSidecars}','[]'::jsonb);
  changed := pg_catalog.jsonb_set(changed,'{sourceUnits}','[]'::jsonb);
  changed := pg_catalog.jsonb_set(changed,'{counts,sourceUnitSidecars}','0'::jsonb);
  changed := pg_catalog.jsonb_set(changed,'{counts,sourceUnits}','0'::jsonb);
  begin
    perform studio.studio_import_knowledge(v_location_id,changed->>'sourceDigest',changed,'knowledge-owner');
    raise exception 'Positive source coverage accepted without sidecar';
  exception when invalid_parameter_value then null; end;

  changed_envelope := pg_catalog.jsonb_set(sidecar_envelope,'{payload,units}','[]'::jsonb);
  changed_snapshot := pg_catalog.jsonb_set(raw_snapshot,'{sourceUnits,0}',changed_envelope);
  changed_text := changed_snapshot::text;
  changed := pg_catalog.jsonb_set(manifest,'{sourceCanonicalJson}',pg_catalog.to_jsonb(changed_text));
  changed := pg_catalog.jsonb_set(changed,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(changed_text,'UTF8')),'hex')));
  changed := pg_catalog.jsonb_set(changed,'{sourceUnitSidecars,0,payload}',changed_envelope);
  changed := pg_catalog.jsonb_set(changed,'{sourceUnits}','[]'::jsonb);
  changed := pg_catalog.jsonb_set(changed,'{counts,sourceUnits}','0'::jsonb);
  begin
    perform studio.studio_import_knowledge(v_location_id,changed->>'sourceDigest',changed,'knowledge-owner');
    raise exception 'Source sidecar unit count mismatch accepted';
  exception when invalid_parameter_value then null; end;

  changed_snapshot := pg_catalog.jsonb_set(raw_snapshot,'{insights,0}','{ "id":"33000000-0000-4000-8000-000000000001", "source_id":"31000000-0000-4000-8000-000000000001", "topic_id":"32000000-0000-4000-8000-000000000001", "suggested_topic":"Topic", "statement":"Exact", "status":"approved", "created_at":"2026-01-01T00:00:00Z", "updated_at":"2026-01-01T00:00:00Z" }'::jsonb);
  changed_text := changed_snapshot::text;
  changed := pg_catalog.jsonb_set(manifest,'{sourceCanonicalJson}',pg_catalog.to_jsonb(changed_text));
  changed := pg_catalog.jsonb_set(changed,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(changed_text,'UTF8')),'hex')));
  changed := pg_catalog.jsonb_set(changed,'{insights}',changed_snapshot->'insights');
  begin
    perform studio.studio_import_knowledge(v_other_location_id,changed->>'sourceDigest',changed,'other-owner');
    raise exception 'Missing insight kind accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from studio.studio_knowledge_topics where location_id=v_other_location_id)
    or exists(select 1 from studio.studio_knowledge_import_runs where location_id=v_other_location_id) then
    raise exception 'Invalid kind left partial knowledge rows';
  end if;

  changed_snapshot := pg_catalog.jsonb_set(raw_snapshot,'{reviews,0,new_status}','"pending"'::jsonb);
  changed_text := changed_snapshot::text;
  changed := pg_catalog.jsonb_set(manifest,'{sourceCanonicalJson}',pg_catalog.to_jsonb(changed_text));
  changed := pg_catalog.jsonb_set(changed,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(changed_text,'UTF8')),'hex')));
  changed := pg_catalog.jsonb_set(changed,'{reviews}',changed_snapshot->'reviews');
  begin
    perform studio.studio_import_knowledge(v_other_location_id,changed->>'sourceDigest',changed,'other-owner');
    raise exception 'Invalid review transition accepted';
  exception when invalid_parameter_value then null; end;

  changed_snapshot := pg_catalog.jsonb_set(raw_snapshot,'{evidence,0,end_sec}','-1'::jsonb);
  changed_text := changed_snapshot::text;
  changed := pg_catalog.jsonb_set(manifest,'{sourceCanonicalJson}',pg_catalog.to_jsonb(changed_text));
  changed := pg_catalog.jsonb_set(changed,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(changed_text,'UTF8')),'hex')));
  changed := pg_catalog.jsonb_set(changed,'{evidence}',changed_snapshot->'evidence');
  begin
    perform studio.studio_import_knowledge(v_other_location_id,changed->>'sourceDigest',changed,'other-owner');
    raise exception 'Negative evidence time accepted';
  exception when invalid_parameter_value then null; end;

  changed_envelope := pg_catalog.jsonb_set(sidecar_envelope,'{payload,units,0,text}','null'::jsonb);
  changed_snapshot := pg_catalog.jsonb_set(raw_snapshot,'{sourceUnits,0}',changed_envelope);
  changed_text := changed_snapshot::text;
  changed := pg_catalog.jsonb_set(manifest,'{sourceCanonicalJson}',pg_catalog.to_jsonb(changed_text));
  changed := pg_catalog.jsonb_set(changed,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(changed_text,'UTF8')),'hex')));
  changed := pg_catalog.jsonb_set(changed,'{sourceUnitSidecars,0,payload}',changed_envelope);
  changed := pg_catalog.jsonb_set(changed,'{sourceUnits,0,payload,unit}',changed_envelope->'payload'->'units'->0);
  begin
    perform studio.studio_import_knowledge(v_other_location_id,changed->>'sourceDigest',changed,'other-owner');
    raise exception 'Source unit without text accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from studio.studio_knowledge_topics where location_id=v_other_location_id)
    or exists(select 1 from studio.studio_knowledge_import_runs where location_id=v_other_location_id) then
    raise exception 'Invalid semantic rows left partial knowledge rows';
  end if;

  -- Composite location foreign keys reject a source that exists only in the
  -- first location and a topic that exists only in the first location.
  insert into studio.studio_knowledge_topics(location_id,id,payload)
    values(v_other_location_id,'32000000-0000-4000-8000-000000000002','{"id":"32000000-0000-4000-8000-000000000002","name":"Other","name_key":"other","summary":"","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}'::jsonb);
  begin
    insert into studio.studio_knowledge_insights(location_id,id,source_id,topic_id,status,statement,payload)
      values(v_other_location_id,'33000000-0000-4000-8000-000000000002',source_id,'32000000-0000-4000-8000-000000000002','approved','x','{"kind":"claim"}'::jsonb);
    raise exception 'Cross-location knowledge source reference accepted';
  exception when foreign_key_violation then null; end;
  insert into studio.studio_knowledge_sources(location_id,id,payload,total_units,covered_units)
    values(v_other_location_id,source_id,source_row,1,1);
  begin
    insert into studio.studio_knowledge_insights(location_id,id,source_id,topic_id,status,statement,payload)
      values(v_other_location_id,'33000000-0000-4000-8000-000000000003',source_id,topic_id,'approved','x','{"kind":"claim"}'::jsonb);
    raise exception 'Cross-location knowledge topic reference accepted';
  exception when foreign_key_violation then null; end;
  delete from studio.studio_knowledge_sources where location_id=v_other_location_id;
  delete from studio.studio_knowledge_topics where location_id=v_other_location_id;

  -- A bad final evidence parent fails after earlier inserts, but the RPC
  -- transaction rolls the whole location snapshot and ledger back.
  changed_snapshot := pg_catalog.jsonb_set(raw_snapshot,'{evidence,0,insight_id}','"99000000-0000-4000-8000-000000000099"'::jsonb);
  changed_text := changed_snapshot::text;
  changed := pg_catalog.jsonb_set(manifest,'{sourceCanonicalJson}',pg_catalog.to_jsonb(changed_text));
  changed := pg_catalog.jsonb_set(changed,'{sourceDigest}',pg_catalog.to_jsonb(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(changed_text,'UTF8')),'hex')));
  changed := pg_catalog.jsonb_set(changed,'{evidence}',changed_snapshot->'evidence');
  begin
    perform studio.studio_import_knowledge(v_other_location_id,changed->>'sourceDigest',changed,'other-owner');
    raise exception 'Dangling final evidence accepted';
  exception when foreign_key_violation then null; end;
  if exists(select 1 from studio.studio_knowledge_topics where location_id=v_other_location_id)
    or exists(select 1 from studio.studio_knowledge_sources where location_id=v_other_location_id)
    or exists(select 1 from studio.studio_knowledge_insights where location_id=v_other_location_id)
    or exists(select 1 from studio.studio_knowledge_import_runs where location_id=v_other_location_id)
    or not exists(select 1 from studio.studio_library_import_runs where location_id=v_other_location_id and source_digest=library_digest) then
    raise exception 'Failed knowledge apply was not atomic or removed its library dependency';
  end if;
end;
$$;
select 'Studio knowledge import assertions passed' as result;
