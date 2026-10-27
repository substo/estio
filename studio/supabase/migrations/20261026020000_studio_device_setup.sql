-- Connected computer setup: browser-approved pairing (replaces manual token bootstrap),
-- Estio + Substo Businesses, processing consent, pause, desired config and provider sign-in commands.
-- The server never stores provider credentials; only a sign-in link/code and status.
begin;

-- Approved-but-not-yet-polled devices have no token; they cannot authenticate.
alter table public.studio_devices alter column token_hash drop not null,
 add column platform text check(platform ~ '^[A-Za-z0-9._ -]{1,50}$'),
 add column processing_enabled boolean not null default false,
 add column paused boolean not null default false,
 add column desired_config jsonb not null default '{}' check(jsonb_typeof(desired_config)='object' and octet_length(desired_config::text)<=4096),
 add column config_version integer not null default 0 check(config_version>=0),
 add column applied_config_version integer not null default 0 check(applied_config_version>=0),
 add column config_status text not null default 'none' check(config_status in ('none','pending','applied','error')),
 add column config_report jsonb not null default '{}' check(jsonb_typeof(config_report)='object' and octet_length(config_report::text)<=8192),
 drop constraint studio_devices_report_check,
 add constraint studio_devices_report_check check(jsonb_typeof(report)='object' and octet_length(report::text)<=16384);
-- created_by is the manager who approved the pairing; device authority follows that manager.
comment on column public.studio_devices.created_by is 'Clerk user who approved the pairing; re-checked on every device request.';
grant select(platform,processing_enabled,paused,desired_config,config_version,applied_config_version,config_status,config_report,created_by) on public.studio_devices to service_role;

create table public.studio_device_pairings (
 id uuid primary key default gen_random_uuid(),
 app text not null check(app in ('estio','substo')),
 -- 8 chars without ambiguous I, L, O, 0, 1; displayed as XXXX-XXXX.
 user_code text not null check(user_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$'),
 device_code_hash text not null unique check(device_code_hash ~ '^[a-f0-9]{64}$'),
 name text not null check(char_length(name) between 1 and 100),
 platform text not null check(platform ~ '^[A-Za-z0-9._ -]{1,50}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 approved_at timestamptz, approved_by text, location_id text references public.studio_locations(location_id) on delete cascade,
 denied_at timestamptz, consumed_at timestamptz, device_id uuid, poll_count integer not null default 0,
 foreign key(location_id,device_id) references public.studio_devices(location_id,id) on delete cascade,
 check((approved_at is null)=(approved_by is null) and (approved_at is null)=(location_id is null) and (approved_at is null)=(device_id is null)),
 check(not (approved_at is not null and denied_at is not null)),
 check(consumed_at is null or approved_at is not null)
);
create unique index studio_device_pairings_open_code_idx on public.studio_device_pairings(app,user_code) where consumed_at is null and denied_at is null;
create index studio_device_pairings_expiry_idx on public.studio_device_pairings(expires_at);
alter table public.studio_device_pairings enable row level security;
revoke all on public.studio_device_pairings from public,anon,authenticated,service_role;

create table public.studio_device_commands (
 id uuid primary key default gen_random_uuid(),
 location_id text not null references public.studio_locations(location_id) on delete cascade,
 device_id uuid not null,
 kind text not null check(kind in ('provider_login','provider_logout')),
 provider text not null check(provider in ('codex','claude')),
 status text not null default 'pending' check(status in ('pending','running','waiting_for_user','succeeded','failed','cancelled')),
 display jsonb not null default '{}' check(jsonb_typeof(display)='object' and octet_length(display::text)<=4096
  and display-'verificationUrl'-'userCode'='{}'::jsonb),
 error text check(char_length(error)<=300),
 created_by text not null, request_id uuid not null,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 foreign key(location_id,device_id) references public.studio_devices(location_id,id) on delete cascade,
 unique(location_id,request_id),
 check((finished_at is not null)=(status in ('succeeded','failed','cancelled')))
);
create unique index studio_device_commands_open_idx on public.studio_device_commands(device_id,provider) where status in ('pending','running','waiting_for_user');
create index studio_device_commands_device_idx on public.studio_device_commands(location_id,device_id,created_at desc);
alter table public.studio_device_commands enable row level security;
revoke all on public.studio_device_commands from public,anon,authenticated,service_role;
grant select(id,location_id,device_id,kind,provider,status,display,error,created_at,updated_at,finished_at) on public.studio_device_commands to service_role;

-- Device starts pairing; only hashes stored. Old rows are cleaned opportunistically.
create function public.studio_device_pair_start(p_app text,p_name text,p_platform text,p_device_code_hash text,p_user_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.studio_device_pairings%rowtype;
begin
 if p_app is null or p_app not in ('estio','substo') then raise exception 'Invalid pairing' using errcode='22023'; end if;
 -- Approved pairings whose token was never collected leave no usable device behind.
 update public.studio_devices set revoked_at=clock_timestamp() where token_hash is null and revoked_at is null
  and id in (select device_id from public.studio_device_pairings where consumed_at is null and device_id is not null and expires_at<clock_timestamp());
 delete from public.studio_device_pairings where id in (select id from public.studio_device_pairings where expires_at<clock_timestamp()-interval '1 day' limit 200);
 insert into public.studio_device_pairings(app,user_code,device_code_hash,name,platform,expires_at)
 values(p_app,p_user_code,p_device_code_hash,btrim(p_name),p_platform,clock_timestamp()+interval '10 minutes') returning * into p;
 return jsonb_build_object('pairingId',p.id,'userCode',p.user_code,'expiresAt',p.expires_at);
end $$;

-- Token is issued exactly once, at the first poll after approval, in this transaction.
-- If that response is lost the device must pair again (the issued token is unrecoverable).
create function public.studio_device_pair_poll(p_app text,p_pairing_id uuid,p_device_code_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.studio_device_pairings%rowtype; d public.studio_devices%rowtype; v_name text;
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid pairing' using errcode='22023'; end if;
 select * into p from public.studio_device_pairings where id=p_pairing_id and app=p_app and device_code_hash=p_device_code_hash for update;
 if not found then raise exception 'Pairing unavailable' using errcode='42501'; end if;
 update public.studio_device_pairings set poll_count=poll_count+1 where id=p.id;
 if p.consumed_at is not null then return jsonb_build_object('status','consumed'); end if;
 if p.denied_at is not null then return jsonb_build_object('status','denied'); end if;
 if p.expires_at<=clock_timestamp() or p.poll_count>=400 then
  if p.device_id is not null then update public.studio_devices set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p.device_id and token_hash is null; end if;
  return jsonb_build_object('status','expired');
 end if;
 if p.approved_at is null then return jsonb_build_object('status','pending'); end if;
 update public.studio_devices set token_hash=p_token_hash where id=p.device_id and token_hash is null and revoked_at is null returning * into d;
 update public.studio_device_pairings set consumed_at=clock_timestamp() where id=p.id;
 if d.id is null then return jsonb_build_object('status','denied'); end if;
 select name into v_name from public.studio_locations where location_id=d.location_id;
 return jsonb_build_object('status','approved','deviceId',d.id,'businessName',v_name);
end $$;

-- Browser side. Manager authority: SQL locks Substo owner/admin; Estio ADMIN is checked by the server session.
create function public.studio_device_pairing_action(p_location_id text,p_actor_app text,p_clerk_user_id text,p_action text,p_user_code text,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.studio_device_pairings%rowtype; d public.studio_devices%rowtype;
begin
 perform public.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if p_action is null or p_action not in ('lookup','approve','deny') or p_user_code is null or p_user_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$'
  or p_action='approve' and p_request_id is null then raise exception 'Invalid pairing action' using errcode='22023'; end if;
 select * into p from public.studio_device_pairings where app=p_actor_app and user_code=p_user_code
  order by (consumed_at is null and denied_at is null) desc, created_at desc limit 1 for update;
 if not found then raise exception 'Pairing not found' using errcode='P0002'; end if;
 if p_action='lookup' then
  return jsonb_build_object('name',p.name,'platform',p.platform,'expiresAt',p.expires_at,'status',case
   when p.consumed_at is not null then 'consumed' when p.denied_at is not null then 'denied'
   when p.approved_at is not null then 'approved' when p.expires_at<=clock_timestamp() then 'expired' else 'pending' end);
 end if;
 -- Same request retried after a lost response returns the original approval.
 if p_action='approve' and p.approved_at is not null and p.location_id=p_location_id then
  select * into d from public.studio_devices where id=p.device_id and request_id=p_request_id;
  if found then return jsonb_build_object('deviceId',d.id,'name',d.name); end if;
 end if;
 if p.approved_at is not null or p.denied_at is not null or p.consumed_at is not null or p.expires_at<=clock_timestamp() then
  raise exception 'Pairing no longer valid' using errcode='P0002';
 end if;
 if p_action='deny' then
  update public.studio_device_pairings set denied_at=clock_timestamp() where id=p.id;
  return jsonb_build_object('status','denied');
 end if;
 insert into public.studio_devices(location_id,app,name,platform,token_hash,request_id,created_by)
 values(p_location_id,p_actor_app,p.name,p.platform,null,p_request_id,p_clerk_user_id) returning * into d;
 -- Leave time for the device's next poll even when approved just before expiry.
 update public.studio_device_pairings set approved_at=clock_timestamp(),approved_by=p_clerk_user_id,location_id=p_location_id,device_id=d.id,
  expires_at=greatest(expires_at,clock_timestamp()+interval '2 minutes') where id=p.id;
 return jsonb_build_object('deviceId',d.id,'name',d.name);
end $$;

drop function public.studio_manage_device(text,text,text,text,uuid,text,uuid,text,text,text);
create function public.studio_manage_device(p_location_id text,p_actor_app text,p_clerk_user_id text,p_action text,
 p_request_id uuid default null,p_device_id uuid default null,p_provider text default null,p_model text default null,
 p_value jsonb default null,p_expected_version integer default null,p_command_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.studio_devices%rowtype; j public.studio_jobs%rowtype; c public.studio_device_commands%rowtype; v_device uuid;
begin
 perform public.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if p_action is null or p_action not in ('revoke','diagnostic','set_processing','set_paused','save_config','provider_login','provider_logout','cancel_command')
  or p_provider is not null and (p_action not in ('diagnostic','provider_login','provider_logout') or p_provider not in ('codex','claude'))
  or p_model is not null and (p_action<>'diagnostic' or p_provider is null or p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$')
  or p_action in ('diagnostic','provider_login','provider_logout') and p_request_id is null
  or p_action in ('provider_login','provider_logout') and p_provider is null then raise exception 'Invalid device action' using errcode='22023'; end if;
 if p_action='cancel_command' then
  -- Lock order: location (above) -> device -> command.
  select device_id into v_device from public.studio_device_commands where id=p_command_id and location_id=p_location_id;
  if v_device is null then raise exception 'Command unavailable' using errcode='42501'; end if;
  perform 1 from public.studio_devices where id=v_device and location_id=p_location_id and app=p_actor_app for update;
  if not found then raise exception 'Command unavailable' using errcode='42501'; end if;
  select * into c from public.studio_device_commands where id=p_command_id for update;
  if c.status in ('pending','running','waiting_for_user') then
   update public.studio_device_commands set status='cancelled',display='{}',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.id;
  end if;
  return jsonb_build_object('commandId',c.id);
 end if;
 select * into d from public.studio_devices where id=p_device_id and location_id=p_location_id and app=p_actor_app for update;
 if not found then raise exception 'Device unavailable' using errcode='42501'; end if;
 if p_action='revoke' then
  update public.studio_devices set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=d.id;
  update public.studio_device_commands set status='cancelled',display='{}',finished_at=clock_timestamp(),updated_at=clock_timestamp()
   where device_id=d.id and status in ('pending','running','waiting_for_user');
  return jsonb_build_object('deviceId',d.id);
 end if;
 if d.revoked_at is not null then raise exception 'Device revoked' using errcode='42501'; end if;
 if p_action='diagnostic' then
  j:=public.studio_enqueue_job(p_location_id,'studio.diagnostic',jsonb_strip_nulls(jsonb_build_object('provider',p_provider,'model',p_model)),'device:'||d.id||':'||p_request_id,p_clerk_user_id,3);
  update public.studio_jobs set execution_target='device',device_id=d.id where id=j.id;
  return jsonb_build_object('jobId',j.id);
 elsif p_action in ('set_processing','set_paused') then
  if jsonb_typeof(p_value) is distinct from 'boolean' then raise exception 'Invalid device action' using errcode='22023'; end if;
  if p_action='set_processing' then update public.studio_devices set processing_enabled=(p_value#>>'{}')::boolean where id=d.id;
  else update public.studio_devices set paused=(p_value#>>'{}')::boolean where id=d.id; end if;
  return jsonb_build_object('deviceId',d.id);
 elsif p_action='save_config' then
  -- Full validation happens in readDeviceConfig; SQL bounds shape and enforces optimistic concurrency.
  if jsonb_typeof(p_value) is distinct from 'object' or octet_length(p_value::text)>4096 or p_expected_version is null then raise exception 'Invalid config' using errcode='22023'; end if;
  if d.config_version<>p_expected_version then raise exception 'Config changed' using errcode='40001'; end if;
  update public.studio_devices set desired_config=p_value,config_version=config_version+1,config_status='pending',config_report='{}' where id=d.id returning * into d;
  return jsonb_build_object('version',d.config_version);
 end if;
 insert into public.studio_device_commands(location_id,device_id,kind,provider,created_by,request_id)
 values(p_location_id,d.id,case p_action when 'provider_login' then 'provider_login' else 'provider_logout' end,p_provider,p_clerk_user_id,p_request_id)
 on conflict(location_id,request_id) do nothing returning * into c;
 if c.id is null then
  select * into c from public.studio_device_commands where location_id=p_location_id and request_id=p_request_id;
  if c.device_id<>d.id or c.provider<>p_provider or c.kind<>p_action then raise exception 'Command already issued' using errcode='23505'; end if;
 end if;
 return jsonb_build_object('commandId',c.id);
end $$;

-- Paused devices claim nothing, including diagnostics; hosted workers still never claim device jobs.
create or replace function public.studio_claim_device_jobs(p_device_id uuid,p_location_id text,p_worker_id text,p_limit integer,p_lease_seconds integer)
returns setof public.studio_jobs language plpgsql security definer set search_path = '' as $$
declare v_job public.studio_jobs%rowtype;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9:._-]{1,100}$' or p_limit is null or p_limit not between 1 and 50
    or p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'Invalid claim' using errcode = '22023';
  end if;
  perform 1 from public.studio_devices where id=p_device_id and location_id=p_location_id and revoked_at is null and not paused;
  if not found then return; end if;
  for v_job in select * from public.studio_jobs where device_id=p_device_id and location_id=p_location_id and kind='studio.diagnostic' and status='running' and lease_expires_at < pg_catalog.clock_timestamp()
      order by lease_expires_at limit 100 for update skip locked loop
    insert into public.studio_job_events(job_id,location_id,attempt,event,worker_id,error_code)
      values(v_job.id,v_job.location_id,v_job.attempts,'lease_expired',v_job.lease_owner,'worker_lease_expired');
    if v_job.attempts >= v_job.max_attempts then
      update public.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',
        last_error_message='The worker stopped before finishing this job.',finished_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=v_job.id;
      insert into public.studio_job_events(job_id,location_id,attempt,event,error_code) values(v_job.id,v_job.location_id,v_job.attempts,'failed','worker_lease_expired');
    else
      update public.studio_jobs set status='queued',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',
        last_error_message='The worker stopped before finishing this job; it will be retried.',run_after=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=v_job.id;
    end if;
  end loop;
  return query
    with due as (
      select id from public.studio_jobs where device_id=p_device_id and location_id=p_location_id and kind='studio.diagnostic' and status='queued' and run_after <= pg_catalog.clock_timestamp()
        order by run_after, created_at limit p_limit for update skip locked
    ), claimed as (
      update public.studio_jobs j set status='running', attempts=j.attempts+1, lease_owner=p_worker_id, lease_token=gen_random_uuid(),
        lease_expires_at=pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds), updated_at=pg_catalog.clock_timestamp()
      from due where j.id=due.id returning j.*
    ), logged as (
      insert into public.studio_job_events(job_id,location_id,attempt,event,worker_id)
        select id,location_id,attempts,'started',p_worker_id from claimed
    )
    select * from claimed;
end;
$$;

-- Lets the server re-check an Estio approver (Business ADMIN lives in Estio's database) before device commands.
create function public.studio_device_identity(p_token_hash text,p_app text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('locationId',location_id,'approvedBy',created_by) from public.studio_devices
 where token_hash=p_token_hash and app=p_app and revoked_at is null
$$;

drop function public.studio_device_command(text,text,text,jsonb);
-- Lock device before jobs/commands for every operation. Revoke uses the same device lock.
create function public.studio_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.studio_devices%rowtype; j public.studio_jobs%rowtype; c public.studio_device_commands%rowtype; v_worker text; v_result jsonb; v_status text; v_ack jsonb;
begin
 -- Read identity without locking, then follow the manager's location→membership→device order.
 select * into d from public.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 -- Estio authority is checked by the server against Estio's database for this exact approver.
 if d.app='estio' and p_estio_authorized_by is distinct from d.created_by then raise exception 'Device authentication failed' using errcode='42501'; end if;
 perform public.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
 select * into d from public.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 then raise exception 'Invalid command' using errcode='22023'; end if;
 v_worker:=p_body->>'workerId';
 if v_worker is null or v_worker !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid worker' using errcode='22023'; end if;
 if p_operation='heartbeat' then
  if length(p_body->>'release')>100 or (p_body->>'startedAt') is null
   or not isfinite((p_body->>'startedAt')::timestamptz)
   or (p_body->>'startedAt')::timestamptz>clock_timestamp()+interval '5 minutes'
   or jsonb_typeof(coalesce(p_body->'report','{}'))<>'object'
   or octet_length(coalesce(p_body->'report','{}')::text)>16384 then raise exception 'Invalid heartbeat' using errcode='22023'; end if;
  update public.studio_devices set seen_at=clock_timestamp(),release=p_body->>'release',started_at=(p_body->>'startedAt')::timestamptz,
   report=coalesce(p_body->'report','{}') where id=d.id;
  v_ack:=p_body->'configAck';
  -- Only the current desired version can be acknowledged; stale acks are ignored.
  if jsonb_typeof(v_ack)='object' and jsonb_typeof(v_ack->'version')='number' and (v_ack->>'version')::numeric=d.config_version
   and v_ack->>'status' in ('applied','error') and octet_length(v_ack::text)<=8192 then
   update public.studio_devices set applied_config_version=d.config_version,config_status=v_ack->>'status',
    config_report=jsonb_strip_nulls(jsonb_build_object('unsupported',case when jsonb_typeof(v_ack->'unsupported')='object' then v_ack->'unsupported' end,'error',left(v_ack->>'error',300)))
   where id=d.id;
  end if;
  -- Commands abandoned by an offline or crashed companion stop blocking new requests.
  update public.studio_device_commands set status='failed',error='Timed out waiting for the computer.',display='{}',finished_at=clock_timestamp(),updated_at=clock_timestamp()
   where device_id=d.id and status in ('pending','running','waiting_for_user') and created_at<clock_timestamp()-interval '20 minutes';
  return jsonb_build_object('processingEnabled',d.processing_enabled,'paused',d.paused,
   'config',jsonb_build_object('version',d.config_version,'value',d.desired_config),
   'commands',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'provider',provider) order by created_at)
     from public.studio_device_commands where device_id=d.id and status='pending'),'[]'));
 elsif p_operation='claim' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from public.studio_claim_device_jobs(d.id,d.location_id,v_worker,(p_body->>'limit')::integer,(p_body->>'leaseSeconds')::integer) x;
  return v_result;
 elsif p_operation='command' then
  select * into c from public.studio_device_commands where id=(p_body->>'commandId')::uuid and device_id=d.id and location_id=d.location_id for update;
  if not found then raise exception 'Command unavailable' using errcode='42501'; end if;
  -- Final states (including a manager cancel) are never overwritten; the device stops on 'cancelled'.
  if c.status in ('succeeded','failed','cancelled') then return jsonb_build_object('status',c.status); end if;
  v_status:=p_body->>'status';
  if v_status is null or v_status not in ('running','waiting_for_user','succeeded','failed')
   or p_body ? 'display' and (v_status<>'waiting_for_user' or jsonb_typeof(p_body->'display')<>'object' or octet_length((p_body->'display')::text)>4096
    or exists(select 1 from jsonb_each(p_body->'display') e where e.key not in ('verificationUrl','userCode') or jsonb_typeof(e.value)<>'string'))
   or p_body->'display'->>'verificationUrl' !~ '^https://'
   or length(p_body->>'error')>300 or p_body->>'error' is not null and v_status<>'failed' then raise exception 'Invalid command status' using errcode='22023'; end if;
  update public.studio_device_commands set status=v_status,
   display=case when v_status='waiting_for_user' then coalesce(p_body->'display',display) when v_status in ('succeeded','failed') then '{}' else display end,
   error=case when v_status='failed' then coalesce(p_body->>'error','Sign-in failed on the computer.') end,
   finished_at=case when v_status in ('succeeded','failed') then clock_timestamp() end,updated_at=clock_timestamp() where id=c.id;
  return jsonb_build_object('status',v_status);
 end if;
 select * into j from public.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id
  and execution_target='device' and kind=any(d.allowed_kinds) for update;
 if not found then raise exception 'Job unavailable' using errcode='42501'; end if;
 if p_operation='extend' then
  return to_jsonb(public.studio_extend_job_lease(j.id,v_worker,(p_body->>'leaseToken')::uuid,(p_body->>'leaseSeconds')::integer));
 elsif p_operation='complete' then
  -- Diagnostic output is data only: bounded scalar fields, no nested credentials.
  if jsonb_typeof(p_body->'result') is distinct from 'object' or octet_length((p_body->'result')::text)>4096
   or exists(select 1 from jsonb_each(p_body->'result') e where e.key not in ('ok','workerId','checkedAt','provider','model','output','summary','durationMs')
    or case when e.key='ok' then jsonb_typeof(e.value)<>'boolean'
     when e.key='durationMs' then jsonb_typeof(e.value)<>'number'
     else jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>case when e.key in ('output','summary') then 3000 else 100 end end)
   then raise exception 'Invalid result' using errcode='22023'; end if;
  return to_jsonb(public.studio_complete_job(j.id,v_worker,(p_body->>'leaseToken')::uuid,p_body->'result'));
 elsif p_operation='fail' then
  return to_jsonb(public.studio_fail_job(j.id,v_worker,(p_body->>'leaseToken')::uuid,p_body->'failure'->>'code',
   p_body->'failure'->>'message',(p_body->'failure'->>'retryable')::boolean,(p_body->'failure'->>'retryAfterSeconds')::integer));
 end if;
 raise exception 'Invalid device operation' using errcode='22023';
end $$;

-- Device retries now apply to both Businesses; Estio ADMIN is checked by the server session.
create or replace function public.studio_member_job_action(p_location_id text, p_actor_app text, p_clerk_user_id text, p_job_id uuid, p_action text)
returns public.studio_jobs language plpgsql security definer set search_path = '' as $$
declare
  v_app text;
  v_job public.studio_jobs%rowtype;
  v_target text;
  v_device_id uuid;
begin
  if p_action is null or p_action not in ('retry','cancel') or p_clerk_user_id is null or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Invalid job action' using errcode = '22023';
  end if;
  select execution_target,device_id into v_target,v_device_id from public.studio_jobs
    where id=p_job_id and location_id=p_location_id;
  if p_action = 'retry' and v_target = 'device' then
    perform public.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
    perform 1 from public.studio_devices where id=v_device_id and location_id=p_location_id
      and app=p_actor_app and revoked_at is null for update;
    if not found then raise exception 'Device unavailable' using errcode = '42501'; end if;
  end if;
  select app into v_app from public.studio_locations where location_id=p_location_id;
  if v_app is null or v_app <> p_actor_app then raise exception 'Job access denied' using errcode = '42501'; end if;
  if v_app = 'substo' then
    perform 1 from public.studio_location_memberships where location_id=p_location_id and location_app='substo' and clerk_user_id=p_clerk_user_id for share;
    if not found then raise exception 'Job access denied' using errcode = '42501'; end if;
  end if;
  select * into v_job from public.studio_jobs where id=p_job_id and location_id=p_location_id for update;
  if not found then raise exception 'Job not found' using errcode = '22023'; end if;
  if p_action = 'retry' and (v_job.execution_target is distinct from v_target or v_job.device_id is distinct from v_device_id) then
    raise exception 'Job routing changed; retry the request' using errcode = '40001';
  end if;
  if p_action = 'retry' and v_job.status = 'failed' then
    update public.studio_jobs set status='queued', attempts=0, run_after=pg_catalog.now(), finished_at=null, updated_at=pg_catalog.now()
      where id=p_job_id returning * into v_job;
    insert into public.studio_job_events(job_id,location_id,attempt,event,actor_clerk_user_id) values(v_job.id,v_job.location_id,0,'requeued',p_clerk_user_id);
  elsif p_action = 'cancel' and v_job.status = 'queued' then
    update public.studio_jobs set status='cancelled', finished_at=pg_catalog.now(), updated_at=pg_catalog.now() where id=p_job_id returning * into v_job;
    insert into public.studio_job_events(job_id,location_id,attempt,event,actor_clerk_user_id) values(v_job.id,v_job.location_id,v_job.attempts,'cancelled',p_clerk_user_id);
  else
    raise exception 'Job is not in a state that allows this action' using errcode = '40001';
  end if;
  return v_job;
end;
$$;

revoke all on function public.studio_device_pair_start(text,text,text,text,text),public.studio_device_pair_poll(text,uuid,text,text),
 public.studio_device_pairing_action(text,text,text,text,text,uuid),public.studio_manage_device(text,text,text,text,uuid,uuid,text,text,jsonb,integer,uuid),
 public.studio_device_identity(text,text),public.studio_device_command(text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studio_device_pair_start(text,text,text,text,text),public.studio_device_pair_poll(text,uuid,text,text),
 public.studio_device_pairing_action(text,text,text,text,text,uuid),public.studio_manage_device(text,text,text,text,uuid,uuid,text,text,jsonb,integer,uuid),
 public.studio_device_identity(text,text),public.studio_device_command(text,text,text,jsonb,text) to service_role;
revoke all on function public.studio_claim_device_jobs(uuid,text,text,integer,integer) from public,anon,authenticated,service_role;
commit;
