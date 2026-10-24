-- Local reliability slice: claim generations, fenced transcript commits and
-- conservative durable paid attempts. Apply only to the dedicated Studio DB.
begin;
alter table public.studio_jobs add column lease_token uuid;
-- Existing running workers must be stopped before applying this migration.
update public.studio_jobs set lease_token=gen_random_uuid() where status='running';

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
      select id from public.studio_jobs where status='queued' and run_after <= pg_catalog.clock_timestamp()
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

drop function public.studio_extend_job_lease(uuid,text,integer);
create or replace function public.studio_extend_job_lease(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then raise exception 'Invalid lease' using errcode = '22023'; end if;
  update public.studio_jobs set lease_expires_at=pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds), updated_at=pg_catalog.clock_timestamp()
    where id=p_job_id and status='running' and lease_owner=p_worker_id and lease_token=p_lease_token and lease_expires_at > pg_catalog.clock_timestamp();
  return found;
end;
$$;

drop function public.studio_complete_job(uuid,text,jsonb);
create or replace function public.studio_complete_job(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_result jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_job public.studio_jobs%rowtype;
begin
  update public.studio_jobs set status='succeeded', result=coalesce(p_result,'{}'::jsonb), lease_owner=null, lease_expires_at=null,
    last_error_code=null, last_error_message=null, finished_at=pg_catalog.clock_timestamp(), updated_at=pg_catalog.clock_timestamp()
    where id=p_job_id and status='running' and lease_owner=p_worker_id and lease_token=p_lease_token and lease_expires_at > pg_catalog.clock_timestamp() returning * into v_job;
  if v_job.id is null then return false; end if;
  insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id) values(v_job.id,v_job.workspace_id,v_job.attempts,'succeeded',p_worker_id);
  return true;
end;
$$;

drop function public.studio_fail_job(uuid,text,text,text,boolean,integer);
create or replace function public.studio_fail_job(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_error_code text, p_error_message text,
  p_retryable boolean, p_retry_after_seconds integer default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job public.studio_jobs%rowtype;
  v_delay integer;
begin
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'Invalid error code' using errcode = '22023'; end if;
  select * into v_job from public.studio_jobs where id=p_job_id and status='running' and lease_owner=p_worker_id and lease_token=p_lease_token and lease_expires_at > pg_catalog.clock_timestamp() for update;
  if not found or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then return 'lease_lost'; end if;
  if coalesce(p_retryable,false) and v_job.attempts < v_job.max_attempts then
    v_delay := coalesce(p_retry_after_seconds, least(3600, 30 * (2 ^ (v_job.attempts - 1))::integer));
    v_delay := greatest(1, least(v_delay, 2678400));
    update public.studio_jobs set status='queued', lease_owner=null, lease_expires_at=null, last_error_code=p_error_code,
      last_error_message=pg_catalog.left(p_error_message,500), run_after=pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => v_delay), updated_at=pg_catalog.clock_timestamp()
      where id=p_job_id;
    insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id,error_code) values(v_job.id,v_job.workspace_id,v_job.attempts,'retry_scheduled',p_worker_id,p_error_code);
    return 'retry_scheduled';
  end if;
  update public.studio_jobs set status='failed', lease_owner=null, lease_expires_at=null, last_error_code=p_error_code,
    last_error_message=pg_catalog.left(p_error_message,500), finished_at=pg_catalog.clock_timestamp(), updated_at=pg_catalog.clock_timestamp() where id=p_job_id;
  insert into public.studio_job_events(job_id,workspace_id,attempt,event,worker_id,error_code) values(v_job.id,v_job.workspace_id,v_job.attempts,'failed',p_worker_id,p_error_code);
  return 'failed';
end;
$$;

-- One durable row per provider invocation, associated with a precise job claim.
-- Unknown outcomes keep a reserved hold, never a fabricated actual charge.
create table public.studio_transcription_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  upload_id uuid not null references public.studio_uploads(id) on delete cascade,
  job_id uuid not null references public.studio_jobs(id) on delete cascade,
  lease_token uuid not null,
  job_attempt integer not null,
  worker_id text not null,
  chunk_index integer not null check (chunk_index between 0 and 35),
  duration_seconds numeric not null check (duration_seconds > 0 and duration_seconds <= 600),
  usage_id uuid not null unique references public.studio_ai_usage(id) on delete restrict,
  status text not null check (status in ('started','succeeded','rejected','uncertain')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index studio_transcription_attempt_active_idx on public.studio_transcription_attempts(upload_id,chunk_index) where status <> 'rejected';
create index studio_transcription_attempt_job_idx on public.studio_transcription_attempts(job_id) where status='started';
alter table public.studio_transcription_attempts enable row level security;
revoke all on public.studio_transcription_attempts from public,anon,authenticated,service_role;
grant select on public.studio_transcription_attempts to service_role;

-- All mutation paths lock job first, then attempt. Holding the job row serializes
-- reclaim with the write. Check time AFTER obtaining the lock, even in long TXs.
create function public.studio_lock_transcription_lease(p_workspace_id uuid, p_upload_id uuid, p_job_id uuid, p_worker_id text, p_lease_token uuid)
returns public.studio_jobs language plpgsql security definer set search_path = '' as $$
declare j public.studio_jobs%rowtype;
begin
  select * into j from public.studio_jobs where id=p_job_id for update;
  if j.id is null or j.workspace_id <> p_workspace_id or j.kind <> 'studio.transcribe_upload'
    or j.payload->>'uploadId' is distinct from p_upload_id::text or j.status <> 'running'
    or j.lease_owner is distinct from p_worker_id or j.lease_token is distinct from p_lease_token
    or j.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'Current transcription lease required' using errcode='40001';
  end if;
  if not exists(select 1 from public.studio_uploads where id=p_upload_id and workspace_id=p_workspace_id
    and status='uploaded' and transcription_job_id=p_job_id) then
    raise exception 'Upload job mismatch' using errcode='22023';
  end if;
  return j;
end;
$$;

-- Runs on each claim, including when the exhausted/failed/cancelled job will
-- never run again. Old attempts keep both their association and their hold.
create function public.studio_recover_transcription_attempts()
returns integer language plpgsql security definer set search_path = '' as $$
declare j public.studio_jobs%rowtype; n integer := 0; changed integer;
begin
  for j in select * from public.studio_jobs q where exists
    (select 1 from public.studio_transcription_attempts a where a.job_id=q.id and a.status='started'
      and (q.status <> 'running' or q.lease_token is distinct from a.lease_token or q.lease_expires_at <= pg_catalog.clock_timestamp()))
    order by q.id limit 100 for update skip locked loop
    update public.studio_transcription_attempts set status='uncertain',updated_at=pg_catalog.clock_timestamp()
      where job_id=j.id and status='started' and (j.status <> 'running' or j.lease_token is distinct from lease_token
        or j.lease_expires_at <= pg_catalog.clock_timestamp());
    get diagnostics changed = row_count; n := n + changed;
  end loop;
  return n;
end;
$$;

create function public.studio_begin_transcription_attempt(p_workspace_id uuid, p_upload_id uuid, p_job_id uuid,
  p_worker_id text, p_lease_token uuid, p_chunk_index integer, p_duration_seconds numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.studio_jobs%rowtype; a uuid; u uuid;
begin
  j := public.studio_lock_transcription_lease(p_workspace_id,p_upload_id,p_job_id,p_worker_id,p_lease_token);
  if p_chunk_index is null or p_chunk_index not between 0 and 35 or p_duration_seconds is null
    or p_duration_seconds <= 0 or p_duration_seconds > 600 then raise exception 'Invalid chunk' using errcode='22023'; end if;
  if exists(select 1 from public.studio_transcript_chunks where upload_id=p_upload_id and chunk_index=p_chunk_index) then
    return '{"outcome":"saved"}'::jsonb;
  end if;
  if exists(select 1 from public.studio_transcription_attempts where upload_id=p_upload_id and chunk_index=p_chunk_index and status <> 'rejected') then
    return '{"outcome":"uncertain"}'::jsonb;
  end if;
  -- Retains the original whisper-1 estimate: 100 micro-USD per audio second.
  u := public.studio_reserve_ai_spend(p_workspace_id,'openai','transcribe_upload',pg_catalog.ceil(p_duration_seconds * 100)::bigint);
  if u is null then return '{"outcome":"budget_exhausted"}'::jsonb; end if;
  insert into public.studio_transcription_attempts(workspace_id,upload_id,job_id,lease_token,job_attempt,worker_id,chunk_index,duration_seconds,usage_id,status)
    values(p_workspace_id,p_upload_id,p_job_id,p_lease_token,j.attempts,p_worker_id,p_chunk_index,p_duration_seconds,u,'started') returning id into a;
  return pg_catalog.jsonb_build_object('outcome','started','attempt_id',a);
end;
$$;

-- A lost commit response is safe: a committed chunk is skipped on retry. If the
-- transaction did not commit, the started attempt blocks another provider call.
create function public.studio_finish_transcription_attempt(p_workspace_id uuid, p_upload_id uuid, p_job_id uuid,
  p_worker_id text, p_lease_token uuid, p_attempt_id uuid, p_text text, p_segments jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare a public.studio_transcription_attempts%rowtype;
begin
  perform public.studio_lock_transcription_lease(p_workspace_id,p_upload_id,p_job_id,p_worker_id,p_lease_token);
  select * into a from public.studio_transcription_attempts where id=p_attempt_id and job_id=p_job_id
    and upload_id=p_upload_id and workspace_id=p_workspace_id and lease_token=p_lease_token for update;
  if a.id is null or a.status not in ('started','succeeded') then raise exception 'Attempt cannot finish' using errcode='40001'; end if;
  if a.status='succeeded' then return true; end if;
  perform public.studio_save_transcript_chunk(p_workspace_id,p_upload_id,a.chunk_index,a.chunk_index*600,a.duration_seconds,'whisper-1',p_text,p_segments);
  perform public.studio_settle_ai_spend(p_workspace_id,a.usage_id,pg_catalog.ceil(a.duration_seconds*100)::bigint,'whisper-1',null,null,a.duration_seconds);
  update public.studio_transcription_attempts set status='succeeded',updated_at=pg_catalog.clock_timestamp() where id=a.id;
  return true;
end;
$$;

create function public.studio_close_transcription_attempt(p_workspace_id uuid, p_upload_id uuid, p_job_id uuid,
  p_worker_id text, p_lease_token uuid, p_attempt_id uuid, p_rejected boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.studio_transcription_attempts%rowtype;
begin
  perform public.studio_lock_transcription_lease(p_workspace_id,p_upload_id,p_job_id,p_worker_id,p_lease_token);
  select * into a from public.studio_transcription_attempts where id=p_attempt_id and job_id=p_job_id
    and upload_id=p_upload_id and workspace_id=p_workspace_id and lease_token=p_lease_token for update;
  if a.id is null then raise exception 'Attempt missing' using errcode='22023'; end if;
  if a.status <> 'started' then return; end if;
  if coalesce(p_rejected,false) then
    perform public.studio_release_ai_spend(p_workspace_id,a.usage_id);
  end if;
  update public.studio_transcription_attempts set status=case when coalesce(p_rejected,false) then 'rejected' else 'uncertain' end,
    updated_at=pg_catalog.clock_timestamp() where id=a.id;
end;
$$;

create function public.studio_finish_upload_transcript(p_workspace_id uuid, p_upload_id uuid, p_job_id uuid,
  p_worker_id text, p_lease_token uuid, p_model text, p_language text, p_duration_seconds numeric)
returns public.studio_transcripts language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform public.studio_lock_transcription_lease(p_workspace_id,p_upload_id,p_job_id,p_worker_id,p_lease_token);
  if p_duration_seconds is null or p_duration_seconds <= 0 or p_duration_seconds > 21600 or p_model is distinct from 'whisper-1' then
    raise exception 'Invalid transcript' using errcode='22023'; end if;
  n := pg_catalog.ceil(p_duration_seconds/600)::integer;
  -- Allow sub-millisecond JS subtraction/probe rounding, never missing chunks.
  if (select count(*) from public.studio_transcript_chunks where upload_id=p_upload_id) <> n
    or exists(select 1 from pg_catalog.generate_series(0,n-1) i where not exists
    (select 1 from public.studio_transcript_chunks c where c.upload_id=p_upload_id and c.workspace_id=p_workspace_id
      and c.chunk_index=i and c.start_seconds=i*600
      and pg_catalog.abs(c.duration_seconds-least(600,p_duration_seconds-i*600)) <= 0.001)) then
    raise exception 'Transcript incomplete' using errcode='22023'; end if;
  return public.studio_save_transcript(p_workspace_id,p_upload_id,p_model,p_language,p_duration_seconds);
end;
$$;

-- Remove all legacy unfenced worker mutation entry points. Generic usage RPCs
-- remain internal helpers; only durable attempt RPCs may spend from the worker.
revoke all on function public.studio_save_transcript_chunk(uuid,uuid,integer,numeric,numeric,text,text,jsonb) from service_role;
revoke all on function public.studio_save_transcript(uuid,uuid,text,text,numeric) from service_role;
revoke all on function public.studio_reserve_ai_spend(uuid,text,text,bigint) from service_role;
revoke all on function public.studio_settle_ai_spend(uuid,uuid,bigint,text,bigint,bigint,numeric) from service_role;
revoke all on function public.studio_release_ai_spend(uuid,uuid) from service_role;
revoke all on function public.studio_lock_transcription_lease(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

revoke all on function public.studio_extend_job_lease(uuid,text,uuid,integer) from public,anon,authenticated;
revoke all on function public.studio_complete_job(uuid,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.studio_fail_job(uuid,text,uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.studio_recover_transcription_attempts() from public,anon,authenticated;
revoke all on function public.studio_begin_transcription_attempt(uuid,uuid,uuid,text,uuid,integer,numeric) from public,anon,authenticated;
revoke all on function public.studio_finish_transcription_attempt(uuid,uuid,uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.studio_close_transcription_attempt(uuid,uuid,uuid,text,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.studio_finish_upload_transcript(uuid,uuid,uuid,text,uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.studio_extend_job_lease(uuid,text,uuid,integer) to service_role;
grant execute on function public.studio_complete_job(uuid,text,uuid,jsonb) to service_role;
grant execute on function public.studio_fail_job(uuid,text,uuid,text,text,boolean,integer) to service_role;
grant execute on function public.studio_recover_transcription_attempts() to service_role;
grant execute on function public.studio_begin_transcription_attempt(uuid,uuid,uuid,text,uuid,integer,numeric) to service_role;
grant execute on function public.studio_finish_transcription_attempt(uuid,uuid,uuid,text,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.studio_close_transcription_attempt(uuid,uuid,uuid,text,uuid,uuid,boolean) to service_role;
grant execute on function public.studio_finish_upload_transcript(uuid,uuid,uuid,text,uuid,text,text,numeric) to service_role;
commit;
