-- Paired outbound-only devices share the existing durable queue. No provider secrets.
begin;
create table public.studio_devices (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
 brand text not null check(brand in ('estio','substo')),
 name text not null check(char_length(name) between 1 and 100),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 request_id uuid not null,
 allowed_kinds text[] not null default array['studio.diagnostic'] check(allowed_kinds = array['studio.diagnostic']),
 created_by text not null, created_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz, seen_at timestamptz, release text, started_at timestamptz,
 report jsonb not null default '{}' check(jsonb_typeof(report)='object' and octet_length(report::text)<=4096),
 unique(workspace_id,request_id), unique(workspace_id,id)
);
alter table public.studio_devices enable row level security;
revoke all on public.studio_devices from public,anon,authenticated,service_role;
-- Hashes are deliberately excluded even from ordinary server-side summary reads.
grant select(id,workspace_id,brand,name,allowed_kinds,created_at,revoked_at,seen_at,release,started_at,report) on public.studio_devices to service_role;
alter table public.studio_jobs add column execution_target text not null default 'hosted' check(execution_target in ('hosted','device')),
 add column device_id uuid,
 add constraint studio_jobs_device_scope foreign key(workspace_id,device_id) references public.studio_devices(workspace_id,id),
 add constraint studio_jobs_execution_scope check((execution_target='device')=(device_id is not null));
create index studio_jobs_device_claim_idx on public.studio_jobs(device_id,run_after) where status='queued';

create function public.studio_manage_device(p_workspace_id uuid,p_actor_brand text,p_clerk_user_id text,
 p_action text,p_request_id uuid,p_name text default null,p_device_id uuid default null,p_token_hash text default null,p_provider text default null,p_model text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.studio_devices%rowtype; j public.studio_jobs%rowtype;
begin
 if p_actor_brand is distinct from 'substo' then raise exception 'Devices require Substo' using errcode='42501'; end if;
 perform public.studio_lock_ai_manager(p_workspace_id,p_actor_brand,p_clerk_user_id);
 if p_provider is not null and (p_action<>'diagnostic' or p_provider not in ('codex','claude')) or p_model is not null and (p_provider is null or p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$') then raise exception 'Invalid selection' using errcode='22023'; end if;
 if p_request_id is null then raise exception 'Request ID required' using errcode='22023'; end if;
 if p_action='create' then
  insert into public.studio_devices(workspace_id,brand,name,token_hash,request_id,created_by)
  values(p_workspace_id,p_actor_brand,p_name,p_token_hash,p_request_id,p_clerk_user_id)
  on conflict(workspace_id,request_id) do nothing returning * into d;
  if d.id is null then raise exception 'Pairing already issued; create a new request' using errcode='23505'; end if;
  return jsonb_build_object('deviceId',d.id);
 end if;
 select * into d from public.studio_devices where id=p_device_id and workspace_id=p_workspace_id and brand=p_actor_brand for update;
 if not found then raise exception 'Device unavailable' using errcode='42501'; end if;
 if p_action='revoke' then
  update public.studio_devices set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=d.id;
  return jsonb_build_object('deviceId',d.id);
 elsif p_action='diagnostic' and d.revoked_at is null then
  j:=public.studio_enqueue_job(p_workspace_id,'studio.diagnostic',jsonb_strip_nulls(jsonb_build_object('provider',p_provider,'model',p_model)),'device:'||d.id||':'||p_request_id,p_clerk_user_id,3);
  update public.studio_jobs set execution_target='device',device_id=d.id where id=j.id;
  return jsonb_build_object('jobId',j.id);
 end if;
 raise exception 'Invalid device action' using errcode='22023';
end $$;

create or replace function public.studio_claim_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer)
returns setof public.studio_jobs language plpgsql security definer set search_path = '' as $$
declare v_job public.studio_jobs%rowtype;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9:._-]{1,100}$' or p_limit is null or p_limit not between 1 and 50
    or p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'Invalid claim' using errcode = '22023';
  end if;
  perform public.studio_recover_transcription_attempts();
  for v_job in select * from public.studio_jobs where status='running' and lease_expires_at < pg_catalog.clock_timestamp()
      order by lease_expires_at limit 100 for update skip locked loop
    insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id,error_code)
      values(v_job.id,v_job.workspace_id,v_job.attempts,'lease_expired',v_job.lease_owner,'worker_lease_expired');
    if v_job.attempts >= v_job.max_attempts then
      update public.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',
        last_error_message='The worker stopped before finishing this job.',finished_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=v_job.id;
      insert into public.studio_job_events(job_id,workspace_id,attempt,event,error_code) values(v_job.id,v_job.workspace_id,v_job.attempts,'failed','worker_lease_expired');
    else
      update public.studio_jobs set status='queued',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',
        last_error_message='The worker stopped before finishing this job; it will be retried.',run_after=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=v_job.id;
    end if;
  end loop;
  return query
    with due as (
      select id from public.studio_jobs where execution_target='hosted' and status='queued' and run_after <= pg_catalog.clock_timestamp()
        order by run_after, created_at limit p_limit for update skip locked
    ), claimed as (
      update public.studio_jobs j set status='running', attempts=j.attempts+1, lease_owner=p_worker_id, lease_token=gen_random_uuid(),
        lease_expires_at=pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds), updated_at=pg_catalog.clock_timestamp()
      from due where j.id=due.id returning j.*
    ), logged as (
      insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id)
        select id,workspace_id,attempts,'started',p_worker_id from claimed
    )
    select * from claimed;
end;
$$;

create function public.studio_claim_device_jobs(p_device_id uuid,p_workspace_id uuid,p_worker_id text,p_limit integer,p_lease_seconds integer)
returns setof public.studio_jobs language plpgsql security definer set search_path = '' as $$
declare v_job public.studio_jobs%rowtype;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9:._-]{1,100}$' or p_limit is null or p_limit not between 1 and 50
    or p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'Invalid claim' using errcode = '22023';
  end if;
  for v_job in select * from public.studio_jobs where device_id=p_device_id and workspace_id=p_workspace_id and kind='studio.diagnostic' and status='running' and lease_expires_at < pg_catalog.clock_timestamp()
      order by lease_expires_at limit 100 for update skip locked loop
    insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id,error_code)
      values(v_job.id,v_job.workspace_id,v_job.attempts,'lease_expired',v_job.lease_owner,'worker_lease_expired');
    if v_job.attempts >= v_job.max_attempts then
      update public.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',
        last_error_message='The worker stopped before finishing this job.',finished_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=v_job.id;
      insert into public.studio_job_events(job_id,workspace_id,attempt,event,error_code) values(v_job.id,v_job.workspace_id,v_job.attempts,'failed','worker_lease_expired');
    else
      update public.studio_jobs set status='queued',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',
        last_error_message='The worker stopped before finishing this job; it will be retried.',run_after=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=v_job.id;
    end if;
  end loop;
  return query
    with due as (
      select id from public.studio_jobs where device_id=p_device_id and workspace_id=p_workspace_id and kind='studio.diagnostic' and status='queued' and run_after <= pg_catalog.clock_timestamp()
        order by run_after, created_at limit p_limit for update skip locked
    ), claimed as (
      update public.studio_jobs j set status='running', attempts=j.attempts+1, lease_owner=p_worker_id, lease_token=gen_random_uuid(),
        lease_expires_at=pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds), updated_at=pg_catalog.clock_timestamp()
      from due where j.id=due.id returning j.*
    ), logged as (
      insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id)
        select id,workspace_id,attempts,'started',p_worker_id from claimed
    )
    select * from claimed;
end;
$$;


-- Lock device before jobs for every operation. Revoke uses the same device lock,
-- so an operation either finishes before revocation or observes its fence.
create function public.studio_device_command(p_token_hash text,p_brand text,p_operation text,p_body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.studio_devices%rowtype; j public.studio_jobs%rowtype; v_worker text; v_result jsonb;
begin
 -- Read identity without locking, then follow the manager's workspace→membership→device order.
 select * into d from public.studio_devices where token_hash=p_token_hash and brand=p_brand and revoked_at is null;
 if not found or p_brand is distinct from 'substo' then raise exception 'Device authentication failed' using errcode='42501'; end if;
 perform public.studio_lock_ai_manager(d.workspace_id,d.brand,d.created_by);
 select * into d from public.studio_devices where token_hash=p_token_hash and brand=p_brand and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>16384 then raise exception 'Invalid command' using errcode='22023'; end if;
 v_worker:=p_body->>'workerId';
 if v_worker is null or v_worker !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid worker' using errcode='22023'; end if;
 if p_operation='heartbeat' then
  if length(p_body->>'release')>100 or (p_body->>'startedAt') is null
   or not isfinite((p_body->>'startedAt')::timestamptz)
   or (p_body->>'startedAt')::timestamptz>clock_timestamp()+interval '5 minutes'
   or jsonb_typeof(coalesce(p_body->'report','{}'))<>'object'
   or octet_length(coalesce(p_body->'report','{}')::text)>4096 then raise exception 'Invalid heartbeat' using errcode='22023'; end if;
  update public.studio_devices set seen_at=clock_timestamp(),release=p_body->>'release',started_at=(p_body->>'startedAt')::timestamptz,
   report=coalesce(p_body->'report','{}') where id=d.id;
  return 'null'::jsonb;
 elsif p_operation='claim' then
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into v_result from public.studio_claim_device_jobs(d.id,d.workspace_id,v_worker,(p_body->>'limit')::integer,(p_body->>'leaseSeconds')::integer) c;
  return v_result;
 end if;
 select * into j from public.studio_jobs where id=(p_body->>'jobId')::uuid and workspace_id=d.workspace_id and device_id=d.id
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
revoke all on function public.studio_claim_device_jobs(uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.studio_manage_device(uuid,text,text,text,uuid,text,uuid,text,text,text),public.studio_device_command(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_manage_device(uuid,text,text,text,uuid,text,uuid,text,text,text),public.studio_device_command(text,text,text,jsonb) to service_role;
commit;
