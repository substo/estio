-- Synthetic fixtures only. Knowledge frame reservation/binding authority and atomicity.
do $$
declare
  w uuid := '89000000-0000-4000-8000-000000000001';
  other_w uuid := '89000000-0000-4000-8000-000000000002';
  src uuid := '8a000000-0000-4000-8000-000000000001';
  ins uuid := '8b000000-0000-4000-8000-000000000001';
  ev uuid := '8c000000-0000-4000-8000-000000000001';
  sc uuid := '8d000000-0000-4000-8000-000000000001';
  un uuid := '8e000000-0000-4000-8000-000000000001';
  kd text := repeat('a',64); md text := repeat('b',64); sha text := repeat('c',64);
  refs jsonb; result jsonb; operation text;
begin
  foreach operation in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('service_role','public.studio_knowledge_media_links',operation) then raise exception 'Unsafe knowledge media link writes'; end if;
  end loop;
  if has_table_privilege('authenticated','public.studio_knowledge_media_links','SELECT')
    or has_function_privilege('anon','public.studio_reserve_knowledge_media(uuid,text,text,text,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.studio_bind_knowledge_media(uuid,text,text,uuid,text,bigint)','EXECUTE')
    or has_function_privilege('service_role','public.studio_knowledge_frame_matches(uuid,text,uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.studio_bind_knowledge_media(uuid,text,text,uuid,text,bigint)','EXECUTE') then
    raise exception 'Unsafe knowledge media RPC grants';
  end if;

  perform public.studio_create_substo_workspace(w,'Knowledge media fixture','km-owner');
  perform public.studio_create_substo_workspace(other_w,'Other knowledge media','km-other');
  insert into public.studio_records(workspace_id,id,kind,title,payload) values(w,src,'reference','Source','{}');
  insert into public.studio_knowledge_sources(workspace_id,id,payload,total_units,covered_units) values(w,src,'{"transcription_id":"tx-1"}',1,1);
  insert into public.studio_knowledge_insights(workspace_id,id,source_id,status,statement,payload) values(w,ins,src,'approved','Statement','{}');
  insert into public.studio_knowledge_evidence(workspace_id,id,insight_id,source_id,payload) values(w,ev,ins,src,'{"quote":"q","frame_file":"frame-01.jpg"}');
  insert into public.studio_knowledge_source_unit_sidecars(workspace_id,id,source_id,transcription_id,payload) values(w,sc,src,'tx-1','{}');
  insert into public.studio_knowledge_source_units(workspace_id,id,sidecar_id,source_id,transcription_id,unit_index,payload)
    values(w,un,sc,src,'tx-1',0,'{"unit":{"text":"t","frameFile":"frame-02.jpg","keep":true}}');
  refs := jsonb_build_array(
    jsonb_build_object('refKind','evidence','refId',ev,'frameFile','frame-01.jpg','sha256',sha,'byteSize',10,'contentType','image/jpeg'),
    jsonb_build_object('refKind','unit','refId',un,'frameFile','frame-02.jpg','sha256',sha,'byteSize',10,'contentType','image/jpeg'));

  begin perform public.studio_reserve_knowledge_media(w,'km-owner',kd,md,'studio-media',refs); raise exception 'Reserved without knowledge import';
  exception when sqlstate '22023' then null; end;
  insert into public.studio_knowledge_import_runs(workspace_id,source_digest,library_source_digest,manifest_signature,counts,imported_by_clerk_user_id)
    values(w,kd,repeat('d',64),repeat('e',64),'{}','km-owner');
  begin perform public.studio_reserve_knowledge_media(w,'km-other',kd,md,'studio-media',refs); raise exception 'Non-owner reserved';
  exception when sqlstate '42501' then null; end;
  begin perform public.studio_reserve_knowledge_media(other_w,'km-other',kd,md,'studio-media',refs); raise exception 'Cross-workspace reserved';
  exception when sqlstate '22023' then null; end;
  begin perform public.studio_reserve_knowledge_media(w,'km-owner',kd,md,'studio-media',jsonb_set(refs,'{0,frameFile}','"other.jpg"')); raise exception 'Mismatched frame reserved';
  exception when sqlstate '22023' then null; end;
  begin perform public.studio_reserve_knowledge_media(w,'km-owner',kd,md,'studio-media',jsonb_set(refs,'{1,refKind}','"evidence"')); raise exception 'Wrong kind reserved';
  exception when sqlstate '22023' then null; end;
  begin perform public.studio_reserve_knowledge_media(w,'km-owner',kd,md,'studio-media',jsonb_set(refs,'{0,contentType}','"image/svg+xml"')); raise exception 'SVG reserved';
  exception when sqlstate '22023' or sqlstate '23514' then null; end;
  if exists(select 1 from public.studio_knowledge_media_links where workspace_id=w) then raise exception 'Failed reservation left rows'; end if;

  result := public.studio_reserve_knowledge_media(w,'km-owner',kd,md,'studio-media',refs);
  if jsonb_array_length(result->'references') <> 2 or result->'references'->0->>'status' <> 'pending'
    or result->'references'->1->>'objectKey' <> w::text||'/legacy-knowledge/unit/'||un::text||'/'||sha then
    raise exception 'Unexpected knowledge reservation %', result;
  end if;
  begin perform public.studio_bind_knowledge_media(w,'km-owner','unit',un,sha,11); raise exception 'Wrong size bound';
  exception when sqlstate '22023' then null; end;
  begin perform public.studio_bind_knowledge_media(w,'km-other','unit',un,sha,10); raise exception 'Non-owner bound';
  exception when sqlstate '42501' then null; end;
  if exists(select 1 from public.studio_media_objects where workspace_id=w) then raise exception 'Failed bind left media'; end if;

  result := public.studio_bind_knowledge_media(w,'km-owner','unit',un,sha,10);
  if result->'replayed' <> 'false'::jsonb
    or (select status from public.studio_knowledge_media_links where workspace_id=w and ref_kind='unit' and ref_id=un) <> 'verified'
    or not exists(select 1 from public.studio_media_objects where id=(result->>'mediaObjectId')::uuid and original_filename='frame-02.jpg'
      and content_type='image/jpeg' and storage_provider='cloudflare_r2' and bucket_id='studio-media')
    or (select payload->'unit'->'keep' from public.studio_knowledge_source_units where workspace_id=w and id=un) <> 'true'::jsonb then
    raise exception 'Knowledge bind did not reconcile %', result;
  end if;
  if (select status from public.studio_knowledge_media_links where workspace_id=w and ref_kind='evidence' and ref_id=ev) <> 'pending' then
    raise exception 'Binding one frame changed another';
  end if;
  if (public.studio_bind_knowledge_media(w,'km-owner','unit',un,sha,10))->'replayed' <> 'true'::jsonb then raise exception 'Bind replay not idempotent'; end if;
  begin perform public.studio_reserve_knowledge_media(w,'km-owner',kd,md,'studio-media',jsonb_set(refs,'{1,sha256}',to_jsonb(repeat('f',64)))); raise exception 'Verified frame rebound';
  exception when sqlstate '23505' then null; end;
end;
$$;
select 'Studio knowledge media assertions passed' as result;
