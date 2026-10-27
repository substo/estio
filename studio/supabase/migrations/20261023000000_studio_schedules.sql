-- Schedule definitions only. No enabled state, dispatch time, or execution path
-- exists until the hosted worker and customer credentials are implemented.
begin;
create table public.studio_schedules (
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  id uuid not null,
  preset_id text not null check (preset_id in ('youtube-discovery','idea-review','script-brief')),
  focus text not null check (char_length(focus) <= 160 and focus !~ '[[:cntrl:]]'),
  interval_hours integer not null check (interval_hours in (24,168)),
  daily_time text not null check (daily_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone text not null default 'Asia/Nicosia' check (time_zone = 'Asia/Nicosia'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (location_id,id)
);
alter table public.studio_schedules enable row level security;
revoke all on public.studio_schedules from public,anon,authenticated,service_role;
grant select on public.studio_schedules to service_role;

create function public.studio_save_schedule(
  p_location_id text, p_id uuid, p_expected_version bigint,
  p_actor_app text, p_clerk_user_id text,
  p_preset_id text, p_focus text, p_interval_hours integer, p_daily_time text
) returns public.studio_schedules
language plpgsql security definer set search_path = '' as $$
declare
  v_app text;
  v_row public.studio_schedules%rowtype;
begin
  if p_location_id is null or p_id is null or p_expected_version is null or p_expected_version < 0
    or p_actor_app is null or p_actor_app not in ('estio','substo')
    or p_clerk_user_id is null or btrim(p_clerk_user_id) = ''
    or p_preset_id is null or p_preset_id not in ('youtube-discovery','idea-review','script-brief')
    or p_focus is null or char_length(p_focus) > 160 or p_focus ~ '[[:cntrl:]]'
    or p_interval_hours is null or p_interval_hours not in (24,168)
    or p_daily_time is null or p_daily_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Invalid schedule definition' using errcode = '22023';
  end if;
  select app into v_app from public.studio_locations where location_id = p_location_id;
  if v_app is null or v_app <> p_actor_app then
    raise exception 'Schedule location access denied' using errcode = '42501';
  end if;
  -- Estio authority resides in Business and must be checked by the server.
  -- Lock Substo membership so revocation cannot race the write.
  if v_app = 'substo' then
    perform 1 from public.studio_location_memberships
      where location_id = p_location_id and location_app = 'substo' and clerk_user_id = p_clerk_user_id for share;
    if not found then
      raise exception 'Schedule membership denied' using errcode = '42501';
    end if;
  end if;
  if p_expected_version = 0 then
    insert into public.studio_schedules(location_id,id,preset_id,focus,interval_hours,daily_time,updated_by)
      values(p_location_id,p_id,p_preset_id,p_focus,p_interval_hours,p_daily_time,p_clerk_user_id)
      on conflict (location_id,id) do nothing returning * into v_row;
  else
    update public.studio_schedules set preset_id = p_preset_id, focus = p_focus,
      interval_hours = p_interval_hours, daily_time = p_daily_time,
      version = version + 1, updated_at = clock_timestamp(), updated_by = p_clerk_user_id
      where location_id = p_location_id and id = p_id and version = p_expected_version
      returning * into v_row;
  end if;
  if v_row.id is null then
    raise exception 'Schedule changed or is no longer available' using errcode = '40001';
  end if;
  return v_row;
end;
$$;
revoke all on function public.studio_save_schedule(text,uuid,bigint,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.studio_save_schedule(text,uuid,bigint,text,text,text,text,integer,text) to service_role;
commit;
