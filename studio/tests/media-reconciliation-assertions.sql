-- Synthetic fixtures only. Exercises reservation/binding authority and atomicity.
do $$
declare
  w uuid := '86000000-0000-4000-8000-000000000001';
  other_w uuid := '86000000-0000-4000-8000-000000000002';
  rid uuid := '87000000-0000-4000-8000-000000000001';
  fid uuid := '88000000-0000-4000-8000-000000000001';
  lib text := repeat('a',64);
  med text := repeat('b',64);
  sha text := repeat('c',64);
  row_spec jsonb;
  result jsonb;
  key text;
  role_name text;
  operation text;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach operation in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege(role_name,'public.studio_legacy_media_transfers',operation)
        or has_table_privilege(role_name,'public.studio_legacy_files',operation)
        or has_table_privilege(role_name,'public.studio_media_objects',operation) then
        raise exception 'Unsafe direct media mutation privilege for %', role_name;
      end if;
    end loop;
  end loop;
  if has_table_privilege('authenticated','public.studio_legacy_media_transfers','SELECT')
    or has_function_privilege('authenticated','public.studio_bind_legacy_media(uuid,text,uuid,text,bigint)','EXECUTE')
    or has_function_privilege('anon','public.studio_reserve_legacy_media(uuid,text,text,text,text,jsonb)','EXECUTE')
    or has_function_privilege('service_role','public.studio_lock_legacy_media_owner(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.studio_bind_legacy_media(uuid,text,uuid,text,bigint)','EXECUTE') then
    raise exception 'Unsafe media RPC grants';
  end if;

  perform public.studio_create_substo_workspace(w,'Media fixture','media-owner');
  perform public.studio_create_substo_workspace(other_w,'Other media fixture','other-media-owner');
  insert into public.studio_records(workspace_id,id,kind,title,payload,legacy_payload,created_by_clerk_user_id)
    values(w,rid,'reference','Source',jsonb_build_object('id',rid),jsonb_build_object('id',rid),'media-owner');
  insert into public.studio_legacy_files(workspace_id,id,record_id,payload)
    values(w,fid,rid,jsonb_build_object('id',fid,'recordId',rid,'name','own.mov','size',42,'type','video/quicktime','keep',true));
  row_spec := jsonb_build_array(jsonb_build_object('id',fid,'recordId',rid,'sha256',sha,'byteSize',42,'originalFilename','own.mov','contentType','video/quicktime'));

  begin
    perform public.studio_reserve_legacy_media(w,'media-owner',lib,med,'studio-media-test',row_spec);
    raise exception 'Reservation without library import succeeded';
  exception when sqlstate '22023' then null; end;
  insert into public.studio_library_import_runs(workspace_id,source_digest,manifest_signature,counts,media_pending,imported_by_clerk_user_id)
    values(w,lib,repeat('d',32),'{}'::jsonb,1,'media-owner');

  begin
    perform public.studio_reserve_legacy_media(w,'other-media-owner',lib,med,'studio-media-test',row_spec);
    raise exception 'Non-owner reservation succeeded';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.studio_reserve_legacy_media(other_w,'other-media-owner',lib,med,'studio-media-test',row_spec);
    raise exception 'Cross-workspace reservation succeeded';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.studio_reserve_legacy_media(w,'media-owner',lib,med,'studio-media-test',
      jsonb_set(row_spec,'{0,byteSize}','41'));
    raise exception 'Mismatched size reservation succeeded';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.studio_reserve_legacy_media(w,'media-owner',lib,med,'studio-media-test',row_spec || row_spec);
    raise exception 'Duplicate reservation succeeded';
  exception when sqlstate '22023' then null; end;

  result := public.studio_reserve_legacy_media(w,'media-owner',lib,med,'studio-media-test',row_spec);
  key := result->'files'->0->>'objectKey';
  if key <> w::text||'/legacy-library/'||fid::text||'/'||sha or result->'files'->0->>'status' <> 'pending' then
    raise exception 'Unexpected reservation %', result;
  end if;
  if (select media_object_id from public.studio_legacy_files where workspace_id=w and id=fid) is not null then
    raise exception 'Reservation bound media early';
  end if;

  if result->'files'->0->>'bucketId' <> 'studio-media-test' then raise exception 'Reservation lost bucket'; end if;
  begin
    perform public.studio_reserve_legacy_media(w,'media-owner',lib,med,'Bad_Bucket',row_spec);
    raise exception 'Invalid bucket reservation succeeded';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.studio_bind_legacy_media(w,'media-owner',fid,sha,41);
    raise exception 'Binding wrong size succeeded';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.studio_bind_legacy_media(w,'media-owner',fid,repeat('e',64),42);
    raise exception 'Binding different hash succeeded';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.studio_bind_legacy_media(w,'other-media-owner',fid,sha,42);
    raise exception 'Non-owner binding succeeded';
  exception when sqlstate '42501' then null; end;
  if (select status from public.studio_legacy_media_transfers where workspace_id=w and file_id=fid) <> 'pending'
    or exists(select 1 from public.studio_media_objects where workspace_id=w) then
    raise exception 'Failed binding left partial state';
  end if;

  result := public.studio_bind_legacy_media(w,'media-owner',fid,sha,42);
  if result->'replayed' <> 'false'::jsonb
    or (select media_object_id from public.studio_legacy_files where workspace_id=w and id=fid)::text is distinct from result->>'mediaObjectId'
    or (select payload->'keep' from public.studio_legacy_files where workspace_id=w and id=fid) <> 'true'::jsonb
    or not exists(select 1 from public.studio_media_objects where id=(result->>'mediaObjectId')::uuid
      and object_key=key and bucket_id='studio-media-test' and storage_provider='cloudflare_r2' and sha256=sha and byte_size=42 and original_filename='own.mov' and content_type='video/quicktime') then
    raise exception 'Binding did not reconcile %', result;
  end if;
  if (public.studio_bind_legacy_media(w,'media-owner',fid,sha,42))->'replayed' <> 'true'::jsonb then
    raise exception 'Binding replay was not idempotent';
  end if;
  if (public.studio_reserve_legacy_media(w,'media-owner',lib,med,'studio-media-test',row_spec))->'files'->0->>'status' <> 'verified' then
    raise exception 'Reservation replay lost verified status';
  end if;
  begin
    perform public.studio_reserve_legacy_media(w,'media-owner',lib,med,'studio-media-test',jsonb_set(row_spec,'{0,sha256}',to_jsonb(repeat('f',64))));
    raise exception 'Verified attachment rebound to different bytes';
  exception when sqlstate '22023' or sqlstate '23505' then null; end;
end;
$$;

select 'Studio media reconciliation assertions passed' as result;
