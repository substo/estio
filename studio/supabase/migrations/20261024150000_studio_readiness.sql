-- Private operational readiness; no workspace payloads, credentials, provider calls or queue mutations.
begin;
alter table public.studio_worker_heartbeats
 add column instance_id text,
 add column protocol integer,
 add column handlers text[] not null default '{}',
 add column healthy boolean not null default false,
 add column draining boolean not null default false;

create function public.studio_report_worker(p_worker_id text,p_release text,p_started_at timestamptz,
 p_instance_id text,p_handlers text[],p_healthy boolean,p_draining boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_instance_id is null or p_instance_id !~ '^[A-Za-z0-9._:-]{1,100}$'
 or p_release is null or char_length(p_release) not between 1 and 100
 or p_started_at is null or not pg_catalog.isfinite(p_started_at)
 or p_started_at > pg_catalog.clock_timestamp()+interval '5 minutes'
 or p_handlers is null or cardinality(p_handlers) not between 1 and 20
 or exists(select 1 from unnest(p_handlers) h where h is null or h !~ '^studio\.[a-z_]{1,50}$')
 or p_healthy is null or p_draining is null then raise exception 'Invalid worker report' using errcode='22023'; end if;
 insert into public.studio_worker_heartbeats(worker_id,release,started_at,seen_at,instance_id,protocol,handlers,healthy,draining)
 values(p_worker_id,p_release,p_started_at,pg_catalog.clock_timestamp(),p_instance_id,1,p_handlers,p_healthy and not p_draining,p_draining)
 on conflict(worker_id) do update set release=excluded.release,started_at=excluded.started_at,seen_at=excluded.seen_at,
 instance_id=excluded.instance_id,protocol=excluded.protocol,handlers=excluded.handlers,
 healthy=excluded.healthy and not studio_worker_heartbeats.draining,
 draining=studio_worker_heartbeats.draining or excluded.draining
 -- An ID identifies one process lifetime. Do not let a late different process impersonate it.
 where studio_worker_heartbeats.instance_id is null or
 (studio_worker_heartbeats.instance_id=excluded.instance_id and studio_worker_heartbeats.started_at=excluded.started_at
  and studio_worker_heartbeats.release=excluded.release);
 if not found then raise exception 'Worker identity changed' using errcode='23505'; end if;
 delete from public.studio_worker_heartbeats where seen_at < pg_catalog.clock_timestamp()-interval '7 days';
end $$;

-- Old worker code remains callable, but its liveness cannot retain capable-report fields.
create or replace function public.studio_worker_heartbeat(p_worker_id text,p_release text,p_started_at timestamptz)
returns void language sql security definer set search_path='' as $$
 insert into public.studio_worker_heartbeats(worker_id,release,started_at,seen_at)
 values(p_worker_id,p_release,p_started_at,pg_catalog.clock_timestamp())
 on conflict(worker_id) do update set release=excluded.release,started_at=excluded.started_at,seen_at=excluded.seen_at,
 instance_id=null,protocol=null,handlers='{}',healthy=false,draining=false;
 delete from public.studio_worker_heartbeats where seen_at<pg_catalog.clock_timestamp()-interval '7 days';
$$;

-- Bound output without returning any profile/workspace IDs, signed URLs, ciphertext or queue payload.
create function public.studio_readiness_snapshot()
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object('schema',27,'protocol',1,'checkedAt',pg_catalog.statement_timestamp(),
  'keyIds',coalesce((select jsonb_agg(k) from (
   select key_id k from public.studio_workspace_ai_credentials union
   select refresh_cipher->>'keyId' from public.platform_google_youtube_connections
  ) keys),'[]'::jsonb),
  'queue',pg_catalog.jsonb_build_object(
   'due',(select count(*) from public.studio_jobs where status='queued' and run_after<=pg_catalog.statement_timestamp()),
   'oldestDueAt',(select min(run_after) from public.studio_jobs where status='queued' and run_after<=pg_catalog.statement_timestamp()),
   'expiredLeases',(select count(*) from public.studio_jobs where status='running' and lease_expires_at<=pg_catalog.statement_timestamp()),
   'uncertainAttempts',(select count(*) from public.studio_ai_attempts where status='uncertain')),
  'workers',coalesce((select jsonb_agg(row_to_json(w)) from (
   select release,instance_id,protocol,handlers,healthy,draining,seen_at,started_at
   from public.studio_worker_heartbeats where seen_at>pg_catalog.statement_timestamp()-interval '5 minutes'
   order by seen_at desc limit 100
  ) w),'[]'::jsonb));
$$;
revoke all on function public.studio_report_worker(text,text,timestamptz,text,text[],boolean,boolean) from public,anon,authenticated;
revoke all on function public.studio_readiness_snapshot() from public,anon,authenticated;
grant execute on function public.studio_report_worker(text,text,timestamptz,text,text[],boolean,boolean),public.studio_readiness_snapshot() to service_role;
commit;
