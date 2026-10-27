-- Audited manager reconciliation. Resolving billing NEVER grants a replacement
-- provider call; that requires a second explicit, versioned authorization.
begin;
alter table public.studio_transcription_attempts
  add column review_version bigint not null default 1 check (review_version > 0),
  add column billing_outcome text check (billing_outcome in ('no_charge','billed')),
  add column replacement_authorized boolean not null default false,
  add constraint studio_attempt_review_state check (
    (billing_outcome is null or status='uncertain') and (not replacement_authorized or billing_outcome is not null));
drop index public.studio_transcription_attempt_active_idx;
create unique index studio_transcription_attempt_active_idx on public.studio_transcription_attempts(upload_id,chunk_index)
  where status <> 'rejected' and not replacement_authorized;

create table public.studio_transcription_reviews (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  attempt_id uuid not null references public.studio_transcription_attempts(id) on delete cascade,
  request_id uuid not null,
  actor_app text not null check (actor_app in ('estio','substo')),
  actor_clerk_user_id text not null,
  action text not null check (action in ('no_charge','billed','authorize_replacement')),
  evidence text not null check (char_length(evidence) between 20 and 2000),
  cost_micros bigint check (cost_micros between 0 and 100000000000),
  previous_version bigint not null,
  version bigint not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(location_id,request_id),
  unique(attempt_id,version)
);
create index studio_transcription_reviews_location_idx on public.studio_transcription_reviews(location_id,created_at desc);
alter table public.studio_transcription_reviews enable row level security;
revoke all on public.studio_transcription_reviews from public,anon,authenticated,service_role;
grant select on public.studio_transcription_reviews to service_role;

create function public.studio_review_transcription_attempt(p_location_id text, p_actor_app text, p_clerk_user_id text,
  p_attempt_id uuid, p_request_id uuid, p_expected_version bigint, p_action text, p_evidence text, p_cost_micros bigint, p_confirm_paid boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.studio_transcription_attempts%rowtype;
  j public.studio_jobs%rowtype;
  prior public.studio_transcription_reviews%rowtype;
  v_job_id uuid; v_request jsonb; v_result jsonb; v_review uuid := gen_random_uuid();
  v_evidence text := pg_catalog.btrim(p_evidence);
begin
  if p_request_id is null or p_attempt_id is null or p_expected_version is null or p_expected_version < 1
    or p_action is null or p_action not in ('no_charge','billed','authorize_replacement')
    or v_evidence is null or char_length(v_evidence) not between 20 and 2000
    or v_evidence ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' or v_evidence ~ 'sk-[A-Za-z0-9_-]{16,}' then
    raise exception 'Invalid reconciliation review' using errcode='22023';
  end if;
  if p_action='authorize_replacement' then
    if p_confirm_paid is distinct from true or p_cost_micros is not null then raise exception 'Explicit paid authorization required' using errcode='22023'; end if;
  elsif p_confirm_paid is distinct from false or p_cost_micros is null or p_cost_micros not between 0 and 100000000000
    or (p_action='no_charge' and p_cost_micros <> 0) or (p_action='billed' and p_cost_micros=0) then
    raise exception 'Confirmed cost required' using errcode='22023';
  end if;
  -- Member helper locks the membership through this transaction; role changes
  -- and revocation cannot race review. Estio location ADMIN is checked by app.
  perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  if p_actor_app='substo' and not exists(select 1 from public.studio_location_memberships
    where location_id=p_location_id and clerk_user_id=p_clerk_user_id and role in ('owner','admin')) then
    raise exception 'AI manager required' using errcode='42501';
  end if;
  v_request := pg_catalog.jsonb_build_object('attempt',p_attempt_id,'version',p_expected_version,'action',p_action,
    'evidence',v_evidence,'cost',p_cost_micros,'confirm',p_confirm_paid,'app',p_actor_app,'actor',p_clerk_user_id);
  -- Lock in the same order as worker writes and reclaim: job, then attempt.
  select job_id into v_job_id from public.studio_transcription_attempts where id=p_attempt_id and location_id=p_location_id;
  if not found then raise exception 'Attempt not found' using errcode='22023'; end if;
  select * into j from public.studio_jobs where id=v_job_id and location_id=p_location_id for update;
  select * into a from public.studio_transcription_attempts where id=p_attempt_id and location_id=p_location_id for update;
  select * into prior from public.studio_transcription_reviews where location_id=p_location_id and request_id=p_request_id;
  if found then
    if prior.request is distinct from v_request then raise exception 'Review request already used' using errcode='23505'; end if;
    return prior.result;
  end if;
  if a.review_version <> p_expected_version then raise exception 'Review changed; reload' using errcode='40001'; end if;
  if j.status='running' and j.lease_expires_at > pg_catalog.clock_timestamp() then
    raise exception 'Wait for the active worker to finish' using errcode='40001';
  end if;
  if a.status not in ('started','uncertain') or a.replacement_authorized or exists
    (select 1 from public.studio_transcript_chunks where upload_id=a.upload_id and chunk_index=a.chunk_index) then
    raise exception 'Attempt does not need review' using errcode='40001';
  end if;
  if p_action='authorize_replacement' and (a.billing_outcome is null or j.status='succeeded'
    or exists(select 1 from public.studio_transcripts where upload_id=a.upload_id)) then
    raise exception 'Reconcile billing before replacement' using errcode='40001';
  end if;
  if p_action <> 'authorize_replacement' and a.billing_outcome is not null then
    raise exception 'Billing already reconciled' using errcode='40001';
  end if;
  -- Expired executions are fenced and stopped in the same transaction. Never
  -- let an old claim write after a manager releases/settles its reservation.
  if j.status='running' then
    update public.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,
      last_error_code='transcription_outcome_uncertain',last_error_message='Transcription outcome requires review.',
      finished_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=j.id;
    insert into public.studio_job_events(job_id,location_id,attempt,event,worker_id,error_code)
      values(j.id,p_location_id,j.attempts,'lease_expired',j.lease_owner,'worker_lease_expired'),
        (j.id,p_location_id,j.attempts,'failed',null,'transcription_outcome_uncertain');
  end if;
  if p_action='authorize_replacement' then
    update public.studio_transcription_attempts set status='uncertain',replacement_authorized=true,
      review_version=review_version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id;
    update public.studio_jobs set status='queued',attempts=0,lease_owner=null,lease_expires_at=null,run_after=pg_catalog.clock_timestamp(),
      finished_at=null,last_error_code=null,last_error_message=null,updated_at=pg_catalog.clock_timestamp() where id=j.id;
    insert into public.studio_job_events(job_id,location_id,attempt,event,actor_clerk_user_id)
      values(j.id,p_location_id,0,'requeued',p_clerk_user_id);
  else
    if not exists(select 1 from public.studio_ai_usage where id=a.usage_id and location_id=p_location_id and status='reserved') then
      raise exception 'Reservation no longer available' using errcode='40001'; end if;
    if p_action='no_charge' then
      perform public.studio_release_ai_spend(p_location_id,a.usage_id);
    else
      perform public.studio_settle_ai_spend(p_location_id,a.usage_id,p_cost_micros,'whisper-1',null,null,a.duration_seconds);
    end if;
    update public.studio_transcription_attempts set status='uncertain',billing_outcome=p_action,
      review_version=review_version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id;
  end if;
  v_result := pg_catalog.jsonb_build_object('reviewId',v_review,'version',a.review_version+1,'action',p_action,'jobId',j.id);
  insert into public.studio_transcription_reviews(id,location_id,attempt_id,request_id,actor_app,actor_clerk_user_id,
    action,evidence,cost_micros,previous_version,version,request,result)
    values(v_review,p_location_id,a.id,p_request_id,p_actor_app,p_clerk_user_id,p_action,v_evidence,p_cost_micros,a.review_version,a.review_version+1,v_request,v_result);
  return v_result;
end;
$$;
revoke all on function public.studio_review_transcription_attempt(text,text,text,uuid,uuid,bigint,text,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.studio_review_transcription_attempt(text,text,text,uuid,uuid,bigint,text,text,bigint,boolean) to service_role;

create or replace function public.studio_begin_transcription_attempt(p_location_id text, p_upload_id uuid, p_job_id uuid,
  p_worker_id text, p_lease_token uuid, p_chunk_index integer, p_duration_seconds numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.studio_jobs%rowtype; a uuid; u uuid; v_billing text;
begin
  j := public.studio_lock_transcription_lease(p_location_id,p_upload_id,p_job_id,p_worker_id,p_lease_token);
  if p_chunk_index is null or p_chunk_index not between 0 and 35 or p_duration_seconds is null
    or p_duration_seconds <= 0 or p_duration_seconds > 600 then raise exception 'Invalid chunk' using errcode='22023'; end if;
  if exists(select 1 from public.studio_transcript_chunks where upload_id=p_upload_id and chunk_index=p_chunk_index) then
    return '{"outcome":"saved"}'::jsonb;
  end if;
  select billing_outcome into v_billing from public.studio_transcription_attempts where upload_id=p_upload_id
    and chunk_index=p_chunk_index and status <> 'rejected' and not replacement_authorized;
  if found then
    return pg_catalog.jsonb_build_object('outcome',case when v_billing is null then 'uncertain' else 'reconciled' end);
  end if;
  -- Retains the original whisper-1 estimate: 100 micro-USD per audio second.
  u := public.studio_reserve_ai_spend(p_location_id,'openai','transcribe_upload',pg_catalog.ceil(p_duration_seconds * 100)::bigint);
  if u is null then return '{"outcome":"budget_exhausted"}'::jsonb; end if;
  insert into public.studio_transcription_attempts(location_id,upload_id,job_id,lease_token,job_attempt,worker_id,chunk_index,duration_seconds,usage_id,status)
    values(p_location_id,p_upload_id,p_job_id,p_lease_token,j.attempts,p_worker_id,p_chunk_index,p_duration_seconds,u,'started') returning id into a;
  return pg_catalog.jsonb_build_object('outcome','started','attempt_id',a);
end;
$$;
commit;
