-- Browser upload replay binding. Existing media/job transaction and paid worker contracts remain unchanged.
begin;
create or replace function public.studio_create_upload(p_location_id text, p_actor_app text, p_clerk_user_id text, p_upload_id uuid,
  p_record_id uuid, p_original_filename text, p_content_type text, p_byte_size bigint, p_bucket_id text)
returns public.studio_uploads language plpgsql security definer set search_path = '' as $$
declare v_row public.studio_uploads%rowtype;
begin
  perform public.studio_lock_location_member(p_location_id, p_actor_app, p_clerk_user_id);
  if not exists(select 1 from public.studio_records where location_id=p_location_id and id=p_record_id) then
    raise exception 'Record not found in this location' using errcode = '22023';
  end if;
  insert into public.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,created_by_clerk_user_id)
    values(p_upload_id,p_location_id,p_record_id,p_original_filename,p_content_type,p_byte_size,p_bucket_id,
      p_location_id::text || '/uploads/' || p_upload_id::text || '/original',p_clerk_user_id)
    on conflict (id) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.studio_uploads where id=p_upload_id;
    if v_row.location_id <> p_location_id or v_row.record_id <> p_record_id or v_row.byte_size <> p_byte_size
      or v_row.content_type <> p_content_type or v_row.created_by_clerk_user_id <> p_clerk_user_id
      or v_row.original_filename <> p_original_filename or v_row.bucket_id <> p_bucket_id then
      raise exception 'Upload id already used' using errcode = '23505';
    end if;
  end if;
  return v_row;
end;
$$;

-- Called by the server after HeadObject confirmed the object and its exact size.
-- Registers the media object and queues transcription in one transaction.
create or replace function public.studio_complete_upload(p_location_id text, p_actor_app text, p_clerk_user_id text, p_upload_id uuid, p_observed_size bigint)
returns public.studio_uploads language plpgsql security definer set search_path = '' as $$
declare
  v_row public.studio_uploads%rowtype;
  v_media uuid;
  v_job public.studio_jobs%rowtype;
begin
  perform public.studio_lock_location_member(p_location_id, p_actor_app, p_clerk_user_id);
  select * into v_row from public.studio_uploads where id=p_upload_id and location_id=p_location_id for update;
  if not found then raise exception 'Upload not found' using errcode = '22023'; end if;
  if v_row.created_by_clerk_user_id <> p_clerk_user_id then raise exception 'Only the uploader can finish this upload' using errcode = '42501'; end if;
  if v_row.status = 'uploaded' then return v_row; end if;
  if pg_catalog.now() >= v_row.expires_at + interval '6 hours' then raise exception 'Upload expired' using errcode = '22023'; end if;
  if p_observed_size is distinct from v_row.byte_size then raise exception 'Stored object size does not match' using errcode = '22023'; end if;
  insert into public.studio_media_objects(location_id,storage_provider,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
    values(p_location_id,'cloudflare_r2',v_row.bucket_id,v_row.object_key,v_row.original_filename,v_row.content_type,v_row.byte_size,null,p_clerk_user_id)
    returning id into v_media;
  v_job := public.studio_enqueue_job(p_location_id,'studio.transcribe_upload',pg_catalog.jsonb_build_object('uploadId',p_upload_id),
    'transcribe:' || p_upload_id::text, p_clerk_user_id, 5);
  update public.studio_uploads set status='uploaded', media_object_id=v_media, uploaded_at=pg_catalog.now(), transcription_job_id=v_job.id
    where id=p_upload_id returning * into v_row;
  return v_row;
end;
$$;

commit;
