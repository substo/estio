-- Google read grants belong to an app-realm user profile, never a location.
-- Discovery settings/bookmarks remain location-scoped and separately authorized.
begin;
create table public.platform_google_youtube_connections (
  app text not null check (app in ('estio','substo')),
  clerk_user_id text not null check (btrim(clerk_user_id)<>''),
  client_id text not null,
  refresh_cipher jsonb not null check (jsonb_typeof(refresh_cipher)='object'),
  granted_scopes text[] not null,
  version uuid not null default gen_random_uuid(),
  connected_at timestamptz not null default now(),
  primary key(app,clerk_user_id)
);
create table public.platform_google_youtube_oauth_states (
  app text not null check (app in ('estio','substo')),
  clerk_user_id text not null,
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  consumed_at timestamptz,
  primary key(app,clerk_user_id,state_hash)
);
alter table public.platform_google_youtube_connections enable row level security;
alter table public.platform_google_youtube_oauth_states enable row level security;
revoke all on public.platform_google_youtube_connections,public.platform_google_youtube_oauth_states from public,anon,authenticated,service_role;
grant select on public.platform_google_youtube_connections to service_role;

create function public.platform_youtube_oauth(p_action text,p_app text,p_user text,p_session_hash text,p_state_hash text,
  p_cipher jsonb default null,p_client_id text default null,p_scopes text[] default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_app is null or p_app not in ('estio','substo') or p_user is null or btrim(p_user)=''
    or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' or p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid profile OAuth principal' using errcode='22023';
  end if;
  -- Serialize connection replacement/removal for one realm user across callbacks.
  perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||p_app||':'||p_user,0));
  if p_action='begin' then
    delete from public.platform_google_youtube_oauth_states where app=p_app and clerk_user_id=p_user;
    insert into public.platform_google_youtube_oauth_states(app,clerk_user_id,session_hash,state_hash) values(p_app,p_user,p_session_hash,p_state_hash);
    return true;
  elsif p_action='consume' then
    update public.platform_google_youtube_oauth_states set consumed_at=now()
      where app=p_app and clerk_user_id=p_user and session_hash=p_session_hash and state_hash=p_state_hash and consumed_at is null and expires_at>now();
    return found;
  elsif p_action='commit' then
    if p_client_id is null or btrim(p_client_id)='' or jsonb_typeof(p_cipher) is distinct from 'object'
      or octet_length(p_cipher::text)>20000
      or jsonb_typeof(p_cipher->'ciphertext') is distinct from 'string' or btrim(p_cipher->>'ciphertext')=''
      or jsonb_typeof(p_cipher->'iv') is distinct from 'string' or btrim(p_cipher->>'iv')=''
      or jsonb_typeof(p_cipher->'authTag') is distinct from 'string' or btrim(p_cipher->>'authTag')=''
      or jsonb_typeof(p_cipher->'keyId') is distinct from 'string' or p_cipher->>'keyId' !~ '^[a-z0-9_-]{1,32}$'
      or not (p_cipher ?& array['ciphertext','iv','authTag','keyId']) or p_scopes is null
      or not coalesce('https://www.googleapis.com/auth/youtube.readonly'=any(p_scopes),false) or cardinality(p_scopes)>100 or array_position(p_scopes,null) is not null then raise exception 'Invalid encrypted profile grant' using errcode='22023'; end if;
    delete from public.platform_google_youtube_oauth_states where app=p_app and clerk_user_id=p_user and session_hash=p_session_hash
      and state_hash=p_state_hash and consumed_at is not null and expires_at>now();
    if not found then return false; end if;
    insert into public.platform_google_youtube_connections(app,clerk_user_id,client_id,refresh_cipher,granted_scopes)
      values(p_app,p_user,p_client_id,p_cipher,p_scopes)
      on conflict(app,clerk_user_id) do update set client_id=excluded.client_id,refresh_cipher=excluded.refresh_cipher,
        granted_scopes=excluded.granted_scopes,version=gen_random_uuid(),connected_at=now();
    delete from public.platform_google_youtube_oauth_states where app=p_app and clerk_user_id=p_user;
    return true;
  end if;
  raise exception 'Invalid OAuth action' using errcode='22023';
end;
$$;
create function public.platform_clear_youtube_connection(p_app text,p_user text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_app is null or p_app not in ('estio','substo') or p_user is null or btrim(p_user)='' then raise exception 'Invalid profile' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||p_app||':'||p_user,0));
  delete from public.platform_google_youtube_connections where app=p_app and clerk_user_id=p_user;
  delete from public.platform_google_youtube_oauth_states where app=p_app and clerk_user_id=p_user;
end;
$$;
revoke all on function public.platform_youtube_oauth(text,text,text,text,text,jsonb,text,text[]),public.platform_clear_youtube_connection(text,text) from public,anon,authenticated;
grant execute on function public.platform_youtube_oauth(text,text,text,text,text,jsonb,text,text[]),public.platform_clear_youtube_connection(text,text) to service_role;

create table public.studio_youtube_channels (
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  channel_id text not null check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  label text not null check (char_length(label) between 1 and 180),
  approved_by text not null,
  primary key(location_id,channel_id)
);
create table public.studio_youtube_usage (
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  day date not null default (now() at time zone 'UTC')::date,
  requests integer not null default 0,
  primary key(location_id,day)
);
create table public.studio_youtube_bookmarks (
  location_id text not null,
  video_id text not null check(video_id ~ '^[A-Za-z0-9_-]{11}$'),
  record_id uuid not null,
  primary key(location_id,video_id),
  foreign key(location_id,record_id) references public.studio_records(location_id,id) on delete cascade
);
alter table public.studio_youtube_channels enable row level security;
alter table public.studio_youtube_usage enable row level security;
alter table public.studio_youtube_bookmarks enable row level security;
revoke all on public.studio_youtube_channels,public.studio_youtube_usage,public.studio_youtube_bookmarks from public,anon,authenticated,service_role;
grant select on public.studio_youtube_channels to service_role;
create function public.studio_lock_youtube_member(p_location text,p_app text,p_user text) returns void
language plpgsql security definer set search_path='' as $$
declare v_app text;
begin
  select app into v_app from public.studio_locations where location_id=p_location for update;
  if p_user is null or btrim(p_user)='' or p_app is null or v_app is null or v_app<>p_app then raise exception 'Location denied' using errcode='42501'; end if;
  if v_app='substo' then
    perform 1 from public.studio_location_memberships where location_id=p_location and location_app='substo' and clerk_user_id=p_user for share;
    if not found then raise exception 'Membership denied' using errcode='42501'; end if;
  end if;
end;
$$;
revoke all on function public.studio_lock_youtube_member(text,text,text) from public,anon,authenticated,service_role;
create function public.studio_youtube_request_slot(p_location text,p_app text,p_user text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform public.studio_lock_youtube_member(p_location,p_app,p_user);
  insert into public.studio_youtube_usage(location_id,day,requests) values(p_location,(now() at time zone 'UTC')::date,1)
    on conflict(location_id,day) do update set requests=public.studio_youtube_usage.requests+1 where public.studio_youtube_usage.requests<50;
  return found;
end;
$$;
create function public.studio_youtube_channel(p_location text,p_app text,p_user text,p_channel text,p_label text,p_remove boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.studio_lock_ai_manager(p_location,p_app,p_user);
  if p_channel is null or p_channel !~ '^UC[A-Za-z0-9_-]{22}$' or p_remove is null then raise exception 'Invalid channel' using errcode='22023'; end if;
  if p_remove then delete from public.studio_youtube_channels where location_id=p_location and channel_id=p_channel;
  else
    if p_label is null or char_length(btrim(p_label)) not between 1 and 180 then raise exception 'Channel label required' using errcode='22023'; end if;
    if (select count(*) from public.studio_youtube_channels where location_id=p_location)>=100 and not exists(select 1 from public.studio_youtube_channels where location_id=p_location and channel_id=p_channel) then raise exception 'Too many approved channels' using errcode='22023'; end if;
    insert into public.studio_youtube_channels(location_id,channel_id,label,approved_by) values(p_location,p_channel,btrim(p_label),p_user)
      on conflict(location_id,channel_id) do update set label=excluded.label,approved_by=excluded.approved_by;
  end if;
end;
$$;
create function public.studio_save_youtube_bookmark(p_location text,p_app text,p_user text,p_record uuid,p_video text,p_title text,p_provenance jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_record uuid;
begin
  perform public.studio_lock_youtube_member(p_location,p_app,p_user);
  if p_record is null or p_video is null or p_video !~ '^[A-Za-z0-9_-]{11}$' or p_title is null or char_length(btrim(p_title)) not between 1 and 180
    or jsonb_typeof(p_provenance) is distinct from 'object' or p_provenance->>'kind' is null
    or p_provenance->>'kind' not in ('public_search','approved_channel','subscription','saved_url')
    or octet_length(p_provenance::text)>4096 then raise exception 'Invalid research link' using errcode='22023'; end if;
  select record_id into v_record from public.studio_youtube_bookmarks where location_id=p_location and video_id=p_video;
  if v_record is not null then return v_record; end if;
  select id into v_record from public.studio_records where location_id=p_location and kind='reference'
    and source_url='https://www.youtube.com/watch?v='||p_video order by created_at,id limit 1;
  if v_record is not null then
    insert into public.studio_youtube_bookmarks(location_id,video_id,record_id) values(p_location,p_video,v_record);
    return v_record;
  end if;
  insert into public.studio_records(location_id,id,kind,title,payload,created_by_clerk_user_id)
    values(p_location,p_record,'reference',btrim(p_title),jsonb_build_object('title',btrim(p_title),'url','https://www.youtube.com/watch?v='||p_video,
      'platform','YouTube','discovery',p_provenance,'approved',false,'archived',false),p_user);
  insert into public.studio_youtube_bookmarks(location_id,video_id,record_id) values(p_location,p_video,p_record);
  return p_record;
end;
$$;
revoke all on function public.studio_youtube_request_slot(text,text,text),public.studio_youtube_channel(text,text,text,text,text,boolean),public.studio_save_youtube_bookmark(text,text,text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_youtube_request_slot(text,text,text),public.studio_youtube_channel(text,text,text,text,text,boolean),public.studio_save_youtube_bookmark(text,text,text,uuid,text,text,jsonb) to service_role;
commit;
