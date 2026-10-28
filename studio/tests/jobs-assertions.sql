-- Synthetic fixtures only. Queue claim/lease/retry semantics and authority.
do $$
declare
  w text := '90000000-0000-4000-8000-000000000001';
  other_w text := '90000000-0000-4000-8000-000000000002';
  j studio.studio_jobs%rowtype; j2 studio.studio_jobs%rowtype;
  claimed int; outcome text; t text; op text;
begin
  foreach t in array array['studio_jobs','studio_job_events','studio_worker_heartbeats'] loop
    foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('service_role','studio.'||t,op) then raise exception 'Unsafe direct write on %', t; end if;
    end loop;
    if has_table_privilege('authenticated','studio.'||t,'SELECT') then raise exception 'Client reads %', t; end if;
  end loop;
  if has_function_privilege('authenticated','studio.studio_claim_jobs(text,integer,integer)','EXECUTE')
    or has_function_privilege('anon','studio.studio_enqueue_job(text,text,jsonb,text,text,integer)','EXECUTE') then raise exception 'Unsafe job RPC grants'; end if;

  perform studio.studio_create_substo_location(w,'Jobs fixture','jobs-owner');
  perform studio.studio_create_substo_location(other_w,'Other jobs','jobs-other');

  j := studio.studio_enqueue_job(w,'studio.diagnostic','{"n":1}','diag:1','jobs-owner',2);
  if studio.studio_enqueue_job(w,'studio.diagnostic','{"n":1}','diag:1','jobs-owner',2) <> j then raise exception 'Enqueue not idempotent'; end if;
  begin perform studio.studio_enqueue_job(w,'studio.diagnostic','{"n":2}','diag:1','jobs-owner',2); raise exception 'Key reused for different payload';
  exception when sqlstate '23505' then null; end;
  j2 := studio.studio_enqueue_job(other_w,'studio.diagnostic','{}',null,'jobs-other',5);

  select count(*) into claimed from studio.studio_claim_jobs('worker-a',10,60);
  if claimed <> 2 then raise exception 'Expected 2 claims, got %', claimed; end if;
  if (select count(*) from studio.studio_claim_jobs('worker-b',10,60)) <> 0 then raise exception 'Double claim'; end if;
  if studio.studio_complete_job(j.id,'worker-b',(select lease_token from studio.studio_jobs where id=j.id),'{}') then raise exception 'Non-owner completed'; end if;
  if not studio.studio_extend_job_lease(j.id,'worker-a',(select lease_token from studio.studio_jobs where id=j.id),60) or studio.studio_extend_job_lease(j.id,'worker-b',(select lease_token from studio.studio_jobs where id=j.id),60) then raise exception 'Lease extension ownership'; end if;

  -- Retryable failure backs off; the attempt is kept.
  outcome := studio.studio_fail_job(j.id,'worker-a',(select lease_token from studio.studio_jobs where id=j.id),'provider_unavailable','OpenAI returned 503',true,null);
  select * into j from studio.studio_jobs where id=j.id;
  if outcome <> 'retry_scheduled' or j.status <> 'queued' or j.attempts <> 1 or j.run_after < now() + interval '29 seconds' or j.last_error_code <> 'provider_unavailable' then
    raise exception 'Unexpected retry state % %', outcome, row_to_json(j);
  end if;
  if (select count(*) from studio.studio_claim_jobs('worker-a',10,60) where id=j.id) <> 0 then raise exception 'Claimed before backoff'; end if;

  -- A crashed worker: the lease expires, the attempt counts, max attempts then fails.
  update studio.studio_jobs set run_after=now() - interval '1 second' where id=j.id;
  if (select count(*) from studio.studio_claim_jobs('worker-a',10,60) where id=j.id) <> 1 then raise exception 'Retry not claimable'; end if;
  update studio.studio_jobs set lease_expires_at=now() - interval '1 second' where id=j.id;
  perform studio.studio_claim_jobs('worker-b',10,60);
  select * into j from studio.studio_jobs where id=j.id;
  if j.status <> 'failed' or j.last_error_code <> 'worker_lease_expired' or j.attempts <> 2 then raise exception 'Exhausted lease did not fail %', row_to_json(j); end if;
  if studio.studio_complete_job(j.id,'worker-a',(select lease_token from studio.studio_jobs where id=j.id),'{}') then raise exception 'Stale worker completed reclaimed job'; end if;
  if (select array_agg(event order by id) from studio.studio_job_events where job_id=j.id)::text
    <> '{queued,started,retry_scheduled,started,lease_expired,failed}' then
    raise exception 'Unexpected events %', (select array_agg(event order by id) from studio.studio_job_events where job_id=j.id);
  end if;

  -- Members retry failed jobs in their own location only.
  begin perform studio.studio_member_job_action(w,'substo','jobs-other',j.id,'retry'); raise exception 'Non-member retried';
  exception when sqlstate '42501' then null; end;
  begin perform studio.studio_member_job_action(other_w,'substo','jobs-other',j.id,'retry'); raise exception 'Cross-location retry';
  exception when sqlstate '22023' then null; end;
  j := studio.studio_member_job_action(w,'substo','jobs-owner',j.id,'retry');
  if j.status <> 'queued' or j.attempts <> 0 or j.finished_at is not null then raise exception 'Retry did not requeue'; end if;
  j := studio.studio_member_job_action(w,'substo','jobs-owner',j.id,'cancel');
  if j.status <> 'cancelled' then raise exception 'Cancel failed'; end if;
  begin perform studio.studio_member_job_action(w,'substo','jobs-owner',j.id,'cancel'); raise exception 'Cancelled twice';
  exception when sqlstate '40001' then null; end;

  -- Non-retryable failure is final; success records result.
  outcome := studio.studio_fail_job(j2.id,'worker-a',(select lease_token from studio.studio_jobs where id=j2.id),'invalid_input','Bad payload',false,null);
  if outcome <> 'failed' then raise exception 'Non-retryable not final'; end if;
  j := studio.studio_enqueue_job(w,'studio.diagnostic','{}',null,'jobs-owner',5);
  perform studio.studio_claim_jobs('worker-c',1,60);
  if not studio.studio_complete_job(j.id,'worker-c',(select lease_token from studio.studio_jobs where id=j.id),'{"ok":true}') then raise exception 'Complete failed'; end if;
  if (select status from studio.studio_jobs where id=j.id) <> 'succeeded' then raise exception 'Complete not recorded'; end if;

  perform studio.studio_worker_heartbeat('worker-c','release-1',now());
  if not exists(select 1 from studio.studio_worker_heartbeats where worker_id='worker-c') then raise exception 'Heartbeat missing'; end if;
end;
$$;
select 'Studio job queue assertions passed' as result;
