-- Inactive schedule draft import with immutable legacy definitions/history.
begin;
create table public.studio_schedule_import_runs (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  manifest_signature text not null check (manifest_signature ~ '^[0-9a-f]{64}$'),
  source_canonical_json text not null,
  preview_evidence jsonb not null check (jsonb_typeof(preview_evidence) = 'object'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  imported_by_clerk_user_id text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id,id), unique (workspace_id,source_digest)
);
create table public.studio_schedule_legacy_definitions (
  workspace_id uuid not null,
  id uuid not null,
  import_run_id uuid not null,
  source_index integer not null check (source_index >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id,id),
  unique (workspace_id,import_run_id,source_index),
  foreign key (workspace_id,id) references public.studio_schedules(workspace_id,id) on delete cascade,
  foreign key (workspace_id,import_run_id) references public.studio_schedule_import_runs(workspace_id,id) on delete cascade,
  unique (workspace_id,id,import_run_id)
);
create table public.studio_schedule_legacy_runs (
  workspace_id uuid not null,
  id uuid not null,
  schedule_id uuid not null,
  import_run_id uuid not null,
  source_index integer not null check (source_index >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id,id),
  unique (workspace_id,import_run_id,source_index),
  foreign key (workspace_id,schedule_id,import_run_id)
    references public.studio_schedule_legacy_definitions(workspace_id,id,import_run_id) on delete cascade
);
create index studio_schedule_legacy_runs_schedule on public.studio_schedule_legacy_runs(workspace_id,schedule_id,source_index);
alter table public.studio_schedule_import_runs enable row level security;
alter table public.studio_schedule_legacy_definitions enable row level security;
alter table public.studio_schedule_legacy_runs enable row level security;
revoke all on public.studio_schedule_import_runs,public.studio_schedule_legacy_definitions,public.studio_schedule_legacy_runs from public,anon,authenticated,service_role;
grant select on public.studio_schedule_import_runs,public.studio_schedule_legacy_definitions,public.studio_schedule_legacy_runs to service_role;

-- Validate the local scheduler's unambiguous UTC ISO timestamps without
-- accepting PostgreSQL's permissive relative or non-ISO timestamp syntax.
create function public.studio_schedule_import_timestamp_valid(p_value jsonb) returns boolean
language plpgsql set search_path = '' as $$
declare v_text text; v_time timestamptz;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  v_text := p_value #>> '{}';
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' then return false; end if;
  v_time := v_text::timestamptz;
  return replace(to_char(v_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'.000Z','Z') = replace(v_text,'.000Z','Z');
exception when others then return false;
end;
$$;
revoke all on function public.studio_schedule_import_timestamp_valid(jsonb) from public,anon,authenticated,service_role;

create function public.studio_import_schedules(p_workspace_id uuid,p_source_digest text,p_manifest jsonb,p_owner_clerk_user_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_workspace public.studio_workspaces%rowtype;
  v_import public.studio_schedule_import_runs%rowtype;
  v_snapshot jsonb;
  v_text text;
  v_signature text;
  v_entry record;
  v_row jsonb;
  v_expected jsonb;
  v_counts jsonb;
  v_replayed boolean := false;
begin
  if p_workspace_id is null or p_source_digest is null or p_source_digest !~ '^[0-9a-f]{64}$'
    or p_owner_clerk_user_id is null or btrim(p_owner_clerk_user_id) = ''
    or jsonb_typeof(p_manifest) is distinct from 'object'
    or p_manifest->>'schema' is distinct from 'studio.legacy-schedules.v1'
    or p_manifest->>'sourceDigest' is distinct from p_source_digest
    or p_manifest->>'mode' is distinct from 'dry-run'
    or p_manifest->'valid' is distinct from 'true'::jsonb
    or p_manifest->'snapshotCheckedUnchanged' is distinct from 'true'::jsonb
    or p_manifest->'executionEnabled' is distinct from 'false'::jsonb
    or p_manifest->'applySupported' is distinct from 'false'::jsonb
    or jsonb_typeof(p_manifest->'sourceCanonicalJson') is distinct from 'string'
    or jsonb_typeof(p_manifest->'schedules') is distinct from 'array'
    or jsonb_typeof(p_manifest->'runs') is distinct from 'array'
    or jsonb_typeof(p_manifest->'issues') is distinct from 'array'
    or jsonb_typeof(p_manifest->'counts') is distinct from 'object'
    or jsonb_typeof(p_manifest->'sourceFiles') is distinct from 'array'
    or octet_length(convert_to(p_manifest::text,'UTF8')) > 104857600 then
    raise exception 'Invalid schedule import manifest' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_manifest->'issues') i where i->>'severity'='error') then
    raise exception 'Schedule manifest has unresolved errors' using errcode = '22023';
  end if;
  if jsonb_array_length(p_manifest->'sourceFiles') <> 1
    or p_manifest->'sourceFiles'->0->>'relativePath' is distinct from 'schedules.json'
    or jsonb_typeof(p_manifest->'sourceFiles'->0->'sha256') is distinct from 'string'
    or p_manifest->'sourceFiles'->0->>'sha256' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_manifest->'sourceFiles'->0->'bytes') is distinct from 'number' then
    raise exception 'Invalid schedule preview evidence' using errcode = '22023';
  end if;
  if (p_manifest->'sourceFiles'->0->>'bytes')::numeric < 1
    or (p_manifest->'sourceFiles'->0->>'bytes')::numeric > 20971520
    or trunc((p_manifest->'sourceFiles'->0->>'bytes')::numeric) <> (p_manifest->'sourceFiles'->0->>'bytes')::numeric then
    raise exception 'Invalid schedule source byte count' using errcode = '22023';
  end if;
  v_text := p_manifest->>'sourceCanonicalJson';
  if octet_length(convert_to(v_text,'UTF8')) > 20971520 or encode(sha256(convert_to(v_text,'UTF8')),'hex') <> p_source_digest then
    raise exception 'Schedule source digest or size mismatch' using errcode = '22023';
  end if;
  begin v_snapshot := v_text::jsonb;
  exception when others then raise exception 'Invalid schedule source JSON' using errcode = '22023'; end;
  if jsonb_typeof(v_snapshot) is distinct from 'object' or v_snapshot->'version' is distinct from '1'::jsonb
    or jsonb_typeof(v_snapshot->'schedules') is distinct from 'array' or jsonb_typeof(v_snapshot->'runs') is distinct from 'array' then
    raise exception 'Unsupported schedule source shape' using errcode = '22023';
  end if;
  if jsonb_array_length(v_snapshot->'schedules') > 10000 or jsonb_array_length(v_snapshot->'runs') > 50000
    or jsonb_array_length(v_snapshot->'schedules') <> jsonb_array_length(p_manifest->'schedules')
    or jsonb_array_length(v_snapshot->'runs') <> jsonb_array_length(p_manifest->'runs') then
    raise exception 'Schedule row counts do not reconcile' using errcode = '22023';
  end if;

  -- Serialize imports and hold exact owner membership through the transaction.
  select * into v_workspace from public.studio_workspaces where id=p_workspace_id for update;
  if not found or v_workspace.brand <> 'substo' or v_workspace.workspace_type <> 'substo_standalone' then
    raise exception 'Import requires a standalone Substo workspace' using errcode = '42501';
  end if;
  perform 1 from public.studio_workspace_memberships where workspace_id=p_workspace_id
    and workspace_brand='substo' and clerk_user_id=p_owner_clerk_user_id and role='owner' for share;
  if not found then raise exception 'Import requires exact workspace owner' using errcode = '42501'; end if;

  v_signature := encode(sha256(convert_to(p_manifest::text,'UTF8')),'hex');
  select * into v_import from public.studio_schedule_import_runs where workspace_id=p_workspace_id and source_digest=p_source_digest;
  if found then
    if v_import.manifest_signature <> v_signature then
      raise exception 'Source digest belongs to a different manifest' using errcode = '23505';
    end if;
    v_replayed := true;
  else
    select jsonb_build_object('schedules',jsonb_array_length(v_snapshot->'schedules'),'runs',jsonb_array_length(v_snapshot->'runs'),
      'legacyEnabled',(select count(*) from jsonb_array_elements(v_snapshot->'schedules') r where r->'enabled'='true'::jsonb),
      'discovery',(select count(*) from jsonb_array_elements(v_snapshot->'schedules') r where r->>'presetId'='youtube-discovery'),
      'inFlightRuns',(select count(*) from jsonb_array_elements(v_snapshot->'runs') r where r->>'status' in ('running','queued')))
      into v_counts;
    if p_manifest->'counts' is distinct from v_counts then raise exception 'Schedule counts mismatch' using errcode = '22023'; end if;
    insert into public.studio_schedule_import_runs(workspace_id,source_digest,manifest_signature,source_canonical_json,preview_evidence,counts,imported_by_clerk_user_id)
      values(p_workspace_id,p_source_digest,v_signature,v_text,jsonb_build_object('sourceFiles',p_manifest->'sourceFiles','issues',p_manifest->'issues','snapshotCheckedUnchanged',true),v_counts,p_owner_clerk_user_id) returning * into v_import;

    for v_entry in select value,ordinality from jsonb_array_elements(v_snapshot->'schedules') with ordinality loop
      v_row := v_entry.value;
      if jsonb_typeof(v_row) is distinct from 'object'
        or jsonb_typeof(v_row->'id') is distinct from 'string' or lower(v_row->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(v_row->'presetId') is distinct from 'string' or v_row->>'presetId' not in ('youtube-discovery','idea-review','script-brief')
        or jsonb_typeof(v_row->'query') is distinct from 'string'
        or jsonb_typeof(v_row->'intervalHours') is distinct from 'number' or v_row->'intervalHours' not in ('24'::jsonb,'168'::jsonb)
        or jsonb_typeof(v_row->'dailyTime') is distinct from 'string'
        or v_row->>'timeZone' is distinct from 'Asia/Nicosia'
        or jsonb_typeof(v_row->'enabled') is distinct from 'boolean'
        or (v_row ? 'autoKnowledgeScan' and jsonb_typeof(v_row->'autoKnowledgeScan') is distinct from 'boolean')
        or not public.studio_schedule_import_timestamp_valid(v_row->'createdAt')
        or not public.studio_schedule_import_timestamp_valid(v_row->'updatedAt')
        or not public.studio_schedule_import_timestamp_valid(v_row->'nextRunAt')
        or (v_row ? 'lastRunAt' and not public.studio_schedule_import_timestamp_valid(v_row->'lastRunAt')) then
        raise exception 'Invalid legacy schedule definition' using errcode = '22023';
      end if;
      if (v_row->>'updatedAt')::timestamptz < (v_row->>'createdAt')::timestamptz then
        raise exception 'Invalid schedule timestamp order' using errcode = '22023';
      end if;
      v_expected := jsonb_build_object('sourceIndex',v_entry.ordinality-1,'id',lower(v_row->>'id'),'payload',v_row,
        'draft',jsonb_build_object('presetId',v_row->'presetId','query',v_row->'query','intervalHours',v_row->'intervalHours','dailyTime',v_row->'dailyTime'));
      if p_manifest->'schedules'->(v_entry.ordinality::integer-1) is distinct from v_expected then
        raise exception 'Schedule projection differs from source' using errcode = '22023';
      end if;
      insert into public.studio_schedules(workspace_id,id,preset_id,focus,interval_hours,daily_time,created_at,updated_at,updated_by)
        values(p_workspace_id,(v_row->>'id')::uuid,v_row->>'presetId',v_row->>'query',(v_row->>'intervalHours')::integer,v_row->>'dailyTime',
          (v_row->>'createdAt')::timestamptz,(v_row->>'updatedAt')::timestamptz,p_owner_clerk_user_id);
      insert into public.studio_schedule_legacy_definitions(workspace_id,id,import_run_id,source_index,payload)
        values(p_workspace_id,(v_row->>'id')::uuid,v_import.id,v_entry.ordinality-1,v_row);
    end loop;
    for v_entry in select value,ordinality from jsonb_array_elements(v_snapshot->'runs') with ordinality loop
      v_row := v_entry.value;
      if jsonb_typeof(v_row) is distinct from 'object'
        or jsonb_typeof(v_row->'id') is distinct from 'string' or lower(v_row->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(v_row->'scheduleId') is distinct from 'string' or lower(v_row->>'scheduleId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(v_row->'presetId') is distinct from 'string' or v_row->>'presetId' not in ('youtube-discovery','idea-review','script-brief')
        or jsonb_typeof(v_row->'status') is distinct from 'string' or v_row->>'status' not in ('running','queued','completed','failed','timeout','interrupted')
        or jsonb_typeof(v_row->'output') is distinct from 'string' or jsonb_typeof(v_row->'error') is distinct from 'string'
        or (v_row ? 'jobId' and jsonb_typeof(v_row->'jobId') is distinct from 'string')
        or not public.studio_schedule_import_timestamp_valid(v_row->'startedAt')
        or (v_row->'completedAt' is distinct from 'null'::jsonb and not public.studio_schedule_import_timestamp_valid(v_row->'completedAt'))
        or (v_row->>'status' not in ('running','queued') and v_row->'completedAt'='null'::jsonb) then
        raise exception 'Invalid legacy schedule history' using errcode = '22023';
      end if;
      if v_row->'completedAt' <> 'null'::jsonb and (v_row->>'completedAt')::timestamptz < (v_row->>'startedAt')::timestamptz then
        raise exception 'Invalid run timestamp order' using errcode = '22023';
      end if;
      v_expected := jsonb_build_object('sourceIndex',v_entry.ordinality-1,'id',lower(v_row->>'id'),'scheduleId',lower(v_row->>'scheduleId'),'payload',v_row);
      if p_manifest->'runs'->(v_entry.ordinality::integer-1) is distinct from v_expected then
        raise exception 'Run projection differs from source' using errcode = '22023';
      end if;
      insert into public.studio_schedule_legacy_runs(workspace_id,id,schedule_id,import_run_id,source_index,payload)
        values(p_workspace_id,(v_row->>'id')::uuid,(v_row->>'scheduleId')::uuid,v_import.id,v_entry.ordinality-1,v_row);
    end loop;
    if (select count(*) from public.studio_schedule_legacy_definitions where workspace_id=p_workspace_id and import_run_id=v_import.id) <> (v_counts->>'schedules')::integer
      or (select count(*) from public.studio_schedule_legacy_runs where workspace_id=p_workspace_id and import_run_id=v_import.id) <> (v_counts->>'runs')::integer then
      raise exception 'Stored schedule counts mismatch' using errcode = '22023';
    end if;
  end if;
  return jsonb_build_object('runId',v_import.id,'workspaceId',p_workspace_id,'sourceDigest',p_source_digest,
    'counts',v_import.counts,'replayed',v_replayed,'executionEnabled',false);
end;
$$;
revoke all on function public.studio_import_schedules(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studio_import_schedules(uuid,text,jsonb,text) to service_role;
commit;
