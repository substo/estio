-- Atomic import of one pinned legacy knowledge export into a Substo location.
begin;

create table public.studio_knowledge_import_runs (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  library_source_digest text not null check (library_source_digest ~ '^[0-9a-f]{64}$'),
  manifest_signature text not null check (manifest_signature ~ '^[0-9a-f]{64}$'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  imported_by_clerk_user_id text not null check (btrim(imported_by_clerk_user_id) <> ''),
  created_at timestamptz not null default now(),
  unique (location_id,source_digest)
);
alter table public.studio_knowledge_import_runs enable row level security;
revoke all on public.studio_knowledge_import_runs from public,anon,authenticated;
grant all on public.studio_knowledge_import_runs to service_role;

create function public.studio_import_knowledge(
  p_location_id text, p_source_digest text, p_manifest jsonb, p_owner_clerk_user_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_location public.studio_locations%rowtype;
  v_run public.studio_knowledge_import_runs%rowtype;
  v_snapshot jsonb;
  v_library_snapshot jsonb;
  v_source_text text;
  v_library_text text;
  v_row jsonb;
  v_sidecar jsonb;
  v_sidecar_entry record;
  v_unit jsonb;
  v_unit_entry record;
  v_sidecar_payload jsonb;
  v_unit_position integer := 0;
  v_sidecar_index integer;
  v_matching_sidecars integer;
  v_matching_sidecar jsonb;
  v_time_start numeric;
  v_time_end numeric;
  v_signature text;
  v_counts jsonb;
  v_replayed boolean := false;
begin
  if p_location_id is null or p_source_digest is null or p_source_digest !~ '^[0-9a-f]{64}$'
    or p_owner_clerk_user_id is null or pg_catalog.btrim(p_owner_clerk_user_id) = ''
    or pg_catalog.jsonb_typeof(p_manifest) is distinct from 'object'
    or p_manifest->>'schema' is distinct from 'studio.legacy-knowledge.v1'
    or p_manifest->>'sourceDigest' is distinct from p_source_digest
    or p_manifest->'valid' is distinct from 'true'::jsonb
    or p_manifest->>'mode' is distinct from 'dry-run'
    or p_manifest->'snapshotCheckedUnchanged' is distinct from 'true'::jsonb
    or p_manifest->'mediaReconciled' is distinct from 'false'::jsonb
    or pg_catalog.octet_length(pg_catalog.convert_to(p_manifest::text,'UTF8')) > 419430400
    or pg_catalog.jsonb_typeof(p_manifest->'sourceCanonicalJson') is distinct from 'string'
    or pg_catalog.octet_length(pg_catalog.convert_to(p_manifest->>'sourceCanonicalJson','UTF8')) > 104857600
    or pg_catalog.jsonb_typeof(p_manifest->'topics') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'sources') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'insights') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'evidence') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'reviews') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'sourceUnitSidecars') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'sourceUnits') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'issues') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'counts') is distinct from 'object'
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_manifest->'issues') issue where issue->>'severity'='error')
    or pg_catalog.jsonb_typeof(p_manifest->'librarySource') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_manifest->'librarySource'->'sourceCanonicalJson') is distinct from 'string'
    or p_manifest->'librarySource'->>'sourceDigest' !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid knowledge import manifest' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_manifest->'topics') > 100000
    or pg_catalog.jsonb_array_length(p_manifest->'sources') > 100000
    or pg_catalog.jsonb_array_length(p_manifest->'insights') > 100000
    or pg_catalog.jsonb_array_length(p_manifest->'evidence') > 100000
    or pg_catalog.jsonb_array_length(p_manifest->'reviews') > 100000
    or pg_catalog.jsonb_array_length(p_manifest->'sourceUnitSidecars') > 10000
    or (select coalesce(pg_catalog.sum(case when pg_catalog.jsonb_typeof(envelope->'payload'->'units')='array'
      then pg_catalog.jsonb_array_length(envelope->'payload'->'units') else 0 end),0)
      from pg_catalog.jsonb_array_elements(p_manifest->'sourceUnitSidecars') envelope) > 250000
    or pg_catalog.jsonb_array_length(p_manifest->'topics') + pg_catalog.jsonb_array_length(p_manifest->'sources')
      + pg_catalog.jsonb_array_length(p_manifest->'insights') + pg_catalog.jsonb_array_length(p_manifest->'evidence')
      + pg_catalog.jsonb_array_length(p_manifest->'reviews')
      + (select coalesce(pg_catalog.sum(case when pg_catalog.jsonb_typeof(envelope->'payload'->'units')='array'
        then pg_catalog.jsonb_array_length(envelope->'payload'->'units') else 0 end),0)
        from pg_catalog.jsonb_array_elements(p_manifest->'sourceUnitSidecars') envelope) > 250000 then
    raise exception 'Knowledge import row limit exceeded' using errcode = '22023';
  end if;

  v_source_text := p_manifest->>'sourceCanonicalJson';
  v_library_text := p_manifest->'librarySource'->>'sourceCanonicalJson';
  if pg_catalog.octet_length(pg_catalog.convert_to(v_library_text,'UTF8')) > 104857600 then
    raise exception 'Library source snapshot exceeds limit' using errcode = '22023';
  end if;
  begin
    v_snapshot := v_source_text::jsonb;
    v_library_snapshot := v_library_text::jsonb;
  exception when others then
    raise exception 'Invalid canonical knowledge source snapshot' using errcode = '22023';
  end;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_source_text,'UTF8')),'hex') <> p_source_digest
    or pg_catalog.jsonb_typeof(v_snapshot) is distinct from 'object'
    or v_snapshot->'version' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(v_snapshot->'topics') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_snapshot->'sources') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_snapshot->'insights') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_snapshot->'evidence') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_snapshot->'reviews') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_snapshot->'sourceUnits') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_library_snapshot) is distinct from 'object'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_library_text,'UTF8')),'hex') <> p_manifest->'librarySource'->>'sourceDigest'
    or pg_catalog.jsonb_typeof(v_library_snapshot->'records') is distinct from 'array'
    or p_manifest->'topics' is distinct from v_snapshot->'topics'
    or p_manifest->'sources' is distinct from v_snapshot->'sources'
    or p_manifest->'insights' is distinct from v_snapshot->'insights'
    or p_manifest->'evidence' is distinct from v_snapshot->'evidence'
    or p_manifest->'reviews' is distinct from v_snapshot->'reviews'
    or pg_catalog.jsonb_array_length(p_manifest->'sourceUnitSidecars') <> pg_catalog.jsonb_array_length(v_snapshot->'sourceUnits') then
    raise exception 'Knowledge source snapshot did not reconcile' using errcode = '22023';
  end if;

  -- Serialize location import/replay and recheck owner and imported library snapshot.
  select * into v_location from public.studio_locations where location_id=p_location_id for update;
  if not found or v_location.app <> 'substo'
    or not exists(select 1 from public.studio_location_memberships where location_id=p_location_id
      and location_app='substo' and clerk_user_id=p_owner_clerk_user_id and role='owner') then
    raise exception 'Knowledge import requires the target Substo location owner' using errcode = '42501';
  end if;
  if not exists(select 1 from public.studio_library_import_runs where location_id=p_location_id
    and source_digest=p_manifest->'librarySource'->>'sourceDigest') then
    raise exception 'The matching library snapshot must be imported first' using errcode = '23503';
  end if;

  -- Every knowledge source must belong to both pinned source exports and an
  -- existing same-location library row. Record kind is deliberately preserved.
  for v_row in select value from pg_catalog.jsonb_array_elements(v_snapshot->'sources') loop
    if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
      or (v_row->>'id') is null or (v_row->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_library_snapshot->'records') record_row
        where pg_catalog.lower(record_row->>'id')=pg_catalog.lower(v_row->>'id'))
      or not exists(select 1 from public.studio_records where location_id=p_location_id and id=(v_row->>'id')::uuid) then
      raise exception 'Knowledge source has no matching imported library record' using errcode = '23503';
    end if;
  end loop;

  -- Validate readiness before replay/conflict handling or any inserts, so a
  -- forged but self-consistent manifest cannot bypass sidecar completeness.
  for v_row in select value from pg_catalog.jsonb_array_elements(v_snapshot->'sources') loop
    if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_row->'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_row->'title') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_row->'url') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_row->'platform') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_row->'transcription_id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_row->'observed_at') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_row->'total_units') is distinct from 'number' or (v_row->>'total_units') !~ '^[0-9]+$'
      or pg_catalog.jsonb_typeof(v_row->'covered_units') is distinct from 'number' or (v_row->>'covered_units') !~ '^[0-9]+$' then
      raise exception 'Invalid knowledge source coverage' using errcode = '22023';
    end if;
    perform (v_row->>'observed_at')::timestamptz;
    if (v_row->>'total_units')::numeric > 2147483647 or (v_row->>'covered_units')::numeric > 2147483647
      or (v_row->>'covered_units')::numeric > (v_row->>'total_units')::numeric then
      raise exception 'Invalid knowledge source coverage' using errcode = '22023';
    end if;
    select pg_catalog.count(*), (pg_catalog.array_agg(value))[1]
      into v_matching_sidecars, v_matching_sidecar
      from pg_catalog.jsonb_array_elements(v_snapshot->'sourceUnits') as envelopes(value)
      where pg_catalog.lower(value->>'recordId') = pg_catalog.lower(v_row->>'id');
    if (v_row->>'total_units')::integer > 0 and v_matching_sidecars = 0 then
      raise exception 'Source sidecar required by exported unit coverage' using errcode = '22023';
    end if;
    if v_matching_sidecars > 1 then
      raise exception 'Multiple source sidecars for one exported source' using errcode = '22023';
    end if;
    if v_matching_sidecars = 1 and (
      pg_catalog.jsonb_typeof(v_matching_sidecar->'payload') is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_matching_sidecar->'payload'->'units') is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_matching_sidecar->'payload'->'units') <> (v_row->>'total_units')::integer
      or v_matching_sidecar->'payload'->>'transcriptionId' is distinct from v_row->>'transcription_id') then
      raise exception 'Source sidecar count or transcription did not reconcile' using errcode = '22023';
    end if;
  end loop;

  v_signature := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_manifest::text,'UTF8')),'hex');
  select * into v_run from public.studio_knowledge_import_runs where location_id=p_location_id and source_digest=p_source_digest;
  if found then
    if v_run.manifest_signature <> v_signature then raise exception 'Snapshot digest belongs to a different manifest' using errcode = '23505'; end if;
    v_replayed := true;
  else
    for v_row in select value from pg_catalog.jsonb_array_elements(v_snapshot->'topics') loop
      if pg_catalog.jsonb_typeof(v_row) is distinct from 'object' or (v_row->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or pg_catalog.jsonb_typeof(v_row->'name') is distinct from 'string' or pg_catalog.btrim(v_row->>'name')=''
        or pg_catalog.jsonb_typeof(v_row->'name_key') is distinct from 'string' or pg_catalog.btrim(v_row->>'name_key')=''
        or pg_catalog.jsonb_typeof(v_row->'summary') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'created_at') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'updated_at') is distinct from 'string' then
        raise exception 'Invalid knowledge topic' using errcode = '22023';
      end if;
      perform (v_row->>'created_at')::timestamptz;
      perform (v_row->>'updated_at')::timestamptz;
      insert into public.studio_knowledge_topics(location_id,id,payload) values(p_location_id,(v_row->>'id')::uuid,v_row);
    end loop;
    for v_row in select value from pg_catalog.jsonb_array_elements(v_snapshot->'sources') loop
      insert into public.studio_knowledge_sources(location_id,id,payload,total_units,covered_units)
        values(p_location_id,(v_row->>'id')::uuid,v_row,(v_row->>'total_units')::integer,(v_row->>'covered_units')::integer);
    end loop;
    for v_sidecar_entry in select value,ordinal from pg_catalog.jsonb_array_elements(p_manifest->'sourceUnitSidecars') with ordinality as rows(value,ordinal) order by ordinal loop
      v_sidecar := v_sidecar_entry.value;
      v_sidecar_index := v_sidecar_entry.ordinal::integer;
      v_sidecar_payload := v_snapshot->'sourceUnits'->(v_sidecar_index-1);
      if pg_catalog.jsonb_typeof(v_sidecar) is distinct from 'object'
        or v_sidecar ? 'invalid'
        or pg_catalog.lower(v_sidecar->>'source_id') is distinct from pg_catalog.lower(v_sidecar_payload->>'recordId')
        or v_sidecar->>'transcription_id' is distinct from v_sidecar_payload->'payload'->>'transcriptionId'
        or v_sidecar->'payload' is distinct from v_sidecar_payload then
        raise exception 'Sidecar envelope did not reconcile' using errcode = '22023';
      end if;
      insert into public.studio_knowledge_source_unit_sidecars(location_id,id,source_id,transcription_id,payload)
        values(p_location_id,(v_sidecar->>'id')::uuid,(v_sidecar->>'source_id')::uuid,v_sidecar->>'transcription_id',v_sidecar->'payload');
      for v_unit_entry in select value,ordinal from pg_catalog.jsonb_array_elements(v_sidecar_payload->'payload'->'units') with ordinality as units(value,ordinal) order by ordinal loop
        v_unit := v_unit_entry.value;
        if pg_catalog.jsonb_typeof(v_unit) is distinct from 'object'
          or pg_catalog.jsonb_typeof(v_unit->'text') is distinct from 'string'
          or (v_unit ? 'start' and pg_catalog.jsonb_typeof(v_unit->'start') is distinct from 'number')
          or (v_unit ? 'end' and pg_catalog.jsonb_typeof(v_unit->'end') is distinct from 'number')
          or (v_unit ? 'frameFile' and pg_catalog.jsonb_typeof(v_unit->'frameFile') is distinct from 'string') then
          raise exception 'Invalid source unit fields' using errcode = '22023';
        end if;
        v_time_start := case when pg_catalog.jsonb_typeof(v_unit->'start')='number' then (v_unit->>'start')::numeric else null end;
        v_time_end := case when pg_catalog.jsonb_typeof(v_unit->'end')='number' then (v_unit->>'end')::numeric else null end;
        if v_time_start < 0 or v_time_end < 0 or (v_time_start is not null and v_time_end is not null and v_time_end < v_time_start) then
          raise exception 'Invalid source unit time range' using errcode = '22023';
        end if;
        v_row := p_manifest->'sourceUnits'->v_unit_position;
        if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
          or v_row->>'sidecar_id' is distinct from v_sidecar->>'id'
          or pg_catalog.lower(v_row->>'source_id') is distinct from pg_catalog.lower(v_sidecar->>'source_id')
          or v_row->>'transcription_id' is distinct from v_sidecar->>'transcription_id'
          or v_row->>'unit_index' is distinct from (v_unit_entry.ordinal-1)::text
          or v_row->'payload'->'unit' is distinct from v_unit then
          raise exception 'Source unit did not reconcile with its sidecar' using errcode = '22023';
        end if;
        insert into public.studio_knowledge_source_units(location_id,id,sidecar_id,source_id,transcription_id,unit_index,payload)
          values(p_location_id,(v_row->>'id')::uuid,(v_row->>'sidecar_id')::uuid,(v_row->>'source_id')::uuid,v_row->>'transcription_id',(v_row->>'unit_index')::integer,v_row->'payload');
        v_unit_position := v_unit_position + 1;
      end loop;
    end loop;
    if v_unit_position <> pg_catalog.jsonb_array_length(p_manifest->'sourceUnits') then
      raise exception 'Source unit count did not reconcile' using errcode = '22023';
    end if;
    for v_row in select value from pg_catalog.jsonb_array_elements(v_snapshot->'insights') loop
      if pg_catalog.jsonb_typeof(v_row->'kind') is distinct from 'string'
        or coalesce(v_row->>'kind' not in ('claim','method','example','question','objection','content_pattern'),true)
        or pg_catalog.jsonb_typeof(v_row->'status') is distinct from 'string'
        or coalesce(v_row->>'status' not in ('pending','approved','rejected'),true)
        or pg_catalog.jsonb_typeof(v_row->'statement') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'created_at') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'updated_at') is distinct from 'string' then
        raise exception 'Invalid knowledge insight state' using errcode = '22023';
      end if;
      perform (v_row->>'created_at')::timestamptz;
      perform (v_row->>'updated_at')::timestamptz;
      insert into public.studio_knowledge_insights(location_id,id,source_id,topic_id,status,statement,payload)
        values(p_location_id,(v_row->>'id')::uuid,(v_row->>'source_id')::uuid,
          case when pg_catalog.jsonb_typeof(v_row->'topic_id')='null' then null else (v_row->>'topic_id')::uuid end,
          v_row->>'status',v_row->>'statement',v_row);
    end loop;
    for v_row in select value from pg_catalog.jsonb_array_elements(v_snapshot->'evidence') loop
      if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
        or pg_catalog.jsonb_typeof(v_row->'quote') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'frame_file') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'source_url') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'observed_at') is distinct from 'string'
        or (v_row ? 'start_sec' and pg_catalog.jsonb_typeof(v_row->'start_sec') not in ('number','null'))
        or (v_row ? 'end_sec' and pg_catalog.jsonb_typeof(v_row->'end_sec') not in ('number','null')) then
        raise exception 'Invalid knowledge evidence fields' using errcode = '22023';
      end if;
      perform (v_row->>'observed_at')::timestamptz;
      v_time_start := case when pg_catalog.jsonb_typeof(v_row->'start_sec')='number' then (v_row->>'start_sec')::numeric else null end;
      v_time_end := case when pg_catalog.jsonb_typeof(v_row->'end_sec')='number' then (v_row->>'end_sec')::numeric else null end;
      if v_time_start < 0 or v_time_end < 0 or (v_time_start is not null and v_time_end is not null and v_time_end < v_time_start) then
        raise exception 'Invalid knowledge evidence time range' using errcode = '22023';
      end if;
      insert into public.studio_knowledge_evidence(location_id,id,insight_id,source_id,payload)
        values(p_location_id,(v_row->>'id')::uuid,(v_row->>'insight_id')::uuid,(v_row->>'source_id')::uuid,v_row);
    end loop;
    for v_row in select value from pg_catalog.jsonb_array_elements(v_snapshot->'reviews') loop
      if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
        or pg_catalog.jsonb_typeof(v_row->'action') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'previous_status') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'new_status') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_row->'at') is distinct from 'string'
        or coalesce(v_row->>'action' not in ('approve','reject','reopen'),true)
        or coalesce(v_row->>'previous_status' not in ('pending','approved','rejected'),true)
        or coalesce(v_row->>'new_status' not in ('pending','approved','rejected'),true)
        or (v_row->>'action'='approve' and v_row->>'new_status' is distinct from 'approved')
        or (v_row->>'action'='reject' and v_row->>'new_status' is distinct from 'rejected')
        or (v_row->>'action'='reopen' and v_row->>'new_status' is distinct from 'pending') then
        raise exception 'Invalid knowledge review transition' using errcode = '22023';
      end if;
      perform (v_row->>'at')::timestamptz;
      insert into public.studio_knowledge_reviews(location_id,id,insight_id,payload)
        values(p_location_id,(v_row->>'id')::uuid,(v_row->>'insight_id')::uuid,v_row);
    end loop;

    select pg_catalog.jsonb_build_object(
      'topics',(select pg_catalog.count(*) from public.studio_knowledge_topics where location_id=p_location_id and id in (select (value->>'id')::uuid from pg_catalog.jsonb_array_elements(v_snapshot->'topics'))),
      'sources',(select pg_catalog.count(*) from public.studio_knowledge_sources where location_id=p_location_id and id in (select (value->>'id')::uuid from pg_catalog.jsonb_array_elements(v_snapshot->'sources'))),
      'insights',pg_catalog.jsonb_array_length(v_snapshot->'insights'),
      'evidence',pg_catalog.jsonb_array_length(v_snapshot->'evidence'),
      'reviews',pg_catalog.jsonb_array_length(v_snapshot->'reviews'),
      'sourceUnitSidecars',pg_catalog.jsonb_array_length(p_manifest->'sourceUnitSidecars'),
      'sourceUnits',pg_catalog.jsonb_array_length(p_manifest->'sourceUnits'),
      'pending',(select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_snapshot->'insights') x where x->>'status'='pending'),
      'approved',(select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_snapshot->'insights') x where x->>'status'='approved'),
      'rejected',(select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_snapshot->'insights') x where x->>'status'='rejected'),
      'uncoveredUnits',(select coalesce(pg_catalog.sum((x->>'total_units')::integer-(x->>'covered_units')::integer),0) from pg_catalog.jsonb_array_elements(v_snapshot->'sources') x)
    ) into v_counts;
    if p_manifest->'counts' is distinct from v_counts then raise exception 'Knowledge import counts did not reconcile' using errcode = '22023'; end if;
    insert into public.studio_knowledge_import_runs(location_id,source_digest,library_source_digest,manifest_signature,counts,imported_by_clerk_user_id)
      values(p_location_id,p_source_digest,p_manifest->'librarySource'->>'sourceDigest',v_signature,v_counts,p_owner_clerk_user_id)
      returning * into v_run;
  end if;
  return pg_catalog.jsonb_build_object('runId',v_run.id,'locationId',p_location_id,'sourceDigest',p_source_digest,'counts',v_run.counts,'replayed',v_replayed);
end;
$$;
revoke all on function public.studio_import_knowledge(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studio_import_knowledge(text,text,jsonb,text) to service_role;
commit;
