-- Durable workspace-scoped job queue for the hosted Studio worker (pm2 process
-- beside Next.js on Hetzner). Workers claim with leases; a crashed worker's
-- lease expires and the job is retried. Every attempt is recorded so members
-- can see retries and failures. Only the service role can call these RPCs.
begin;

create table public.studio_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 65536)),
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9:._-]{1,200}$'),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 500),
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workspace_id,idempotency_key),
  check ((status = 'running') = (lease_owner is not null and lease_expires_at is not null)),
  check ((status in ('succeeded','failed','cancelled')) = (finished_at is not null))
);
create index studio_jobs_claim_idx on public.studio_jobs(run_after) where status = 'queued';
create index studio_jobs_lease_idx on public.studio_jobs(lease_expires_at) where status = 'running';
create index studio_jobs_workspace_idx on public.studio_jobs(workspace_id,created_at desc);

create table public.studio_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.studio_jobs(id) on delete cascade,
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  attempt integer not null,
  event text not null check (event in ('queued','started','succeeded','retry_scheduled','failed','lease_expired','cancelled','requeued')),
  error_code text,
  worker_id text,
  actor_clerk_user_id text,
  at timestamptz not null default clock_timestamp()
);
create index studio_job_events_job_idx on public.studio_job_events(job_id,id);

create table public.studio_worker_heartbeats (
  worker_id text primary key check (worker_id ~ '^[A-Za-z0-9:._-]{1,100}$'),
  release text check (release is null or char_length(release) <= 100),
  started_at timestamptz not null,
  seen_at timestamptz not null default now()
);

alter table public.studio_jobs enable row level security;
alter table public.studio_job_events enable row level security;
alter table public.studio_worker_heartbeats enable row level security;
revoke all on public.studio_jobs, public.studio_job_events, public.studio_worker_heartbeats from public,anon,authenticated,service_role;
grant select on public.studio_jobs, public.studio_job_events, public.studio_worker_heartbeats to service_role;

-- Server-side enqueue (requests already authorized by the app, or other RPCs).
-- Idempotent per workspace key: the same key returns the existing job.
create function public.studio_enqueue_job(p_workspace_id uuid, p_kind text, p_payload jsonb, p_idempotency_key text,
  p_created_by text, p_max_attempts integer default 5)
returns public.studio_jobs language plpgsql security definer set search_path = '' as $$
declare v_job public.studio_jobs%rowtype;
begin
  insert into public.studio_jobs(workspace_id,kind,payload,idempotency_key,created_by_clerk_user_id,max_attempts)
    values(p_workspace_id,p_kind,coalesce(p_payload,'{}'::jsonb),p_idempotency_key,p_created_by,coalesce(p_max_attempts,5))
    on conflict (workspace_id,idempotency_key) do nothing returning * into v_job;
  if v_job.id is null then
    select * into v_job from public.studio_jobs where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
    if v_job.kind <> p_kind or v_job.payload <> coalesce(p_payload,'{}'::jsonb) then
      raise exception 'Idempotency key already used for a different job' using errcode = '23505';
    end if;
    return v_job;
  end if;
  insert into public.studio_job_events(job_id,workspace_id,attempt,event,actor_clerk_user_id) values(v_job.id,v_job.workspace_id,0,'queued',p_created_by);
  return v_job;
end;
$$;

-- Claim due work. Expired leases are reclaimed first: that attempt counts, and a
-- job that exhausted its attempts fails rather than looping forever.
create function public.studio_claim_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer)
returns setof public.studio_jobs language plpgsql security definer set search_path = '' as $$
declare v_job public.studio_jobs%rowtype;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9:._-]{1,100}$' or p_limit is null or p_limit not between 1 and 50
    or p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'Invalid claim' using errcode = '22023';
  end if;
  for v_job in select * from public.studio_jobs where status='running' and lease_expires_at < pg_catalog.now()
      order by lease_expires_at limit 100 for update skip locked loop
    insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id,error_code)
      values(v_job.id,v_job.workspace_id,v_job.attempts,'lease_expired',v_job.lease_owner,'worker_lease_expired');
    if v_job.attempts >= v_job.max_attempts then
      update public.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',
        last_error_message='The worker stopped before finishing this job.',finished_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=v_job.id;
      insert into public.studio_job_events(job_id,workspace_id,attempt,event,error_code) values(v_job.id,v_job.workspace_id,v_job.attempts,'failed','worker_lease_expired');
    else
      update public.studio_jobs set status='queued',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',
        last_error_message='The worker stopped before finishing this job; it will be retried.',run_after=pg_catalog.now(),updated_at=pg_catalog.now() where id=v_job.id;
    end if;
  end loop;
  return query
    with due as (
      select id from public.studio_jobs where status='queued' and run_after <= pg_catalog.now()
        order by run_after, created_at limit p_limit for update skip locked
    ), claimed as (
      update public.studio_jobs j set status='running', attempts=j.attempts+1, lease_owner=p_worker_id,
        lease_expires_at=pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds), updated_at=pg_catalog.now()
      from due where j.id=due.id returning j.*
    ), logged as (
      insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id)
        select id,workspace_id,attempts,'started',p_worker_id from claimed
    )
    select * from claimed;
end;
$$;

-- Lease-holder checks stop a worker whose lease was reclaimed from finishing it.
create function public.studio_extend_job_lease(p_job_id uuid, p_worker_id text, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then raise exception 'Invalid lease' using errcode = '22023'; end if;
  update public.studio_jobs set lease_expires_at=pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds), updated_at=pg_catalog.now()
    where id=p_job_id and status='running' and lease_owner=p_worker_id;
  return found;
end;
$$;

create function public.studio_complete_job(p_job_id uuid, p_worker_id text, p_result jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_job public.studio_jobs%rowtype;
begin
  update public.studio_jobs set status='succeeded', result=coalesce(p_result,'{}'::jsonb), lease_owner=null, lease_expires_at=null,
    last_error_code=null, last_error_message=null, finished_at=pg_catalog.now(), updated_at=pg_catalog.now()
    where id=p_job_id and status='running' and lease_owner=p_worker_id returning * into v_job;
  if v_job.id is null then return false; end if;
  insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id) values(v_job.id,v_job.workspace_id,v_job.attempts,'succeeded',p_worker_id);
  return true;
end;
$$;

-- Retryable failures back off exponentially (30s, 60s, 120s... capped at 1h)
-- unless the handler requests a specific delay, for example a provider's
-- Retry-After or the start of next month for a spending cap.
create function public.studio_fail_job(p_job_id uuid, p_worker_id text, p_error_code text, p_error_message text,
  p_retryable boolean, p_retry_after_seconds integer default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job public.studio_jobs%rowtype;
  v_delay integer;
begin
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'Invalid error code' using errcode = '22023'; end if;
  select * into v_job from public.studio_jobs where id=p_job_id and status='running' and lease_owner=p_worker_id for update;
  if not found then return 'lease_lost'; end if;
  if coalesce(p_retryable,false) and v_job.attempts < v_job.max_attempts then
    v_delay := coalesce(p_retry_after_seconds, least(3600, 30 * (2 ^ (v_job.attempts - 1))::integer));
    v_delay := greatest(1, least(v_delay, 2678400));
    update public.studio_jobs set status='queued', lease_owner=null, lease_expires_at=null, last_error_code=p_error_code,
      last_error_message=pg_catalog.left(p_error_message,500), run_after=pg_catalog.now() + pg_catalog.make_interval(secs => v_delay), updated_at=pg_catalog.now()
      where id=p_job_id;
    insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id,error_code) values(v_job.id,v_job.workspace_id,v_job.attempts,'retry_scheduled',p_worker_id,p_error_code);
    return 'retry_scheduled';
  end if;
  update public.studio_jobs set status='failed', lease_owner=null, lease_expires_at=null, last_error_code=p_error_code,
    last_error_message=pg_catalog.left(p_error_message,500), finished_at=pg_catalog.now(), updated_at=pg_catalog.now() where id=p_job_id;
  insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id,error_code) values(v_job.id,v_job.workspace_id,v_job.attempts,'failed',p_worker_id,p_error_code);
  return 'failed';
end;
$$;

-- Member actions: requeue a failed job with a fresh attempt budget, or cancel a
-- queued one. Running jobs are not interrupted. Estio authority is checked by
-- the server; Substo membership is locked here.
create function public.studio_member_job_action(p_workspace_id uuid, p_actor_brand text, p_clerk_user_id text, p_job_id uuid, p_action text)
returns public.studio_jobs language plpgsql security definer set search_path = '' as $$
declare
  v_brand text;
  v_job public.studio_jobs%rowtype;
begin
  if p_action is null or p_action not in ('retry','cancel') or p_clerk_user_id is null or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Invalid job action' using errcode = '22023';
  end if;
  select brand into v_brand from public.studio_workspaces where id=p_workspace_id;
  if v_brand is null or v_brand <> p_actor_brand then raise exception 'Job access denied' using errcode = '42501'; end if;
  if v_brand = 'substo' then
    perform 1 from public.studio_workspace_memberships where workspace_id=p_workspace_id and workspace_brand='substo' and clerk_user_id=p_clerk_user_id for share;
    if not found then raise exception 'Job access denied' using errcode = '42501'; end if;
  end if;
  select * into v_job from public.studio_jobs where id=p_job_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Job not found' using errcode = '22023'; end if;
  if p_action = 'retry' and v_job.status = 'failed' then
    update public.studio_jobs set status='queued', attempts=0, run_after=pg_catalog.now(), finished_at=null, updated_at=pg_catalog.now()
      where id=p_job_id returning * into v_job;
    insert into public.studio_job_events(job_id,workspace_id,attempt,event,actor_clerk_user_id) values(v_job.id,v_job.workspace_id,0,'requeued',p_clerk_user_id);
  elsif p_action = 'cancel' and v_job.status = 'queued' then
    update public.studio_jobs set status='cancelled', finished_at=pg_catalog.now(), updated_at=pg_catalog.now() where id=p_job_id returning * into v_job;
    insert into public.studio_job_events(job_id,workspace_id,attempt,event,actor_clerk_user_id) values(v_job.id,v_job.workspace_id,v_job.attempts,'cancelled',p_clerk_user_id);
  else
    raise exception 'Job is not in a state that allows this action' using errcode = '40001';
  end if;
  return v_job;
end;
$$;

create function public.studio_worker_heartbeat(p_worker_id text, p_release text, p_started_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into public.studio_worker_heartbeats(worker_id,release,started_at,seen_at) values(p_worker_id,p_release,p_started_at,pg_catalog.now())
    on conflict (worker_id) do update set release=excluded.release, started_at=excluded.started_at, seen_at=excluded.seen_at;
  delete from public.studio_worker_heartbeats where seen_at < pg_catalog.now() - interval '7 days';
$$;

revoke all on function public.studio_enqueue_job(uuid,text,jsonb,text,text,integer) from public,anon,authenticated;
revoke all on function public.studio_claim_jobs(text,integer,integer) from public,anon,authenticated;
revoke all on function public.studio_extend_job_lease(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.studio_complete_job(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.studio_fail_job(uuid,text,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.studio_member_job_action(uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.studio_worker_heartbeat(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.studio_enqueue_job(uuid,text,jsonb,text,text,integer) to service_role;
grant execute on function public.studio_claim_jobs(text,integer,integer) to service_role;
grant execute on function public.studio_extend_job_lease(uuid,text,integer) to service_role;
grant execute on function public.studio_complete_job(uuid,text,jsonb) to service_role;
grant execute on function public.studio_fail_job(uuid,text,text,text,boolean,integer) to service_role;
grant execute on function public.studio_member_job_action(uuid,text,text,uuid,text) to service_role;
grant execute on function public.studio_worker_heartbeat(text,text,timestamptz) to service_role;
commit;
