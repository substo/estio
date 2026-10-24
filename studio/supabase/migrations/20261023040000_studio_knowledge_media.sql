-- Knowledge frame images (evidence frames and source-unit frames) reconciled to
-- private Cloudflare R2 objects. Same contract as legacy library media: reserve
-- against the imported row, upload create-only, read back, then bind atomically.
-- Imported evidence and unit payloads never change.
begin;

create table public.studio_knowledge_media_links (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  ref_kind text not null check (ref_kind in ('evidence','unit')),
  ref_id uuid not null,
  frame_file text not null check (frame_file ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}\.(jpe?g|png|webp)$'),
  knowledge_source_digest text not null check (knowledge_source_digest ~ '^[0-9a-f]{64}$'),
  media_source_digest text not null check (media_source_digest ~ '^[0-9a-f]{64}$'),
  bucket_id text not null check (bucket_id ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  object_key text not null,
  status text not null check (status in ('pending','verified')),
  media_object_id uuid,
  reserved_by_clerk_user_id text not null check (pg_catalog.btrim(reserved_by_clerk_user_id) <> ''),
  reserved_at timestamptz not null default now(),
  verified_by_clerk_user_id text,
  verified_at timestamptz,
  primary key (workspace_id,ref_kind,ref_id),
  unique (bucket_id,object_key),
  unique (media_object_id),
  foreign key (media_object_id,workspace_id) references public.studio_media_objects(id,workspace_id) on delete restrict,
  check (object_key = workspace_id::text || '/legacy-knowledge/' || ref_kind || '/' || ref_id::text || '/' || sha256),
  check ((status = 'verified') = (media_object_id is not null and verified_at is not null and verified_by_clerk_user_id is not null))
);
alter table public.studio_knowledge_media_links enable row level security;
revoke all on public.studio_knowledge_media_links from public,anon,authenticated,service_role;
grant select on public.studio_knowledge_media_links to service_role;

-- True when the imported row still names exactly this frame file.
create function public.studio_knowledge_frame_matches(p_workspace_id uuid, p_ref_kind text, p_ref_id uuid, p_frame_file text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_ref_kind
    when 'evidence' then exists(select 1 from public.studio_knowledge_evidence
      where workspace_id=p_workspace_id and id=p_ref_id and payload->>'frame_file' = p_frame_file)
    when 'unit' then exists(select 1 from public.studio_knowledge_source_units
      where workspace_id=p_workspace_id and id=p_ref_id and payload->'unit'->>'frameFile' = p_frame_file)
    else false end;
$$;
revoke all on function public.studio_knowledge_frame_matches(uuid,text,uuid,text) from public,anon,authenticated,service_role;

-- p_refs: [{refKind, refId, frameFile, sha256, byteSize, contentType}]
create function public.studio_reserve_knowledge_media(
  p_workspace_id uuid, p_owner_clerk_user_id text, p_knowledge_source_digest text,
  p_media_source_digest text, p_bucket_id text, p_refs jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref jsonb;
  v_link public.studio_knowledge_media_links%rowtype;
  v_key text;
  v_result jsonb := '[]'::jsonb;
begin
  if p_knowledge_source_digest is null or p_knowledge_source_digest !~ '^[0-9a-f]{64}$'
    or p_media_source_digest is null or p_media_source_digest !~ '^[0-9a-f]{64}$'
    or p_bucket_id is null or p_bucket_id !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
    or pg_catalog.jsonb_typeof(p_refs) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_refs) > 10000 then
    raise exception 'Invalid knowledge media reservation' using errcode = '22023';
  end if;
  perform public.studio_lock_legacy_media_owner(p_workspace_id, p_owner_clerk_user_id);
  if not exists(select 1 from public.studio_knowledge_import_runs
    where workspace_id=p_workspace_id and source_digest=p_knowledge_source_digest) then
    raise exception 'Matching knowledge import is required before media reconciliation' using errcode = '22023';
  end if;
  if (select pg_catalog.count(distinct (value->>'refKind') || ':' || (value->>'refId')) from pg_catalog.jsonb_array_elements(p_refs)) <> pg_catalog.jsonb_array_length(p_refs) then
    raise exception 'Duplicate knowledge media reservation' using errcode = '22023';
  end if;

  for v_ref in select value from pg_catalog.jsonb_array_elements(p_refs) loop
    if pg_catalog.jsonb_typeof(v_ref) is distinct from 'object'
      or (v_ref->>'refKind') is null or (v_ref->>'refKind') not in ('evidence','unit')
      or (v_ref->>'refId') is null or (v_ref->>'refId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_ref->>'sha256') is null or (v_ref->>'sha256') !~ '^[0-9a-f]{64}$'
      or pg_catalog.jsonb_typeof(v_ref->'byteSize') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_ref->'frameFile') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_ref->'contentType') is distinct from 'string' then
      raise exception 'Invalid knowledge media reservation row' using errcode = '22023';
    end if;
    if not public.studio_knowledge_frame_matches(p_workspace_id, v_ref->>'refKind', (v_ref->>'refId')::uuid, v_ref->>'frameFile') then
      raise exception 'Frame does not match the imported knowledge row' using errcode = '22023';
    end if;
    v_key := p_workspace_id::text || '/legacy-knowledge/' || (v_ref->>'refKind') || '/' || (v_ref->>'refId') || '/' || (v_ref->>'sha256');
    select * into v_link from public.studio_knowledge_media_links
      where workspace_id=p_workspace_id and ref_kind=v_ref->>'refKind' and ref_id=(v_ref->>'refId')::uuid for update;
    if found and v_link.status = 'verified' then
      if v_link.bucket_id <> p_bucket_id or v_link.sha256 <> v_ref->>'sha256' or v_link.byte_size <> (v_ref->>'byteSize')::bigint then
        raise exception 'Frame is already bound to different verified bytes' using errcode = '23505';
      end if;
    elsif found then
      update public.studio_knowledge_media_links set frame_file=v_ref->>'frameFile', knowledge_source_digest=p_knowledge_source_digest,
        media_source_digest=p_media_source_digest, bucket_id=p_bucket_id, sha256=v_ref->>'sha256', byte_size=(v_ref->>'byteSize')::bigint,
        content_type=v_ref->>'contentType', object_key=v_key, reserved_by_clerk_user_id=p_owner_clerk_user_id, reserved_at=pg_catalog.now()
        where workspace_id=p_workspace_id and ref_kind=v_link.ref_kind and ref_id=v_link.ref_id returning * into v_link;
    else
      insert into public.studio_knowledge_media_links(workspace_id,ref_kind,ref_id,frame_file,knowledge_source_digest,media_source_digest,
        bucket_id,sha256,byte_size,content_type,object_key,status,reserved_by_clerk_user_id)
        values(p_workspace_id,v_ref->>'refKind',(v_ref->>'refId')::uuid,v_ref->>'frameFile',p_knowledge_source_digest,p_media_source_digest,
        p_bucket_id,v_ref->>'sha256',(v_ref->>'byteSize')::bigint,v_ref->>'contentType',v_key,'pending',p_owner_clerk_user_id)
        returning * into v_link;
    end if;
    v_result := v_result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('refKind',v_link.ref_kind,'refId',v_link.ref_id,
      'bucketId',v_link.bucket_id,'objectKey',v_link.object_key,'status',v_link.status,'mediaObjectId',v_link.media_object_id));
  end loop;
  return pg_catalog.jsonb_build_object('workspaceId',p_workspace_id,'mediaSourceDigest',p_media_source_digest,'references',v_result);
end;
$$;

-- Call only after the operator read the R2 object back and it matched.
create function public.studio_bind_knowledge_media(
  p_workspace_id uuid, p_owner_clerk_user_id text, p_ref_kind text, p_ref_id uuid, p_sha256 text, p_byte_size bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.studio_knowledge_media_links%rowtype;
  v_media_id uuid;
begin
  if p_ref_kind is null or p_ref_kind not in ('evidence','unit') or p_ref_id is null
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_byte_size is null or p_byte_size < 0 then
    raise exception 'Invalid knowledge media binding' using errcode = '22023';
  end if;
  perform public.studio_lock_legacy_media_owner(p_workspace_id, p_owner_clerk_user_id);
  select * into v_link from public.studio_knowledge_media_links
    where workspace_id=p_workspace_id and ref_kind=p_ref_kind and ref_id=p_ref_id for update;
  if not found or v_link.sha256 <> p_sha256 or v_link.byte_size <> p_byte_size then
    raise exception 'Knowledge media binding does not match its reservation' using errcode = '22023';
  end if;
  if v_link.status = 'verified' then
    return pg_catalog.jsonb_build_object('refKind',p_ref_kind,'refId',p_ref_id,'mediaObjectId',v_link.media_object_id,
      'bucketId',v_link.bucket_id,'objectKey',v_link.object_key,'replayed',true);
  end if;
  if not public.studio_knowledge_frame_matches(p_workspace_id, p_ref_kind, p_ref_id, v_link.frame_file) then
    raise exception 'Imported knowledge row no longer matches its reservation' using errcode = '22023';
  end if;
  insert into public.studio_media_objects(workspace_id,storage_provider,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
    values(p_workspace_id,'cloudflare_r2',v_link.bucket_id,v_link.object_key,v_link.frame_file,v_link.content_type,p_byte_size,p_sha256,p_owner_clerk_user_id)
    returning id into v_media_id;
  update public.studio_knowledge_media_links set status='verified',media_object_id=v_media_id,
    verified_by_clerk_user_id=p_owner_clerk_user_id,verified_at=pg_catalog.now()
    where workspace_id=p_workspace_id and ref_kind=p_ref_kind and ref_id=p_ref_id;
  return pg_catalog.jsonb_build_object('refKind',p_ref_kind,'refId',p_ref_id,'mediaObjectId',v_media_id,
    'bucketId',v_link.bucket_id,'objectKey',v_link.object_key,'replayed',false);
end;
$$;

revoke all on function public.studio_reserve_knowledge_media(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.studio_bind_knowledge_media(uuid,text,text,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.studio_reserve_knowledge_media(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.studio_bind_knowledge_media(uuid,text,text,uuid,text,bigint) to service_role;
commit;
