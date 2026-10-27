-- Shared one-way record link edits, serialized with ordinary content edits.
begin;
revoke all on public.studio_records,public.studio_record_links from service_role;
grant select on public.studio_records,public.studio_record_links to service_role;

-- Ordinary field writes cannot create a second, conflicting link projection.
-- Keep the existing record create/retry/update implementation behind a wrapper.
alter function public.studio_save_record(text,uuid,text,text,jsonb,bigint,text) rename to studio_save_record_fields;
revoke all on function public.studio_save_record_fields(text,uuid,text,text,jsonb,bigint,text) from public,anon,authenticated,service_role;
create function public.studio_save_record(p_location_id text,p_record_id uuid,p_kind text,p_title text,p_payload_patch jsonb,p_expected_version bigint,p_clerk_user_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_payload_patch ? 'linkedIds' then raise exception 'Use the record link operation' using errcode = '22023'; end if;
  return public.studio_save_record_fields(p_location_id,p_record_id,p_kind,p_title,p_payload_patch,p_expected_version,p_clerk_user_id);
end;
$$;
revoke all on function public.studio_save_record(text,uuid,text,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.studio_save_record(text,uuid,text,text,jsonb,bigint,text) to service_role;

create table public.studio_record_link_events (
  location_id text not null,
  id uuid not null default gen_random_uuid(),
  source_id uuid not null,
  target_id uuid not null,
  action text not null check (action in ('add','remove')),
  record_version bigint not null check (record_version > 1),
  actor_app text not null check (actor_app in ('estio','substo')),
  actor_clerk_user_id text not null,
  created_at timestamptz not null default now(),
  primary key (location_id,id),
  foreign key (location_id,source_id) references public.studio_records(location_id,id) on delete cascade,
  -- Keep the target UUID in the audit even if that record is deleted later.
  unique (location_id,source_id,record_version)
);
alter table public.studio_record_link_events enable row level security;
revoke all on public.studio_record_link_events from public,anon,authenticated,service_role;
grant select on public.studio_record_link_events to service_role;

create function public.studio_change_record_link(p_location_id text,p_source_id uuid,p_target_id uuid,p_action text,
  p_expected_version bigint,p_actor_app text,p_clerk_user_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_app text;
  v_record public.studio_records%rowtype;
  v_changed boolean;
  v_ids jsonb;
begin
  if p_location_id is null or p_source_id is null or p_target_id is null or p_source_id=p_target_id
    or p_action is null or p_action not in ('add','remove')
    or p_expected_version is null or p_expected_version < 1
    or p_actor_app is null or p_actor_app not in ('estio','substo')
    or p_clerk_user_id is null or btrim(p_clerk_user_id)='' then
    raise exception 'Invalid record link change' using errcode = '22023';
  end if;
  select app into v_app from public.studio_locations where location_id=p_location_id;
  if v_app is null or v_app <> p_actor_app then raise exception 'Record link location denied' using errcode = '42501'; end if;
  -- The application checks Estio's separate Business authority and impersonation.
  if v_app='substo' then
    perform 1 from public.studio_location_memberships where location_id=p_location_id and location_app='substo'
      and clerk_user_id=p_clerk_user_id for share;
    if not found then raise exception 'Record link membership denied' using errcode = '42501'; end if;
  end if;
  -- NO KEY UPDATE serializes field/link edits while allowing FK key-share locks
  -- for independent/reverse link operations on other records.
  select * into v_record from public.studio_records where location_id=p_location_id and id=p_source_id for no key update;
  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if v_record.version <> p_expected_version then raise exception 'Record changed; reload before linking' using errcode = '40001'; end if;
  perform 1 from public.studio_records where location_id=p_location_id and id=p_target_id;
  if not found then raise exception 'Link target not found in location' using errcode = 'P0002'; end if;

  if p_action='add' then
    if not exists(select 1 from public.studio_record_links where location_id=p_location_id and source_id=p_source_id and target_id=p_target_id)
      and (select count(*) from public.studio_record_links where location_id=p_location_id and source_id=p_source_id) >= 100 then
      raise exception 'At most 100 outgoing links can be added' using errcode = '22023';
    end if;
    insert into public.studio_record_links(location_id,source_id,target_id) values(p_location_id,p_source_id,p_target_id) on conflict do nothing;
    v_changed := found;
  else
    delete from public.studio_record_links where location_id=p_location_id and source_id=p_source_id and target_id=p_target_id;
    v_changed := found;
  end if;
  if v_changed then
    select coalesce(jsonb_agg(target_id::text order by target_id),'[]'::jsonb) into v_ids
      from public.studio_record_links where location_id=p_location_id and source_id=p_source_id;
    update public.studio_records set payload=jsonb_set(payload,'{linkedIds}',v_ids),version=version+1,updated_at=clock_timestamp()
      where location_id=p_location_id and id=p_source_id returning * into v_record;
    insert into public.studio_record_link_events(location_id,source_id,target_id,action,record_version,actor_app,actor_clerk_user_id)
      values(p_location_id,p_source_id,p_target_id,p_action,v_record.version,p_actor_app,p_clerk_user_id);
  end if;
  return jsonb_build_object('sourceId',p_source_id,'targetId',p_target_id,'version',v_record.version,'changed',v_changed);
end;
$$;
revoke all on function public.studio_change_record_link(text,uuid,uuid,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.studio_change_record_link(text,uuid,uuid,text,bigint,text,text) to service_role;
commit;
