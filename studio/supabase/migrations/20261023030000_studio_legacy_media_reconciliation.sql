-- Legacy library attachment upload reconciliation. Studio media bytes live in
-- a private Cloudflare R2 bucket (S3 API), not Supabase Storage; this database
-- holds only metadata. Reservations name a location-scoped object key, and a
-- media object is created and linked to the original attachment only after the
-- operator read the R2 object back and its SHA-256 and size matched.
-- Original attachment payloads never change.
begin;

-- The core migration labelled every object with the unused 'studio-media'
-- Supabase bucket. Nothing has been deployed, so record the R2 provider and
-- bucket explicitly instead. The Supabase bucket deny policies stay harmless.
alter table public.studio_media_objects drop constraint if exists studio_media_objects_bucket_id_check;
alter table public.studio_media_objects alter column bucket_id drop default;
alter table public.studio_media_objects
  add column storage_provider text not null default 'cloudflare_r2' check (storage_provider = 'cloudflare_r2'),
  add constraint studio_media_objects_r2_bucket_check check (bucket_id ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$');

create table public.studio_legacy_media_transfers (
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  file_id uuid not null,
  record_id uuid not null,
  bucket_id text not null check (bucket_id ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  library_source_digest text not null check (library_source_digest ~ '^[0-9a-f]{64}$'),
  media_source_digest text not null check (media_source_digest ~ '^[0-9a-f]{64}$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  object_key text not null,
  status text not null check (status in ('pending','verified')),
  media_object_id uuid,
  reserved_by_clerk_user_id text not null check (pg_catalog.btrim(reserved_by_clerk_user_id) <> ''),
  reserved_at timestamptz not null default now(),
  verified_by_clerk_user_id text,
  verified_at timestamptz,
  primary key (location_id,file_id),
  unique (bucket_id,object_key),
  foreign key (location_id,file_id) references public.studio_legacy_files(location_id,id) on delete cascade,
  foreign key (media_object_id,location_id) references public.studio_media_objects(id,location_id) on delete restrict,
  check (object_key = location_id::text || '/legacy-library/' || file_id::text || '/' || sha256),
  check ((status = 'verified') = (media_object_id is not null and verified_at is not null and verified_by_clerk_user_id is not null))
);
alter table public.studio_legacy_media_transfers enable row level security;
revoke all on public.studio_legacy_media_transfers from public,anon,authenticated,service_role;
grant select on public.studio_legacy_media_transfers to service_role;

-- Binding goes through the owner-checked RPC below, never direct service writes.
revoke insert,update,delete,truncate on public.studio_legacy_files from service_role;
revoke insert,update,delete,truncate on public.studio_media_objects from service_role;

create function public.studio_lock_legacy_media_owner(p_location_id text, p_owner_clerk_user_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_location public.studio_locations%rowtype;
begin
  if p_location_id is null or p_owner_clerk_user_id is null or pg_catalog.btrim(p_owner_clerk_user_id) = '' then
    raise exception 'Invalid media reconciliation target' using errcode = '22023';
  end if;
  select * into v_location from public.studio_locations where location_id=p_location_id for update;
  if not found or v_location.app <> 'substo' then
    raise exception 'Media reconciliation requires the target Substo location owner' using errcode = '42501';
  end if;
  perform 1 from public.studio_location_memberships where location_id=p_location_id
    and location_app='substo' and clerk_user_id=p_owner_clerk_user_id and role='owner' for share;
  if not found then
    raise exception 'Media reconciliation requires the target Substo location owner' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.studio_lock_legacy_media_owner(text,text) from public,anon,authenticated,service_role;

-- p_files: [{id, recordId, sha256, byteSize, originalFilename, contentType}],
-- each matching an original imported attachment exactly.
create function public.studio_reserve_legacy_media(
  p_location_id text, p_owner_clerk_user_id text, p_library_source_digest text,
  p_media_source_digest text, p_bucket_id text, p_files jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_file jsonb;
  v_legacy public.studio_legacy_files%rowtype;
  v_transfer public.studio_legacy_media_transfers%rowtype;
  v_key text;
  v_result jsonb := '[]'::jsonb;
begin
  if p_library_source_digest is null or p_library_source_digest !~ '^[0-9a-f]{64}$'
    or p_media_source_digest is null or p_media_source_digest !~ '^[0-9a-f]{64}$'
    or p_bucket_id is null or p_bucket_id !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
    or pg_catalog.jsonb_typeof(p_files) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_files) > 10000 then
    raise exception 'Invalid media reservation' using errcode = '22023';
  end if;
  perform public.studio_lock_legacy_media_owner(p_location_id, p_owner_clerk_user_id);
  if not exists(select 1 from public.studio_library_import_runs
    where location_id=p_location_id and source_digest=p_library_source_digest) then
    raise exception 'Matching library import is required before media reconciliation' using errcode = '22023';
  end if;
  if (select pg_catalog.count(distinct value->>'id') from pg_catalog.jsonb_array_elements(p_files)) <> pg_catalog.jsonb_array_length(p_files) then
    raise exception 'Duplicate media reservation' using errcode = '22023';
  end if;

  for v_file in select value from pg_catalog.jsonb_array_elements(p_files) loop
    if pg_catalog.jsonb_typeof(v_file) is distinct from 'object'
      or (v_file->>'id') is null or (v_file->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_file->>'recordId') is null or (v_file->>'recordId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_file->>'sha256') is null or (v_file->>'sha256') !~ '^[0-9a-f]{64}$'
      or pg_catalog.jsonb_typeof(v_file->'byteSize') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_file->'originalFilename') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_file->'contentType') is distinct from 'string' then
      raise exception 'Invalid media reservation row' using errcode = '22023';
    end if;
    select * into v_legacy from public.studio_legacy_files
      where location_id=p_location_id and id=(v_file->>'id')::uuid for update;
    if not found or v_legacy.record_id <> (v_file->>'recordId')::uuid
      or v_legacy.payload->'size' is distinct from v_file->'byteSize'
      or v_legacy.payload->'name' is distinct from v_file->'originalFilename'
      or v_legacy.payload->'type' is distinct from v_file->'contentType' then
      raise exception 'Media row does not match the imported original attachment' using errcode = '22023';
    end if;
    v_key := p_location_id::text || '/legacy-library/' || v_legacy.id::text || '/' || (v_file->>'sha256');
    select * into v_transfer from public.studio_legacy_media_transfers
      where location_id=p_location_id and file_id=v_legacy.id for update;
    if found and v_transfer.status = 'verified' then
      if v_transfer.bucket_id <> p_bucket_id or v_transfer.sha256 <> v_file->>'sha256' or v_transfer.byte_size <> (v_file->>'byteSize')::bigint then
        raise exception 'Attachment is already bound to different verified bytes' using errcode = '23505';
      end if;
    elsif found then
      -- A pending reservation has no binding; reviewed new evidence may replace it.
      update public.studio_legacy_media_transfers set bucket_id=p_bucket_id, library_source_digest=p_library_source_digest,
        media_source_digest=p_media_source_digest, sha256=v_file->>'sha256', byte_size=(v_file->>'byteSize')::bigint,
        object_key=v_key, reserved_by_clerk_user_id=p_owner_clerk_user_id, reserved_at=pg_catalog.now()
        where location_id=p_location_id and file_id=v_legacy.id returning * into v_transfer;
    else
      if v_legacy.media_object_id is not null then
        raise exception 'Attachment already has media outside this reconciliation' using errcode = '23505';
      end if;
      insert into public.studio_legacy_media_transfers(location_id,file_id,record_id,bucket_id,library_source_digest,media_source_digest,
        sha256,byte_size,object_key,status,reserved_by_clerk_user_id)
        values(p_location_id,v_legacy.id,v_legacy.record_id,p_bucket_id,p_library_source_digest,p_media_source_digest,
        v_file->>'sha256',(v_file->>'byteSize')::bigint,v_key,'pending',p_owner_clerk_user_id)
        returning * into v_transfer;
    end if;
    v_result := v_result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('fileId',v_transfer.file_id,
      'bucketId',v_transfer.bucket_id,'objectKey',v_transfer.object_key,'status',v_transfer.status,'mediaObjectId',v_transfer.media_object_id));
  end loop;
  return pg_catalog.jsonb_build_object('locationId',p_location_id,'mediaSourceDigest',p_media_source_digest,'files',v_result);
end;
$$;

-- Call only after the operator read the R2 object back and its SHA-256 and size
-- matched. The database cannot see R2, so that read-back is the byte evidence;
-- this RPC enforces owner authority, the reservation, and the unbound original.
create function public.studio_bind_legacy_media(
  p_location_id text, p_owner_clerk_user_id text, p_file_id uuid, p_sha256 text, p_byte_size bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_transfer public.studio_legacy_media_transfers%rowtype;
  v_legacy public.studio_legacy_files%rowtype;
  v_media_id uuid;
begin
  if p_file_id is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_byte_size is null or p_byte_size < 0 then
    raise exception 'Invalid media binding' using errcode = '22023';
  end if;
  perform public.studio_lock_legacy_media_owner(p_location_id, p_owner_clerk_user_id);
  select * into v_transfer from public.studio_legacy_media_transfers
    where location_id=p_location_id and file_id=p_file_id for update;
  if not found or v_transfer.sha256 <> p_sha256 or v_transfer.byte_size <> p_byte_size then
    raise exception 'Media binding does not match its reservation' using errcode = '22023';
  end if;
  if v_transfer.status = 'verified' then
    return pg_catalog.jsonb_build_object('fileId',p_file_id,'mediaObjectId',v_transfer.media_object_id,'bucketId',v_transfer.bucket_id,'objectKey',v_transfer.object_key,'replayed',true);
  end if;
  select * into v_legacy from public.studio_legacy_files where location_id=p_location_id and id=p_file_id for update;
  if not found or v_legacy.media_object_id is not null or v_legacy.record_id <> v_transfer.record_id
    or v_legacy.payload->'size' is distinct from pg_catalog.to_jsonb(p_byte_size) then
    raise exception 'Original attachment no longer matches its reservation' using errcode = '22023';
  end if;
  insert into public.studio_media_objects(location_id,storage_provider,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
    values(p_location_id,'cloudflare_r2',v_transfer.bucket_id,v_transfer.object_key,v_legacy.payload->>'name',v_legacy.payload->>'type',p_byte_size,p_sha256,p_owner_clerk_user_id)
    returning id into v_media_id;
  update public.studio_legacy_files set media_object_id=v_media_id where location_id=p_location_id and id=p_file_id;
  update public.studio_legacy_media_transfers set status='verified',media_object_id=v_media_id,
    verified_by_clerk_user_id=p_owner_clerk_user_id,verified_at=pg_catalog.now()
    where location_id=p_location_id and file_id=p_file_id;
  return pg_catalog.jsonb_build_object('fileId',p_file_id,'mediaObjectId',v_media_id,'bucketId',v_transfer.bucket_id,'objectKey',v_transfer.object_key,'replayed',false);
end;
$$;

revoke all on function public.studio_reserve_legacy_media(text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.studio_bind_legacy_media(text,text,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.studio_reserve_legacy_media(text,text,text,text,text,jsonb) to service_role;
grant execute on function public.studio_bind_legacy_media(text,text,uuid,text,bigint) to service_role;
commit;
