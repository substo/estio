-- Hosted idea review: bounded immutable inputs, shared durable paid attempts,
-- and separate advisory results. Dedicated Studio database only.
begin;
create table public.studio_idea_reviews (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  request_id uuid not null,
  created_by_clerk_user_id text not null,
  actor_app text not null check (actor_app in ('estio','substo')),
  request jsonb not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=24000),
  prompt_version text not null default 'studio.idea-review.v1',
  model text not null default 'gpt-6-luna',
  job_id uuid not null unique references public.studio_jobs(id) on delete cascade,
  result jsonb,
  stale_at_completion boolean,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(location_id,request_id)
);
alter table public.studio_idea_reviews enable row level security;
revoke all on public.studio_idea_reviews from public,anon,authenticated,service_role;
grant select on public.studio_idea_reviews to service_role;

-- Keep legacy transcription RPCs/REST reads through updatable, service-only
-- views. The shared physical tables own paid attempts and immutable reviews.
alter table public.studio_transcription_attempts rename to studio_ai_attempts;
alter table public.studio_ai_attempts alter column upload_id drop not null,
  alter column chunk_index drop not null, alter column duration_seconds drop not null;
alter table public.studio_ai_attempts add column operation text not null default 'transcribe_upload',
  add column idea_review_id uuid references public.studio_idea_reviews(id) on delete cascade,
  add column model text not null default 'whisper-1',
  add column provider_response_id text,
  add column rate_version text;
alter table public.studio_ai_attempts add constraint studio_ai_attempt_subject check (
  (operation='transcribe_upload' and upload_id is not null and chunk_index is not null and duration_seconds is not null
    and idea_review_id is null and model='whisper-1') or
  (operation='idea_review' and upload_id is null and chunk_index is null and duration_seconds is null
    and idea_review_id is not null and model='gpt-6-luna'));
create unique index studio_ai_attempt_idea_active_idx on public.studio_ai_attempts(idea_review_id)
  where operation='idea_review' and status<>'rejected' and not replacement_authorized;
create view public.studio_transcription_attempts as select id,location_id,upload_id,job_id,lease_token,job_attempt,worker_id,
  chunk_index,duration_seconds,usage_id,status,created_at,updated_at,review_version,billing_outcome,replacement_authorized
  from public.studio_ai_attempts where operation='transcribe_upload' with local check option;
revoke all on public.studio_transcription_attempts from public,anon,authenticated,service_role;
grant select on public.studio_transcription_attempts to service_role;
alter table public.studio_transcription_reviews rename to studio_ai_attempt_reviews;
create view public.studio_transcription_reviews as select * from public.studio_ai_attempt_reviews;
revoke all on public.studio_transcription_reviews from public,anon,authenticated,service_role;
grant select on public.studio_transcription_reviews to service_role;

create function public.studio_enqueue_idea_review(p_location_id text, p_actor_app text, p_clerk_user_id text,
  p_request_id uuid, p_selection jsonb, p_focus text, p_confirm_paid boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.studio_idea_reviews%rowtype; v_request jsonb; v_snapshot jsonb; v_ideas jsonb;
  v_review uuid := gen_random_uuid(); j public.studio_jobs%rowtype; ids uuid[];
begin
  perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  if p_request_id is null or p_confirm_paid is distinct from true or p_focus is null or char_length(p_focus)>300
    or p_selection is null or jsonb_typeof(p_selection)<>'array' or jsonb_array_length(p_selection) not between 1 and 5 then
    raise exception 'Select one to five ideas and authorize the review' using errcode='22023'; end if;
  -- Serialize per-location enqueue requests without conflicting with FK locks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idea-review:'||p_location_id::text,0));
  select array_agg((x->>'id')::uuid order by x->>'id') into ids from jsonb_array_elements(p_selection) x;
  if (select count(distinct id) from unnest(ids) id) <> jsonb_array_length(p_selection)
    or exists(select 1 from jsonb_array_elements(p_selection) x where x->>'version' is null or (x->>'version') !~ '^[1-9][0-9]{0,14}$') then
    raise exception 'Invalid idea selection' using errcode='22023'; end if;
  v_request := jsonb_build_object('selection',p_selection,'focus',p_focus,'actor',p_clerk_user_id,'app',p_actor_app);
  select * into prior from public.studio_idea_reviews where location_id=p_location_id and request_id=p_request_id;
  if found then
    if prior.request is distinct from v_request then raise exception 'Review request reused' using errcode='23505'; end if;
    return jsonb_build_object('reviewId',prior.id,'jobId',prior.job_id);
  end if;
  if (select count(*) from public.studio_jobs where location_id=p_location_id and kind='studio.idea_review' and status in ('queued','running'))>=5 then
    raise exception 'Too many active idea reviews' using errcode='40001'; end if;
  -- All selected records + their linked sources are locked in UUID order.
  -- Link edits increment/lock their source record version, so stale selection
  -- versions fail below rather than mixing snapshots across an edit.
  perform 1 from public.studio_records r where r.location_id=p_location_id and (r.id=any(ids) or r.id in
    (select target_id from public.studio_record_links where location_id=p_location_id and source_id=any(ids))) order by r.id for share;
  if exists(select 1 from jsonb_array_elements(p_selection) x where not exists(select 1 from public.studio_records r
    where r.location_id=p_location_id and r.id=(x->>'id')::uuid and r.version=(x->>'version')::bigint
      and r.kind='content' and not r.archived and r.payload->>'stage'='idea')) then
    raise exception 'An idea changed or is unavailable; reload' using errcode='40001'; end if;
  if exists(select 1 from public.studio_record_links where location_id=p_location_id and source_id=any(ids) group by source_id having count(*)>3) then
    raise exception 'Select ideas with at most three linked records for this bounded review' using errcode='22023'; end if;
  if exists(select 1 from public.studio_record_links l join public.studio_records s on s.location_id=l.location_id and s.id=l.target_id
    where l.location_id=p_location_id and l.source_id=any(ids) and char_length(s.source_url)>2000) then
    raise exception 'A linked source URL exceeds the review bound' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'title',left(r.title,180),
    'summary',left(coalesce(r.summary,''),700),'notes',left(coalesce(r.payload->>'notes',''),1000),
    'excerpted',char_length(r.title)>180 or char_length(coalesce(r.summary,''))>700 or char_length(coalesce(r.payload->>'notes',''))>1000,
    'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'title',left(s.title,180),
      'url',s.source_url,'excerpt',left(coalesce(nullif(s.payload->>'transcript',''),nullif(s.payload->>'notes',''),s.summary,''),600),
      'excerpted',char_length(s.title)>180 or char_length(coalesce(nullif(s.payload->>'transcript',''),nullif(s.payload->>'notes',''),s.summary,''))>600) order by s.id)
      from public.studio_record_links l join public.studio_records s on s.location_id=l.location_id and s.id=l.target_id
      where l.location_id=p_location_id and l.source_id=r.id),'[]'::jsonb)) order by r.id) into v_ideas
    from public.studio_records r where r.location_id=p_location_id and r.id=any(ids);
  v_snapshot := jsonb_build_object('focus',p_focus,'ideas',v_ideas);
  if octet_length(v_snapshot::text)>24000 then raise exception 'Selected research excerpts exceed review size; select fewer ideas' using errcode='22023'; end if;
  j := public.studio_enqueue_job(p_location_id,'studio.idea_review',jsonb_build_object('reviewId',v_review),'idea-review:'||p_request_id::text,p_clerk_user_id,5);
  insert into public.studio_idea_reviews(id,location_id,request_id,created_by_clerk_user_id,actor_app,request,snapshot,job_id)
    values(v_review,p_location_id,p_request_id,p_clerk_user_id,p_actor_app,v_request,v_snapshot,j.id);
  return jsonb_build_object('reviewId',v_review,'jobId',j.id);
end; $$;

create function public.studio_lock_idea_review_lease(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid)
returns public.studio_jobs language plpgsql security definer set search_path='' as $$
declare j public.studio_jobs%rowtype;
begin
  select * into j from public.studio_jobs where id=p_job_id for update;
  if j.id is null or j.location_id<>p_location_id or j.kind<>'studio.idea_review' or j.payload->>'reviewId' is distinct from p_review_id::text
    or j.status<>'running' or j.lease_owner is distinct from p_worker_id or j.lease_token is distinct from p_lease_token
    or j.lease_expires_at<=clock_timestamp() then raise exception 'Current idea-review lease required' using errcode='40001'; end if;
  if not exists(select 1 from public.studio_idea_reviews where id=p_review_id and location_id=p_location_id and job_id=p_job_id) then
    raise exception 'Review job mismatch' using errcode='22023'; end if;
  return j;
end; $$;

create function public.studio_begin_idea_review_attempt(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.studio_jobs%rowtype; a uuid; u uuid; billing text;
begin
  j := public.studio_lock_idea_review_lease(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
  if exists(select 1 from public.studio_idea_reviews where id=p_review_id and result is not null) then return '{"outcome":"saved"}'; end if;
  select billing_outcome into billing from public.studio_ai_attempts where idea_review_id=p_review_id and status<>'rejected' and not replacement_authorized;
  if found then return jsonb_build_object('outcome',case when billing is null then 'uncertain' else 'reconciled' end); end if;
  u := public.studio_reserve_ai_spend(p_location_id,'openai','idea_review',10000);
  if u is null then return '{"outcome":"budget_exhausted"}'; end if;
  insert into public.studio_ai_attempts(location_id,job_id,lease_token,job_attempt,worker_id,usage_id,status,operation,idea_review_id,model)
    values(p_location_id,p_job_id,p_lease_token,j.attempts,p_worker_id,u,'started','idea_review',p_review_id,'gpt-6-luna') returning id into a;
  return jsonb_build_object('outcome','started','attempt_id',a);
end; $$;

create function public.studio_finish_idea_review_attempt(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,
  p_attempt_id uuid,p_result jsonb,p_input_tokens bigint,p_output_tokens bigint,p_response_id text,p_rate_version text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.studio_ai_attempts%rowtype; snapshot jsonb; score jsonb; source jsonb; v_stale boolean;
begin
  perform public.studio_lock_idea_review_lease(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
  select * into a from public.studio_ai_attempts where id=p_attempt_id and idea_review_id=p_review_id and location_id=p_location_id
    and job_id=p_job_id and lease_token=p_lease_token for update;
  if a.id is null or a.status not in ('started','succeeded') then raise exception 'Attempt cannot finish' using errcode='40001'; end if;
  if a.status='succeeded' then return true; end if;
  if p_input_tokens is null or p_input_tokens not between 0 and 60000 or p_output_tokens is null or p_output_tokens not between 0 and 3000
    or p_response_id is null or length(p_response_id) not between 1 and 200 or p_rate_version is distinct from 'gpt-6-luna-standard-2026-10-23'
    or p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>20000
    or jsonb_typeof(p_result->'scores') is distinct from 'array' or coalesce(length(p_result->>'reason'),0) not between 1 and 2000
    or coalesce(length(p_result->>'verificationGap'),0) not between 1 and 2000 then raise exception 'Invalid review result' using errcode='22023'; end if;
  select r.snapshot into snapshot from public.studio_idea_reviews r where id=p_review_id for update;
  if jsonb_array_length(p_result->'scores')<>jsonb_array_length(snapshot->'ideas')
    or not exists(select 1 from jsonb_array_elements(snapshot->'ideas') i where i->>'id'=p_result->>'recommendation')
    or (select count(distinct s->>'ideaId') from jsonb_array_elements(p_result->'scores') s)<>jsonb_array_length(snapshot->'ideas') then
    raise exception 'Review does not cover selected ideas' using errcode='22023'; end if;
  for score in select * from jsonb_array_elements(p_result->'scores') loop
    if not exists(select 1 from jsonb_array_elements(snapshot->'ideas') i where i->>'id'=score->>'ideaId')
      or coalesce(length(score->>'rationale'),0) not between 1 and 1200 or jsonb_typeof(score->'sourceIds') is distinct from 'array'
      or exists(select 1 from unnest(array['relevance','evidence','timeliness','differentiation','ease']) k where (score->>k) is null or (score->>k) !~ '^[1-5]$') then
      raise exception 'Invalid idea score' using errcode='22023'; end if;
    for source in select * from jsonb_array_elements(score->'sourceIds') loop
      if not exists(select 1 from jsonb_array_elements(snapshot->'ideas') i,jsonb_array_elements(i->'sources') s
        where i->>'id'=score->>'ideaId' and s->'id'=source) then raise exception 'Unsupported source citation' using errcode='22023'; end if;
    end loop;
  end loop;
  -- Preserve paid results even when content changed; never write back into ideas.
  perform 1 from public.studio_records r where r.location_id=p_location_id and r.id in
    (select (i->>'id')::uuid from jsonb_array_elements(snapshot->'ideas') i union
     select (s->>'id')::uuid from jsonb_array_elements(snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) order by r.id for share;
  select exists(select 1 from (select i from jsonb_array_elements(snapshot->'ideas') i union all
    select s from jsonb_array_elements(snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) x where not exists
    (select 1 from public.studio_records r where r.location_id=p_location_id and r.id=(x.i->>'id')::uuid and r.version=(x.i->>'version')::bigint)) into v_stale;
  perform public.studio_settle_ai_spend(p_location_id,a.usage_id,ceil((p_input_tokens::numeric+5*p_output_tokens)/10)::bigint,
    a.model,p_input_tokens,p_output_tokens,null);
  update public.studio_idea_reviews set result=p_result,stale_at_completion=v_stale,completed_at=clock_timestamp() where id=p_review_id;
  update public.studio_ai_attempts set status='succeeded',provider_response_id=p_response_id,rate_version=p_rate_version,updated_at=clock_timestamp() where id=a.id;
  return true;
end; $$;

-- Closing a provider call is shared by all hosted paid jobs. Transcript wrappers
-- remain available, but all newer jobs use this lease-fenced operation.
create function public.studio_close_ai_attempt(p_location_id text,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_attempt_id uuid,p_rejected boolean)
returns void language plpgsql security definer set search_path='' as $$
declare j public.studio_jobs%rowtype; a public.studio_ai_attempts%rowtype;
begin
  select * into j from public.studio_jobs where id=p_job_id for update;
  if j.id is null or j.location_id<>p_location_id or j.status<>'running' or j.lease_owner is distinct from p_worker_id
    or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then raise exception 'Current paid-job lease required' using errcode='40001'; end if;
  select * into a from public.studio_ai_attempts where id=p_attempt_id and location_id=p_location_id and job_id=p_job_id and lease_token=p_lease_token for update;
  if a.id is null then raise exception 'Attempt missing' using errcode='22023'; end if;
  if a.status<>'started' then return; end if;
  if coalesce(p_rejected,false) then perform public.studio_release_ai_spend(p_location_id,a.usage_id); end if;
  update public.studio_ai_attempts set status=case when coalesce(p_rejected,false) then 'rejected' else 'uncertain' end,updated_at=clock_timestamp() where id=a.id;
end; $$;

create function public.studio_review_ai_attempt(p_location_id text, p_actor_app text, p_clerk_user_id text,
  p_attempt_id uuid, p_request_id uuid, p_expected_version bigint, p_action text, p_evidence text, p_cost_micros bigint, p_confirm_paid boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.studio_ai_attempts%rowtype;
  j public.studio_jobs%rowtype;
  prior public.studio_ai_attempt_reviews%rowtype;
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
  select job_id into v_job_id from public.studio_ai_attempts where id=p_attempt_id and location_id=p_location_id;
  if not found then raise exception 'Attempt not found' using errcode='22023'; end if;
  select * into j from public.studio_jobs where id=v_job_id and location_id=p_location_id for update;
  select * into a from public.studio_ai_attempts where id=p_attempt_id and location_id=p_location_id for update;
  select * into prior from public.studio_ai_attempt_reviews where location_id=p_location_id and request_id=p_request_id;
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
    or exists(select 1 from public.studio_transcripts where upload_id=a.upload_id)
    or exists(select 1 from public.studio_idea_reviews where id=a.idea_review_id and result is not null)) then
    raise exception 'Reconcile billing before replacement' using errcode='40001';
  end if;
  if p_action <> 'authorize_replacement' and a.billing_outcome is not null then
    raise exception 'Billing already reconciled' using errcode='40001';
  end if;
  -- Expired executions are fenced and stopped in the same transaction. Never
  -- let an old claim write after a manager releases/settles its reservation.
  if j.status='running' then
    update public.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,
      last_error_code='ai_outcome_uncertain',last_error_message='AI processing outcome requires review.',
      finished_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=j.id;
    insert into public.studio_job_events(job_id,location_id,attempt,event,worker_id,error_code)
      values(j.id,p_location_id,j.attempts,'lease_expired',j.lease_owner,'worker_lease_expired'),
        (j.id,p_location_id,j.attempts,'failed',null,'ai_outcome_uncertain');
  end if;
  if p_action='authorize_replacement' then
    update public.studio_ai_attempts set status='uncertain',replacement_authorized=true,
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
      perform public.studio_settle_ai_spend(p_location_id,a.usage_id,p_cost_micros,a.model,null,null,a.duration_seconds);
    end if;
    update public.studio_ai_attempts set status='uncertain',billing_outcome=p_action,
      review_version=review_version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id;
  end if;
  v_result := pg_catalog.jsonb_build_object('reviewId',v_review,'version',a.review_version+1,'action',p_action,'jobId',j.id);
  insert into public.studio_ai_attempt_reviews(id,location_id,attempt_id,request_id,actor_app,actor_clerk_user_id,
    action,evidence,cost_micros,previous_version,version,request,result)
    values(v_review,p_location_id,a.id,p_request_id,p_actor_app,p_clerk_user_id,p_action,v_evidence,p_cost_micros,a.review_version,a.review_version+1,v_request,v_result);
  return v_result;
end;
$$;

create function public.studio_recover_ai_attempts()
returns integer language plpgsql security definer set search_path = '' as $$
declare j public.studio_jobs%rowtype; n integer := 0; changed integer;
begin
  for j in select * from public.studio_jobs q where exists
    (select 1 from public.studio_ai_attempts a where a.job_id=q.id and a.status='started'
      and (q.status <> 'running' or q.lease_token is distinct from a.lease_token or q.lease_expires_at <= pg_catalog.clock_timestamp()))
    order by q.id limit 100 for update skip locked loop
    update public.studio_ai_attempts set status='uncertain',updated_at=pg_catalog.clock_timestamp()
      where job_id=j.id and status='started' and (j.status <> 'running' or j.lease_token is distinct from lease_token
        or j.lease_expires_at <= pg_catalog.clock_timestamp());
    get diagnostics changed = row_count; n := n + changed;
  end loop;
  return n;
end;
$$;
create or replace function public.studio_recover_transcription_attempts()
returns integer language sql security definer set search_path='' as $$ select public.studio_recover_ai_attempts(); $$;
create or replace function public.studio_review_transcription_attempt(p_location_id text,p_actor_app text,p_clerk_user_id text,
  p_attempt_id uuid,p_request_id uuid,p_expected_version bigint,p_action text,p_evidence text,p_cost_micros bigint,p_confirm_paid boolean)
returns jsonb language sql security definer set search_path='' as $$
  select public.studio_review_ai_attempt(p_location_id,p_actor_app,p_clerk_user_id,p_attempt_id,p_request_id,p_expected_version,p_action,p_evidence,p_cost_micros,p_confirm_paid);
$$;
revoke all on function public.studio_lock_idea_review_lease(text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.studio_recover_ai_attempts() from public,anon,authenticated,service_role;
revoke all on function public.studio_enqueue_idea_review(text,text,text,uuid,jsonb,text,boolean) from public,anon,authenticated;
revoke all on function public.studio_begin_idea_review_attempt(text,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.studio_finish_idea_review_attempt(text,uuid,uuid,text,uuid,uuid,jsonb,bigint,bigint,text,text) from public,anon,authenticated;
revoke all on function public.studio_close_ai_attempt(text,uuid,text,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.studio_review_ai_attempt(text,text,text,uuid,uuid,bigint,text,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.studio_enqueue_idea_review(text,text,text,uuid,jsonb,text,boolean) to service_role;
grant execute on function public.studio_begin_idea_review_attempt(text,uuid,uuid,text,uuid) to service_role;
grant execute on function public.studio_finish_idea_review_attempt(text,uuid,uuid,text,uuid,uuid,jsonb,bigint,bigint,text,text) to service_role;
grant execute on function public.studio_close_ai_attempt(text,uuid,text,uuid,uuid,boolean) to service_role;
grant execute on function public.studio_review_ai_attempt(text,text,text,uuid,uuid,bigint,text,text,bigint,boolean) to service_role;
-- Legacy upload-specific wrapper delegates paid close mechanics to the shared API.
create or replace function public.studio_close_transcription_attempt(p_location_id text,p_upload_id uuid,p_job_id uuid,
  p_worker_id text,p_lease_token uuid,p_attempt_id uuid,p_rejected boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.studio_lock_transcription_lease(p_location_id,p_upload_id,p_job_id,p_worker_id,p_lease_token);
  if not exists(select 1 from public.studio_transcription_attempts where id=p_attempt_id and upload_id=p_upload_id
    and location_id=p_location_id and job_id=p_job_id and lease_token=p_lease_token) then
    raise exception 'Upload attempt mismatch' using errcode='22023'; end if;
  perform public.studio_close_ai_attempt(p_location_id,p_job_id,p_worker_id,p_lease_token,p_attempt_id,p_rejected);
end; $$;
commit;
