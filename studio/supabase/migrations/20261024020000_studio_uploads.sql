-- Customer uploads straight from the browser to private R2 (presigned PUT),
-- registered against a location record and transcribed by the hosted worker.
-- Transcripts are saved per chunk so a retried job never re-bills finished work.
begin;

create table public.studio_uploads (
  id uuid primary key,
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  record_id uuid not null,
  original_filename text not null check (char_length(original_filename) between 1 and 255 and original_filename !~ '[[:cntrl:]/\\]'),
  content_type text not null check (content_type in ('video/mp4','video/quicktime','video/webm','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','audio/ogg','audio/aac')),
  byte_size bigint not null check (byte_size between 1 and 5368709120),
  bucket_id text not null check (bucket_id ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  object_key text not null,
  status text not null default 'awaiting_upload' check (status in ('awaiting_upload','uploaded')),
  media_object_id uuid,
  transcription_job_id uuid references public.studio_jobs(id) on delete set null,
  created_by_clerk_user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  uploaded_at timestamptz,
  unique (bucket_id,object_key),
  unique (media_object_id),
  foreign key (location_id,record_id) references public.studio_records(location_id,id) on delete cascade,
  foreign key (media_object_id,location_id) references public.studio_media_objects(id,location_id) on delete restrict,
  check (object_key = location_id::text || '/uploads/' || id::text || '/original'),
  check ((status = 'uploaded') = (media_object_id is not null and uploaded_at is not null))
);
create index studio_uploads_record_idx on public.studio_uploads(location_id,record_id,created_at desc);

create table public.studio_transcript_chunks (
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  upload_id uuid not null references public.studio_uploads(id) on delete cascade,
  chunk_index integer not null check (chunk_index between 0 and 10000),
  start_seconds numeric not null check (start_seconds >= 0),
  duration_seconds numeric not null check (duration_seconds >= 0),
  model text not null check (model ~ '^[A-Za-z0-9._:-]{1,100}$'),
  text text not null check (char_length(text) <= 1000000),
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now(),
  primary key (upload_id,chunk_index)
);

create table public.studio_transcripts (
  upload_id uuid primary key references public.studio_uploads(id) on delete cascade,
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  model text not null,
  language text check (language is null or language ~ '^[a-z]{2,12}$'),
  duration_seconds numeric not null check (duration_seconds >= 0),
  text text not null check (char_length(text) <= 20000000),
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now()
);

alter table public.studio_uploads enable row level security;
alter table public.studio_transcript_chunks enable row level security;
alter table public.studio_transcripts enable row level security;
revoke all on public.studio_uploads, public.studio_transcript_chunks, public.studio_transcripts from public,anon,authenticated,service_role;
grant select on public.studio_uploads, public.studio_transcript_chunks, public.studio_transcripts to service_role;

-- Any location member may upload to a record in that location. Estio
-- authority is checked by the server; Substo membership is locked here.
create function public.studio_lock_location_member(p_location_id text, p_actor_app text, p_clerk_user_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_app text;
begin
  if p_actor_app is null or p_actor_app not in ('estio','substo') or p_clerk_user_id is null or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Invalid actor' using errcode = '22023';
  end if;
  select app into v_app from public.studio_locations where location_id=p_location_id;
  if v_app is null or v_app <> p_actor_app then raise exception 'Location access denied' using errcode = '42501'; end if;
  if v_app = 'substo' then
    perform 1 from public.studio_location_memberships where location_id=p_location_id and location_app='substo' and clerk_user_id=p_clerk_user_id for share;
    if not found then raise exception 'Location access denied' using errcode = '42501'; end if;
  end if;
end;
$$;
revoke all on function public.studio_lock_location_member(text,text,text) from public,anon,authenticated,service_role;

create function public.studio_create_upload(p_location_id text, p_actor_app text, p_clerk_user_id text, p_upload_id uuid,
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
      or v_row.content_type <> p_content_type or v_row.created_by_clerk_user_id <> p_clerk_user_id then
      raise exception 'Upload id already used' using errcode = '23505';
    end if;
  end if;
  return v_row;
end;
$$;

-- Called by the server after HeadObject confirmed the object and its exact size.
-- Registers the media object and queues transcription in one transaction.
create function public.studio_complete_upload(p_location_id text, p_actor_app text, p_clerk_user_id text, p_upload_id uuid, p_observed_size bigint)
returns public.studio_uploads language plpgsql security definer set search_path = '' as $$
declare
  v_row public.studio_uploads%rowtype;
  v_media uuid;
  v_job public.studio_jobs%rowtype;
begin
  perform public.studio_lock_location_member(p_location_id, p_actor_app, p_clerk_user_id);
  select * into v_row from public.studio_uploads where id=p_upload_id and location_id=p_location_id for update;
  if not found then raise exception 'Upload not found' using errcode = '22023'; end if;
  if v_row.status = 'uploaded' then return v_row; end if;
  if v_row.created_by_clerk_user_id <> p_clerk_user_id then raise exception 'Only the uploader can finish this upload' using errcode = '42501'; end if;
  if pg_catalog.now() > v_row.expires_at + interval '6 hours' then raise exception 'Upload expired' using errcode = '22023'; end if;
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

-- Worker-only (service role). Chunk saves are idempotent; a conflicting resave is refused.
create function public.studio_save_transcript_chunk(p_location_id text, p_upload_id uuid, p_chunk_index integer, p_start_seconds numeric,
  p_duration_seconds numeric, p_model text, p_text text, p_segments jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.studio_uploads where id=p_upload_id and location_id=p_location_id and status='uploaded') then
    raise exception 'Upload not ready' using errcode = '22023';
  end if;
  insert into public.studio_transcript_chunks(location_id,upload_id,chunk_index,start_seconds,duration_seconds,model,text,segments)
    values(p_location_id,p_upload_id,p_chunk_index,p_start_seconds,p_duration_seconds,p_model,p_text,p_segments)
    on conflict (upload_id,chunk_index) do nothing;
  return found;
end;
$$;

create function public.studio_save_transcript(p_location_id text, p_upload_id uuid, p_model text, p_language text, p_duration_seconds numeric)
returns public.studio_transcripts language plpgsql security definer set search_path = '' as $$
declare v_row public.studio_transcripts%rowtype;
begin
  if not exists(select 1 from public.studio_uploads where id=p_upload_id and location_id=p_location_id and status='uploaded') then
    raise exception 'Upload not ready' using errcode = '22023';
  end if;
  -- Assemble from the saved chunks so the transcript always equals what was billed.
  insert into public.studio_transcripts(upload_id,location_id,model,language,duration_seconds,text,segments)
    select p_upload_id,p_location_id,p_model,p_language,p_duration_seconds,
      coalesce(pg_catalog.string_agg(pg_catalog.btrim(text),' ' order by chunk_index) filter (where pg_catalog.btrim(text) <> ''),''),
      coalesce((select pg_catalog.jsonb_agg(s order by c.chunk_index, o) from public.studio_transcript_chunks c,
        pg_catalog.jsonb_array_elements(c.segments) with ordinality as e(s,o) where c.upload_id=p_upload_id),'[]'::jsonb)
    from public.studio_transcript_chunks where upload_id=p_upload_id
    on conflict (upload_id) do nothing returning * into v_row;
  if v_row.upload_id is null then select * into v_row from public.studio_transcripts where upload_id=p_upload_id; end if;
  return v_row;
end;
$$;

revoke all on function public.studio_create_upload(text,text,text,uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.studio_complete_upload(text,text,text,uuid,bigint) from public,anon,authenticated;
revoke all on function public.studio_save_transcript_chunk(text,uuid,integer,numeric,numeric,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.studio_save_transcript(text,uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.studio_create_upload(text,text,text,uuid,uuid,text,text,bigint,text) to service_role;
grant execute on function public.studio_complete_upload(text,text,text,uuid,bigint) to service_role;
grant execute on function public.studio_save_transcript_chunk(text,uuid,integer,numeric,numeric,text,text,jsonb) to service_role;
grant execute on function public.studio_save_transcript(text,uuid,text,text,numeric) to service_role;
commit;
