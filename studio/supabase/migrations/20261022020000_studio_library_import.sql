-- First library import only. Local file metadata stays pending; no media bytes move.
begin;

create table public.studio_library_import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  -- JSONB canonical text consistency marker, not an authentication mechanism.
  manifest_signature text not null check (manifest_signature ~ '^[0-9a-f]{32}$'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  media_pending integer not null check (media_pending >= 0),
  imported_by_clerk_user_id text not null check (btrim(imported_by_clerk_user_id) <> ''),
  created_at timestamptz not null default now(),
  unique(workspace_id,source_digest)
);
alter table public.studio_library_import_runs enable row level security;
revoke all on public.studio_library_import_runs from public,anon,authenticated;
grant all on public.studio_library_import_runs to service_role;

create function public.studio_import_library(
  p_workspace_id uuid, p_source_digest text, p_manifest jsonb, p_owner_clerk_user_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace public.studio_workspaces%rowtype;
  v_run public.studio_library_import_runs%rowtype;
  v_record jsonb;
  v_file jsonb;
  v_link text;
  v_counts jsonb;
  v_signature text;
  v_source_snapshot jsonb;
  v_source_text text;
  v_replayed boolean := false;
begin
  if p_workspace_id is null or p_source_digest is null or p_source_digest !~ '^[0-9a-f]{64}$'
    or p_owner_clerk_user_id is null or pg_catalog.btrim(p_owner_clerk_user_id) = ''
    or pg_catalog.jsonb_typeof(p_manifest) is distinct from 'object'
    or p_manifest->>'schema' is distinct from 'studio.legacy-library.v1'
    or p_manifest->>'sourceDigest' is distinct from p_source_digest
    or pg_catalog.jsonb_typeof(p_manifest->'sourceCanonicalJson') is distinct from 'string'
    or pg_catalog.octet_length(pg_catalog.convert_to(p_manifest->>'sourceCanonicalJson','UTF8')) > 104857600
    or p_manifest->'valid' is distinct from 'true'::jsonb
    or p_manifest->'mediaReady' is distinct from 'true'::jsonb
    or p_manifest->>'mode' is distinct from 'dry-run'
    or pg_catalog.jsonb_typeof(p_manifest->'records') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'files') is distinct from 'array' then
    raise exception 'Invalid library import manifest' using errcode = '22023';
  end if;

  v_source_text := p_manifest->>'sourceCanonicalJson';
  begin
    v_source_snapshot := v_source_text::jsonb;
  exception when others then
    raise exception 'Invalid canonical source snapshot' using errcode = '22023';
  end;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_source_text,'UTF8')),'hex') <> p_source_digest
    or pg_catalog.jsonb_typeof(v_source_snapshot) is distinct from 'object'
    or v_source_snapshot->'version' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(v_source_snapshot->'records') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_source_snapshot->'files') is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_source_snapshot->'records') <> pg_catalog.jsonb_array_length(p_manifest->'records')
    or pg_catalog.jsonb_array_length(v_source_snapshot->'files') <> pg_catalog.jsonb_array_length(p_manifest->'files') then
    raise exception 'Source digest or snapshot shape did not reconcile' using errcode = '22023';
  end if;
  -- Validate snapshot-to-wrapper fidelity before the idempotent replay branch
  -- too; a retry must not make a tampered wrapper look like the old import.
  for v_record in select value from pg_catalog.jsonb_array_elements(p_manifest->'records') loop
    if pg_catalog.jsonb_typeof(v_record) is distinct from 'object'
      or (v_record->>'id') is null or (v_record->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_record->>'kind') is null or (v_record->>'kind') not in ('reference','channel','content')
      or pg_catalog.jsonb_typeof(v_record->'title') is distinct from 'string' or pg_catalog.btrim(v_record->>'title') = ''
      or pg_catalog.jsonb_typeof(v_record->'payload') is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_record->'linkedIds') is distinct from 'array'
      or pg_catalog.lower(v_record->'payload'->>'id') is distinct from v_record->>'id'
      or v_record->'payload'->>'kind' is distinct from v_record->>'kind'
      or v_record->'payload'->>'title' is distinct from v_record->>'title'
      or pg_catalog.jsonb_typeof(coalesce(v_record->'payload'->'linkedIds','[]'::jsonb)) is distinct from 'array'
      or v_record->'linkedIds' is distinct from (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.lower(value) order by ordinal),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements_text(coalesce(v_record->'payload'->'linkedIds','[]'::jsonb)) with ordinality as links(value,ordinal)
      )
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_source_snapshot->'records') source_row
        where pg_catalog.lower(source_row->>'id')=v_record->>'id' and source_row=v_record->'payload') then
      raise exception 'Normalized record does not match canonical source snapshot' using errcode = '22023';
    end if;
  end loop;
  for v_file in select value from pg_catalog.jsonb_array_elements(p_manifest->'files') loop
    if pg_catalog.jsonb_typeof(v_file) is distinct from 'object'
      or (v_file->>'id') is null or (v_file->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_file->>'recordId') is null or (v_file->>'recordId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(v_file->'payload') is distinct from 'object'
      or pg_catalog.lower(v_file->'payload'->>'id') is distinct from v_file->>'id'
      or pg_catalog.lower(v_file->'payload'->>'recordId') is distinct from v_file->>'recordId'
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_source_snapshot->'files') source_row
        where pg_catalog.lower(source_row->>'id')=v_file->>'id' and source_row=v_file->'payload') then
      raise exception 'Normalized attachment does not match canonical source snapshot' using errcode = '22023';
    end if;
  end loop;

  -- Serialize imports within this workspace, then recheck the explicit owner.
  select * into v_workspace from public.studio_workspaces where id=p_workspace_id for update;
  if not found or v_workspace.brand <> 'substo' or v_workspace.workspace_type <> 'substo_standalone'
    or not exists(select 1 from public.studio_workspace_memberships where workspace_id=p_workspace_id
      and workspace_brand='substo' and clerk_user_id=p_owner_clerk_user_id and role='owner') then
    raise exception 'Import requires the target Substo workspace owner' using errcode = '42501';
  end if;

  v_signature := pg_catalog.md5(p_manifest::text);
  select * into v_run from public.studio_library_import_runs
    where workspace_id=p_workspace_id and source_digest=p_source_digest;
  if found then
    if v_run.manifest_signature <> v_signature then
      raise exception 'Snapshot digest already belongs to a different manifest' using errcode = '23505';
    end if;
    -- Never reapply original payload over edits made after a successful import.
    v_replayed := true;
  else
    for v_record in select value from pg_catalog.jsonb_array_elements(p_manifest->'records') loop
      if pg_catalog.jsonb_typeof(v_record) is distinct from 'object'
        or (v_record->>'id') is null or (v_record->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (v_record->>'kind') is null or (v_record->>'kind') not in ('reference','channel','content')
        or pg_catalog.jsonb_typeof(v_record->'title') is distinct from 'string' or pg_catalog.btrim(v_record->>'title') = ''
        or pg_catalog.jsonb_typeof(v_record->'payload') is distinct from 'object'
        or pg_catalog.jsonb_typeof(v_record->'linkedIds') is distinct from 'array'
        or pg_catalog.lower(v_record->'payload'->>'id') is distinct from v_record->>'id'
        or v_record->'payload'->>'kind' is distinct from v_record->>'kind'
        or v_record->'payload'->>'title' is distinct from v_record->>'title' then
        raise exception 'Invalid normalized library record' using errcode = '22023';
      end if;
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_source_snapshot->'records') source_row
        where pg_catalog.lower(source_row->>'id')=v_record->>'id' and source_row=v_record->'payload') then
        raise exception 'Normalized record does not match canonical source snapshot' using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(coalesce(v_record->'payload'->'linkedIds','[]'::jsonb)) is distinct from 'array' then
        raise exception 'Invalid source relationships' using errcode = '22023';
      end if;
      if v_record->'linkedIds' is distinct from (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.lower(value) order by ordinal),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements_text(coalesce(v_record->'payload'->'linkedIds','[]'::jsonb)) with ordinality as links(value,ordinal)
      ) then
        raise exception 'Normalized relationships do not match source payload' using errcode = '22023';
      end if;
      insert into public.studio_records(workspace_id,id,kind,title,payload,legacy_payload,created_by_clerk_user_id)
        values(p_workspace_id,(v_record->>'id')::uuid,v_record->>'kind',v_record->>'title',v_record->'payload',v_record->'payload',p_owner_clerk_user_id);
    end loop;

    for v_record in select value from pg_catalog.jsonb_array_elements(p_manifest->'records') loop
      for v_link in select value from pg_catalog.jsonb_array_elements_text(v_record->'linkedIds') loop
        if v_link is null or v_link !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or not exists(select 1 from pg_catalog.jsonb_array_elements(p_manifest->'records') r where r->>'id'=v_link) then
          raise exception 'Link target is outside the import snapshot' using errcode = '22023';
        end if;
        insert into public.studio_record_links(workspace_id,source_id,target_id)
          values(p_workspace_id,(v_record->>'id')::uuid,v_link::uuid);
      end loop;
    end loop;

    for v_file in select value from pg_catalog.jsonb_array_elements(p_manifest->'files') loop
      if pg_catalog.jsonb_typeof(v_file) is distinct from 'object'
        or (v_file->>'id') is null or (v_file->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (v_file->>'recordId') is null or (v_file->>'recordId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or pg_catalog.jsonb_typeof(v_file->'payload') is distinct from 'object'
        or pg_catalog.lower(v_file->'payload'->>'id') is distinct from v_file->>'id'
        or pg_catalog.lower(v_file->'payload'->>'recordId') is distinct from v_file->>'recordId'
        or not exists(select 1 from pg_catalog.jsonb_array_elements(p_manifest->'records') r where r->>'id'=v_file->>'recordId') then
        raise exception 'Invalid normalized attachment metadata' using errcode = '22023';
      end if;
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_source_snapshot->'files') source_row
        where pg_catalog.lower(source_row->>'id')=v_file->>'id' and source_row=v_file->'payload') then
        raise exception 'Normalized attachment does not match canonical source snapshot' using errcode = '22023';
      end if;
      insert into public.studio_legacy_files(workspace_id,id,record_id,payload)
        values(p_workspace_id,(v_file->>'id')::uuid,(v_file->>'recordId')::uuid,v_file->'payload');
    end loop;

    select pg_catalog.jsonb_build_object(
      'records',pg_catalog.count(*),
      'library',pg_catalog.count(*) filter(where r->>'kind'='reference'),
      'channels',pg_catalog.count(*) filter(where r->>'kind'='channel'),
      'content',pg_catalog.count(*) filter(where r->>'kind'='content'),
      'files',pg_catalog.jsonb_array_length(p_manifest->'files'),
      'links',coalesce(pg_catalog.sum(pg_catalog.jsonb_array_length(r->'linkedIds')),0)
    ) into v_counts from pg_catalog.jsonb_array_elements(p_manifest->'records') r;
    if p_manifest->'counts' is distinct from v_counts then
      raise exception 'Import counts did not reconcile' using errcode = '22023';
    end if;
    insert into public.studio_library_import_runs(workspace_id,source_digest,manifest_signature,counts,media_pending,imported_by_clerk_user_id)
      values(p_workspace_id,p_source_digest,v_signature,v_counts,pg_catalog.jsonb_array_length(p_manifest->'files'),p_owner_clerk_user_id)
      returning * into v_run;
  end if;

  return pg_catalog.jsonb_build_object('runId',v_run.id,'workspaceId',p_workspace_id,'sourceDigest',p_source_digest,
    'counts',v_run.counts,'mediaPending',v_run.media_pending,'replayed',v_replayed);
end;
$$;
revoke all on function public.studio_import_library(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studio_import_library(uuid,text,jsonb,text) to service_role;
commit;
