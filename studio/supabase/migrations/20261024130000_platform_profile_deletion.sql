begin;
create table public.platform_profile_deletions (
 app text not null check(app in ('estio','substo')),clerk_user_id text not null,
 first_event_id text not null,occurred_at timestamptz not null,received_at timestamptz not null default clock_timestamp(),
 primary key(app,clerk_user_id)
);
create table public.platform_profile_deletion_events (
 app text not null check(app in ('estio','substo')),event_id text not null,clerk_user_id text not null,
 occurred_at timestamptz not null,body_digest text not null,result jsonb not null,received_at timestamptz not null default clock_timestamp(),
 primary key(app,event_id),foreign key(app,clerk_user_id) references public.platform_profile_deletions(app,clerk_user_id)
);
alter table public.platform_profile_deletions enable row level security;
alter table public.platform_profile_deletion_events enable row level security;
revoke all on public.platform_profile_deletions,public.platform_profile_deletion_events from public,anon,authenticated,service_role;
grant select on public.platform_profile_deletions,public.platform_profile_deletion_events to service_role;

-- Reuse the existing profile credential lock to avoid a second, conflicting
-- lifecycle lock order. Commands take shared claims; deletion takes exclusive.
create function public.platform_require_active_profile(p_app text,p_user text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_app is null or p_app not in ('estio','substo') or p_user is null or btrim(p_user)='' then raise exception 'Invalid profile' using errcode='22023'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('platform-youtube:'||p_app||':'||btrim(p_user),0));
 if exists(select 1 from public.platform_profile_deletions where app=p_app and clerk_user_id=btrim(p_user)) then raise exception 'Profile deleted' using errcode='42501'; end if;
end; $$;
revoke all on function public.platform_require_active_profile(text,text) from public,anon,authenticated,service_role;

create function public.platform_delete_profile(p_app text,p_user text,p_event_id text,p_occurred_at timestamptz,p_body_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.platform_profile_deletion_events%rowtype; result jsonb;
 already_deleted boolean; credentials integer; consents integer; authorizations integer; recurrences integer;
begin
 if p_app is null or p_app not in ('estio','substo') or p_user is null or p_user !~ '^user_[A-Za-z0-9_-]{1,180}$'
 or not isfinite(p_occurred_at) or p_event_id is null or p_event_id !~ '^[A-Za-z0-9_-]{1,200}$' or p_occurred_at is null
 or p_body_digest is null or p_body_digest !~ '^[0-9a-f]{64}$' then raise exception 'Invalid verified deletion' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||p_app||':'||p_user,0));
 -- Event identities are scoped to their signing realm. Serialize collisions even
 -- when conflicting deliveries name different profile IDs.
 perform pg_advisory_xact_lock(hashtextextended('profile-deletion-event:'||p_app||':'||p_event_id,0));
 select * into prior from public.platform_profile_deletion_events where app=p_app and event_id=p_event_id;
 if found then
  if prior.clerk_user_id<>p_user or prior.occurred_at<>p_occurred_at or prior.body_digest<>p_body_digest then raise exception 'Deletion event reused' using errcode='23505'; end if;
  return prior.result;
 end if;
 already_deleted:=exists(select 1 from public.platform_profile_deletions where app=p_app and clerk_user_id=p_user);
 insert into public.platform_profile_deletions(app,clerk_user_id,first_event_id,occurred_at) values(p_app,p_user,p_event_id,p_occurred_at) on conflict do nothing;
 -- Count before the existing connection trigger removes its private sources.
 credentials:=(select count(*) from public.platform_google_youtube_connections where app=p_app and clerk_user_id=p_user);
 consents:=(select count(*) from public.platform_google_youtube_oauth_states where app=p_app and clerk_user_id=p_user);
 authorizations:=(select count(*) from public.platform_youtube_schedule_authorizations where app=p_app and clerk_user_id=p_user);
 -- Pause all unattended workflows for this exact principal, including text runs.
 update public.studio_schedule_recurring set enabled=false,next_run_at=null,version=version+1,last_outcome='profile_deleted',updated_at=clock_timestamp()
 where actor_app=p_app and authorized_by=p_user and enabled;
 get diagnostics recurrences=row_count;
 perform public.platform_clear_youtube_connection(p_app,p_user);
 delete from public.platform_youtube_schedule_authorizations where app=p_app and clerk_user_id=p_user;
 result:=jsonb_build_object('alreadyDeleted',already_deleted,'credentialsRemoved',credentials,'pendingConsentsRemoved',consents,
 'sourceAuthorizationsRemoved',authorizations,'recurrencesPaused',recurrences);
 insert into public.platform_profile_deletion_events(app,event_id,clerk_user_id,occurred_at,body_digest,result)
 values(p_app,p_event_id,p_user,p_occurred_at,p_body_digest,result);
 return result;
end; $$;
revoke all on function public.platform_delete_profile(text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.platform_delete_profile(text,text,text,timestamptz,text) to service_role;

create function public.platform_guard_active_google_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.platform_require_active_profile(new.app,new.clerk_user_id);
 return new;
end; $$;
revoke all on function public.platform_guard_active_google_profile() from public,anon,authenticated,service_role;
create trigger platform_google_profile_active before insert or update on public.platform_google_youtube_connections for each row execute function public.platform_guard_active_google_profile();
create trigger platform_google_oauth_profile_active before insert on public.platform_google_youtube_oauth_states for each row execute function public.platform_guard_active_google_profile();

create or replace function public.studio_lock_location_member(p_location_id text, p_actor_app text, p_clerk_user_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_app text;
begin
  perform public.platform_require_active_profile(p_actor_app,p_clerk_user_id);
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

create or replace function public.studio_lock_ai_manager(p_location_id text, p_actor_app text, p_clerk_user_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_app text;
begin
  perform public.platform_require_active_profile(p_actor_app,p_clerk_user_id);
  if p_location_id is null or p_actor_app is null or p_actor_app not in ('estio','substo')
    or p_clerk_user_id is null or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Invalid AI settings actor' using errcode = '22023';
  end if;
  select app into v_app from public.studio_locations where location_id = p_location_id for update;
  if v_app is null or v_app <> p_actor_app then
    raise exception 'AI settings access denied' using errcode = '42501';
  end if;
  if v_app = 'substo' then
    perform 1 from public.studio_location_memberships where location_id = p_location_id and location_app = 'substo'
      and clerk_user_id = p_clerk_user_id and role in ('owner','admin') for share;
    if not found then raise exception 'AI settings require a location owner or admin' using errcode = '42501'; end if;
  end if;
end;
$$;

create or replace function public.studio_lock_youtube_member(p_location text,p_app text,p_user text) returns void
language plpgsql security definer set search_path='' as $$
declare v_app text;
begin
  perform public.platform_require_active_profile(p_app,p_user);
  select app into v_app from public.studio_locations where location_id=p_location for update;
  if p_user is null or btrim(p_user)='' or p_app is null or v_app is null or v_app<>p_app then raise exception 'Location denied' using errcode='42501'; end if;
  if v_app='substo' then
    perform 1 from public.studio_location_memberships where location_id=p_location and location_app='substo' and clerk_user_id=p_user for share;
    if not found then raise exception 'Membership denied' using errcode='42501'; end if;
  end if;
end;
$$;

create or replace function public.studio_save_schedule(
  p_location_id text, p_id uuid, p_expected_version bigint,
  p_actor_app text, p_clerk_user_id text,
  p_preset_id text, p_focus text, p_interval_hours integer, p_daily_time text
) returns public.studio_schedules
language plpgsql security definer set search_path = '' as $$
declare
  v_app text;
  v_row public.studio_schedules%rowtype;
begin
  perform public.platform_require_active_profile(p_actor_app,p_clerk_user_id);
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

create or replace function public.studio_create_substo_location(
  p_location_id text,
  p_name text,
  p_clerk_user_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.studio_locations%rowtype;
  v_owner_role text;
begin
  perform public.platform_require_active_profile('substo',p_clerk_user_id);
  if p_location_id is null
     or p_name is null
     or pg_catalog.btrim(p_name) = ''
     or p_clerk_user_id is null
     or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Location ID, name, and Clerk user ID are required'
      using errcode = '22023';
  end if;

  insert into public.studio_locations (
    location_id, app, name, created_by_clerk_user_id
  ) values (
    p_location_id, 'substo', pg_catalog.btrim(p_name), pg_catalog.btrim(p_clerk_user_id)
  )
  on conflict (location_id) do nothing;

  select * into v_location
  from public.studio_locations
  where location_id = p_location_id
  for update;

  if not found
     or v_location.app <> 'substo'
     or v_location.name <> pg_catalog.btrim(p_name)
     or v_location.created_by_clerk_user_id is distinct from pg_catalog.btrim(p_clerk_user_id) then
    raise exception 'Location ID is already used by a different location or creator'
      using errcode = '23505';
  end if;

  insert into public.studio_location_memberships (
    location_id, location_app, clerk_user_id, role
  ) values (
    p_location_id, 'substo', pg_catalog.btrim(p_clerk_user_id), 'owner'
  )
  on conflict (location_id, clerk_user_id) do nothing;

  select role into v_owner_role
  from public.studio_location_memberships
  where location_id = p_location_id
    and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

  if v_owner_role is distinct from 'owner' then
    raise exception 'Location creator already has a non-owner membership'
      using errcode = '23514';
  end if;

  return p_location_id;
end;
$$;

create or replace function public.studio_accept_substo_invitation(
  p_token_hash text,
  p_verified_email text,
  p_clerk_user_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.studio_location_invitations%rowtype;
  v_membership_id uuid;
begin
  perform public.platform_require_active_profile('substo',p_clerk_user_id);
  if p_token_hash is null
     or pg_catalog.btrim(p_token_hash) = ''
     or p_verified_email is null
     or pg_catalog.btrim(p_verified_email) = ''
     or p_clerk_user_id is null
     or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Invitation token hash, verified email, and Clerk user ID are required'
      using errcode = '22023';
  end if;

  select * into v_invitation
  from public.studio_location_invitations
  where token_hash = pg_catalog.btrim(p_token_hash)
  for update;

  if not found then
    raise exception 'Invitation is invalid'
      using errcode = 'P0002';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(v_invitation.email))
     <> pg_catalog.lower(pg_catalog.btrim(p_verified_email)) then
    raise exception 'Verified email does not match invitation'
      using errcode = '42501';
  end if;

  if v_invitation.accepted_at is not null then
    if v_invitation.accepted_by_clerk_user_id is distinct from pg_catalog.btrim(p_clerk_user_id) then
      raise exception 'Invitation has already been accepted by another user'
        using errcode = '42501';
    end if;

    select id into v_membership_id
    from public.studio_location_memberships
    where location_id = v_invitation.location_id
      and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

    if v_membership_id is null then
      raise exception 'Accepted invitation has no matching location membership'
        using errcode = '23514';
    end if;
    return v_membership_id;
  end if;

  if v_invitation.revoked_at is not null or v_invitation.expires_at <= pg_catalog.now() then
    raise exception 'Invitation is revoked or expired'
      using errcode = 'P0002';
  end if;

  insert into public.studio_location_memberships (
    location_id, location_app, clerk_user_id, role
  ) values (
    v_invitation.location_id,
    'substo',
    pg_catalog.btrim(p_clerk_user_id),
    v_invitation.role
  )
  on conflict (location_id, clerk_user_id) do nothing;

  select id into v_membership_id
  from public.studio_location_memberships
  where location_id = v_invitation.location_id
    and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

  if v_membership_id is null then
    raise exception 'Location membership could not be established'
      using errcode = '23514';
  end if;

  update public.studio_location_invitations
  set accepted_at = pg_catalog.now(),
      accepted_by_clerk_user_id = pg_catalog.btrim(p_clerk_user_id)
  where id = v_invitation.id
    and accepted_at is null
    and revoked_at is null;

  return v_membership_id;
end;
$$;

create or replace function public.platform_youtube_oauth(p_action text,p_app text,p_user text,p_session_hash text,p_state_hash text,
  p_cipher jsonb default null,p_client_id text default null,p_scopes text[] default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_app is null or p_app not in ('estio','substo') or p_user is null or btrim(p_user)=''
    or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' or p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid profile OAuth principal' using errcode='22023';
  end if;
  -- Serialize connection replacement/removal for one realm user across callbacks.
  perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||p_app||':'||p_user,0));
  if exists(select 1 from public.platform_profile_deletions where app=p_app and clerk_user_id=p_user) then return false; end if;
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
commit;
