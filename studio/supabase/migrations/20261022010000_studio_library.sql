-- Shared Studio records. Legacy JSON is retained without flattening citations,
-- transcript text, provenance, or unknown fields. Apply after location core.
begin;

create table public.studio_records (
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  kind text not null check (kind in ('reference', 'channel', 'content')),
  title text not null check (btrim(title) <> ''),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- A later user edit must not erase the original imported evidence.
  legacy_payload jsonb check (legacy_payload is null or jsonb_typeof(legacy_payload) = 'object'),
  source_url text generated always as (payload ->> 'url') stored,
  summary text generated always as (payload ->> 'summary') stored,
  approved boolean generated always as (payload @> '{"approved":true}'::jsonb) stored,
  archived boolean generated always as (payload @> '{"archived":true}'::jsonb) stored,
  version bigint not null default 1 check (version > 0),
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (location_id, id)
);

create index studio_records_location_library_idx on public.studio_records(location_id, kind, archived, updated_at desc, id);

create table public.studio_record_links (
  location_id text not null,
  source_id uuid not null,
  target_id uuid not null,
  primary key (location_id, source_id, target_id),
  check (source_id <> target_id),
  foreign key (location_id, source_id) references public.studio_records(location_id,id) on delete cascade,
  foreign key (location_id, target_id) references public.studio_records(location_id,id) on delete restrict
);

-- Local attachment paths remain pending until bytes are reconciled and uploaded.
-- They never become downloadable URLs merely because metadata was imported.
create table public.studio_legacy_files (
  location_id text not null,
  id uuid not null,
  record_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  media_object_id uuid,
  primary key (location_id,id),
  foreign key (location_id,record_id) references public.studio_records(location_id,id) on delete cascade,
  foreign key (media_object_id,location_id) references public.studio_media_objects(id,location_id) on delete restrict
);

alter table public.studio_records enable row level security;
alter table public.studio_record_links enable row level security;
alter table public.studio_legacy_files enable row level security;
revoke all on public.studio_records, public.studio_record_links, public.studio_legacy_files from public, anon, authenticated;
grant all on public.studio_records, public.studio_record_links, public.studio_legacy_files to service_role;

-- Creates are retry-safe for the same ID/body/actor. Updates require the version
-- displayed by the editor, so an old tab cannot silently overwrite new work.
create function public.studio_save_record(
  p_location_id text, p_record_id uuid, p_kind text, p_title text,
  p_payload_patch jsonb, p_expected_version bigint, p_clerk_user_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_record public.studio_records%rowtype;
begin
  if p_location_id is null or p_record_id is null or p_kind is null or p_kind not in ('reference','channel','content')
    or p_title is null or pg_catalog.btrim(p_title) = '' or pg_catalog.length(p_title) > 180
    or p_payload_patch is null or pg_catalog.jsonb_typeof(p_payload_patch) <> 'object'
    or p_expected_version is null or p_expected_version < 0
    or p_clerk_user_id is null or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Invalid Studio record' using errcode = '22023';
  end if;

  if p_expected_version = 0 then
    insert into public.studio_records(location_id,id,kind,title,payload,created_by_clerk_user_id)
    values(p_location_id,p_record_id,p_kind,pg_catalog.btrim(p_title),p_payload_patch,p_clerk_user_id)
    on conflict (location_id,id) do nothing;
    select * into v_record from public.studio_records where location_id=p_location_id and id=p_record_id for update;
    if v_record.kind <> p_kind or v_record.title <> pg_catalog.btrim(p_title)
      or v_record.payload <> p_payload_patch or v_record.created_by_clerk_user_id is distinct from p_clerk_user_id then
      raise exception 'Record already exists' using errcode = '23505';
    end if;
  else
    update public.studio_records set title=pg_catalog.btrim(p_title), payload=payload || p_payload_patch,
      version=version+1, updated_at=pg_catalog.now()
    where location_id=p_location_id and id=p_record_id and kind=p_kind and version=p_expected_version
    returning * into v_record;
    if not found then raise exception 'Record changed; reload before saving' using errcode = '40001'; end if;
  end if;
  return pg_catalog.to_jsonb(v_record);
end;
$$;
revoke all on function public.studio_save_record(text,uuid,text,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.studio_save_record(text,uuid,text,text,jsonb,bigint,text) to service_role;
commit;
