-- Hosted script briefs and explicit, version-safe human application.
-- Dedicated Studio database only. Text run storage keeps its legacy table name.
begin;
alter table public.studio_idea_reviews add column workflow text not null default 'idea_review'
  check (workflow in ('idea_review','script_brief'));
alter table public.studio_ai_attempts drop constraint studio_ai_attempt_subject;
alter table public.studio_ai_attempts add constraint studio_ai_attempt_subject check (
  (operation='transcribe_upload' and upload_id is not null and chunk_index is not null and duration_seconds is not null
    and idea_review_id is null and model='whisper-1') or
  (operation in ('idea_review','script_brief') and upload_id is null and chunk_index is null and duration_seconds is null
    and idea_review_id is not null and model='gpt-6-luna'));
drop index public.studio_ai_attempt_idea_active_idx;
create unique index studio_ai_attempt_text_active_idx on public.studio_ai_attempts(idea_review_id)
  where operation in ('idea_review','script_brief') and status<>'rejected' and not replacement_authorized;

create function public.studio_enqueue_text_run(p_location_id text, p_actor_app text, p_clerk_user_id text,
  p_request_id uuid, p_selection jsonb, p_focus text, p_confirm_paid boolean, p_workflow text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.studio_idea_reviews%rowtype; v_request jsonb; v_snapshot jsonb; v_ideas jsonb;
  v_review uuid := gen_random_uuid(); j public.studio_jobs%rowtype; ids uuid[];
begin
  perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  if p_workflow is null or p_workflow not in ('idea_review','script_brief') then raise exception 'Invalid text workflow' using errcode='22023'; end if;
  if p_workflow='script_brief' and jsonb_array_length(p_selection)<>1 then raise exception 'Select exactly one idea' using errcode='22023'; end if;
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
    if prior.workflow is distinct from p_workflow or prior.request is distinct from v_request then raise exception 'Review request reused' using errcode='23505'; end if;
    return jsonb_build_object('reviewId',prior.id,'jobId',prior.job_id);
  end if;
  if (select count(*) from public.studio_jobs where location_id=p_location_id and kind in ('studio.idea_review','studio.script_brief') and status in ('queued','running'))>=5 then
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
  if p_workflow='script_brief' and not exists(select 1 from jsonb_array_elements(v_snapshot->'ideas'->0->'sources') s where btrim(s->>'excerpt')<>'') then
    raise exception 'Save supporting research text and link it to this idea before drafting' using errcode='22023'; end if;
  j := public.studio_enqueue_job(p_location_id,'studio.'||p_workflow,jsonb_build_object('reviewId',v_review),'text-run:'||p_request_id::text,p_clerk_user_id,5);
  insert into public.studio_idea_reviews(id,location_id,request_id,created_by_clerk_user_id,actor_app,request,snapshot,job_id,workflow,prompt_version)
    values(v_review,p_location_id,p_request_id,p_clerk_user_id,p_actor_app,v_request,v_snapshot,j.id,p_workflow,case when p_workflow='script_brief' then 'studio.script-brief.v1' else 'studio.idea-review.v1' end);
  return jsonb_build_object('reviewId',v_review,'jobId',j.id);
end; $$;

create function public.studio_lock_text_run_lease(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid)
returns public.studio_jobs language plpgsql security definer set search_path='' as $$
declare j public.studio_jobs%rowtype;
begin
  select * into j from public.studio_jobs where id=p_job_id for update;
  if j.id is null or j.location_id<>p_location_id or j.kind not in ('studio.idea_review','studio.script_brief') or j.payload->>'reviewId' is distinct from p_review_id::text
    or j.status<>'running' or j.lease_owner is distinct from p_worker_id or j.lease_token is distinct from p_lease_token
    or j.lease_expires_at<=clock_timestamp() then raise exception 'Current idea-review lease required' using errcode='40001'; end if;
  if not exists(select 1 from public.studio_idea_reviews where id=p_review_id and location_id=p_location_id and job_id=p_job_id and 'studio.'||workflow=j.kind) then
    raise exception 'Review job mismatch' using errcode='22023'; end if;
  return j;
end; $$;

create function public.studio_begin_text_run_attempt(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.studio_jobs%rowtype; a uuid; u uuid; billing text; v_workflow text;
begin
  j := public.studio_lock_text_run_lease(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
  if exists(select 1 from public.studio_idea_reviews where id=p_review_id and result is not null) then return '{"outcome":"saved"}'; end if;
  select billing_outcome into billing from public.studio_ai_attempts where idea_review_id=p_review_id and status<>'rejected' and not replacement_authorized;
  if found then return jsonb_build_object('outcome',case when billing is null then 'uncertain' else 'reconciled' end); end if;
  select workflow into v_workflow from public.studio_idea_reviews where id=p_review_id;
  u := public.studio_reserve_ai_spend(p_location_id,'openai',v_workflow,10000);
  if u is null then return '{"outcome":"budget_exhausted"}'; end if;
  insert into public.studio_ai_attempts(location_id,job_id,lease_token,job_attempt,worker_id,usage_id,status,operation,idea_review_id,model)
    values(p_location_id,p_job_id,p_lease_token,j.attempts,p_worker_id,u,'started',v_workflow,p_review_id,'gpt-6-luna') returning id into a;
  return jsonb_build_object('outcome','started','attempt_id',a);
end; $$;

create function public.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare score jsonb; source jsonb; item jsonb; v_field text;
begin
  if p_result is null or jsonb_typeof(p_result)<>'object' then raise exception 'Invalid text result' using errcode='22023'; end if;
  if p_workflow='idea_review' then
    if octet_length(p_result::text)>20000 or jsonb_typeof(p_result->'scores') is distinct from 'array'
      or jsonb_typeof(p_result->'reason') is distinct from 'string' or coalesce(length(p_result->>'reason'),0) not between 1 and 2000
      or jsonb_typeof(p_result->'verificationGap') is distinct from 'string' or coalesce(length(p_result->>'verificationGap'),0) not between 1 and 2000 then
      raise exception 'Invalid idea review' using errcode='22023'; end if;
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

  elsif p_workflow='script_brief' then
    if jsonb_array_length(snapshot->'ideas')<>1 or octet_length(p_result::text)>64000 then raise exception 'Invalid script brief' using errcode='22023'; end if;
    foreach v_field in array array['audiencePromise','angle','hook','script'] loop
      if jsonb_typeof(p_result->v_field) is distinct from 'string' or coalesce(length(btrim(p_result->>v_field)),0) not between 1 and
        (case when v_field='script' then 16000 else 1000 end) then raise exception 'Invalid brief text' using errcode='22023'; end if;
    end loop;
    foreach v_field in array array['outline','verificationGaps'] loop
      if jsonb_typeof(p_result->v_field) is distinct from 'array' then raise exception 'Invalid brief list' using errcode='22023'; end if;
      if jsonb_array_length(p_result->v_field) not between 1 and 8 then raise exception 'Invalid brief list length' using errcode='22023'; end if;
      for item in select * from jsonb_array_elements(p_result->v_field) loop
        if jsonb_typeof(item)<>'string' or coalesce(length(btrim(item#>>'{}')),0) not between 1 and 500 then
          raise exception 'Invalid brief list item' using errcode='22023'; end if;
      end loop;
    end loop;
    if jsonb_typeof(p_result->'claims') is distinct from 'array' then raise exception 'Invalid brief claims' using errcode='22023'; end if;
    if jsonb_array_length(p_result->'claims') not between 1 and 8 then raise exception 'Invalid brief claim count' using errcode='22023'; end if;
    for score in select * from jsonb_array_elements(p_result->'claims') loop
      if jsonb_typeof(score->'claim') is distinct from 'string' or coalesce(length(btrim(score->>'claim')),0) not between 1 and 500
        or jsonb_typeof(score->'sourceIds') is distinct from 'array' or jsonb_typeof(score->'verificationNeeded') is distinct from 'boolean' then
        raise exception 'Invalid brief claim' using errcode='22023'; end if;
      if jsonb_array_length(score->'sourceIds')>3 or (jsonb_array_length(score->'sourceIds')=0 and score->'verificationNeeded'<>'true'::jsonb)
        or (select count(distinct s) from jsonb_array_elements(score->'sourceIds') s)<>jsonb_array_length(score->'sourceIds') then
        raise exception 'Unsupported claim must be marked for verification' using errcode='22023'; end if;
      for source in select * from jsonb_array_elements(score->'sourceIds') loop
        if not exists(select 1 from jsonb_array_elements(snapshot->'ideas'->0->'sources') s where s->'id'=source) then
          raise exception 'Unsupported brief citation' using errcode='22023'; end if;
      end loop;
    end loop;
  else raise exception 'Unsupported text workflow' using errcode='22023'; end if;
end; $$;

create function public.studio_finish_text_run_attempt(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,
  p_attempt_id uuid,p_result jsonb,p_input_tokens bigint,p_output_tokens bigint,p_response_id text,p_rate_version text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.studio_ai_attempts%rowtype; snapshot jsonb; v_workflow text; v_stale boolean;
begin
  perform public.studio_lock_text_run_lease(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
  select * into a from public.studio_ai_attempts where id=p_attempt_id and idea_review_id=p_review_id and location_id=p_location_id
    and job_id=p_job_id and lease_token=p_lease_token for update;
  if a.id is null or a.status not in ('started','succeeded') then raise exception 'Attempt cannot finish' using errcode='40001'; end if;
  if a.status='succeeded' then return true; end if;
  select r.snapshot,r.workflow into snapshot,v_workflow from public.studio_idea_reviews r where id=p_review_id for update;
  if p_input_tokens is null or p_input_tokens not between 0 and 60000 or p_output_tokens is null
    or p_output_tokens not between 0 and (case when v_workflow='script_brief' then 6000 else 3000 end)
    or p_response_id is null or length(p_response_id) not between 1 and 200
    or p_rate_version is distinct from 'gpt-6-luna-standard-2026-10-23' then raise exception 'Invalid text usage' using errcode='22023'; end if;
  perform public.studio_validate_text_run_result(v_workflow,p_result,snapshot);
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

create or replace function public.studio_enqueue_idea_review(p_location_id text,p_actor_app text,p_clerk_user_id text,
  p_request_id uuid,p_selection jsonb,p_focus text,p_confirm_paid boolean)
returns jsonb language sql security definer set search_path='' as $$
  select public.studio_enqueue_text_run(p_location_id,p_actor_app,p_clerk_user_id,p_request_id,p_selection,p_focus,p_confirm_paid,'idea_review');
$$;
create function public.studio_enqueue_script_brief(p_location_id text,p_actor_app text,p_clerk_user_id text,
  p_request_id uuid,p_selection jsonb,p_focus text,p_confirm_paid boolean)
returns jsonb language sql security definer set search_path='' as $$
  select public.studio_enqueue_text_run(p_location_id,p_actor_app,p_clerk_user_id,p_request_id,p_selection,p_focus,p_confirm_paid,'script_brief');
$$;
create or replace function public.studio_begin_idea_review_attempt(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.studio_lock_idea_review_lease(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
  return public.studio_begin_text_run_attempt(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
end; $$;
create or replace function public.studio_finish_idea_review_attempt(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,
  p_attempt_id uuid,p_result jsonb,p_input_tokens bigint,p_output_tokens bigint,p_response_id text,p_rate_version text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.studio_lock_idea_review_lease(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
  return public.studio_finish_text_run_attempt(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token,p_attempt_id,p_result,p_input_tokens,p_output_tokens,p_response_id,p_rate_version);
end; $$;
-- Applying is an independently authorized command, never a worker side effect.
create table public.studio_script_brief_applications (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  review_id uuid not null unique references public.studio_idea_reviews(id) on delete cascade,
  record_id uuid not null,
  request_id uuid not null,
  actor_app text not null check (actor_app in ('estio','substo')),
  actor_clerk_user_id text not null,
  previous_version bigint not null,
  record_version bigint not null,
  previous_script jsonb,
  previous_stage jsonb,
  previous_approved jsonb,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(location_id,request_id),
  foreign key (location_id,record_id) references public.studio_records(location_id,id) on delete cascade
);
alter table public.studio_script_brief_applications enable row level security;
revoke all on public.studio_script_brief_applications from public,anon,authenticated,service_role;
grant select on public.studio_script_brief_applications to service_role;
create function public.studio_apply_script_brief(p_location_id text,p_actor_app text,p_clerk_user_id text,p_review_id uuid,
  p_request_id uuid,p_expected_version bigint,p_confirm_replace boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.studio_idea_reviews%rowtype; application public.studio_script_brief_applications%rowtype;
  r public.studio_records%rowtype; v_request jsonb; v_result jsonb; item jsonb;
begin
  perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  if p_review_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1 or p_confirm_replace is distinct from true then
    raise exception 'Explicit script replacement confirmation required' using errcode='22023'; end if;
  v_request := jsonb_build_object('reviewId',p_review_id,'version',p_expected_version,'confirm',p_confirm_replace,'app',p_actor_app,'actor',p_clerk_user_id);
  select * into run from public.studio_idea_reviews where id=p_review_id and location_id=p_location_id and workflow='script_brief' for update;
  if not found then raise exception 'Script brief not found' using errcode='22023'; end if;
  select * into application from public.studio_script_brief_applications where location_id=p_location_id and request_id=p_request_id;
  if found then
    if application.request is distinct from v_request then raise exception 'Application request already used' using errcode='23505'; end if;
    return application.result;
  end if;
  if exists(select 1 from public.studio_script_brief_applications where review_id=run.id) then
    raise exception 'This brief was already applied' using errcode='40001'; end if;
  if run.result is null or run.stale_at_completion is distinct from false or run.prompt_version<>'studio.script-brief.v1'
    or jsonb_array_length(run.snapshot->'ideas')<>1 then raise exception 'A current completed brief is required' using errcode='40001'; end if;
  perform public.studio_validate_text_run_result('script_brief',run.result,run.snapshot);
  -- Lock every input in UUID order; any changed/deleted source blocks application.
  perform 1 from public.studio_records rec where rec.location_id=p_location_id and rec.id in
    (select (i->>'id')::uuid from jsonb_array_elements(run.snapshot->'ideas') i union
     select (s->>'id')::uuid from jsonb_array_elements(run.snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) order by rec.id for update;
  for item in select i from jsonb_array_elements(run.snapshot->'ideas') i union all
    select s from jsonb_array_elements(run.snapshot->'ideas') i,jsonb_array_elements(i->'sources') s loop
    if not exists(select 1 from public.studio_records rec where rec.location_id=p_location_id and rec.id=(item->>'id')::uuid
      and rec.version=(item->>'version')::bigint) then raise exception 'An input changed; keep this historical draft and generate a fresh brief before applying' using errcode='40001'; end if;
  end loop;
  select * into r from public.studio_records where location_id=p_location_id and id=(run.snapshot->'ideas'->0->>'id')::uuid;
  if r.kind<>'content' or r.archived or r.version<>p_expected_version or r.version<>(run.snapshot->'ideas'->0->>'version')::bigint
    or r.payload->>'stage' is distinct from 'idea' then raise exception 'Content changed; reload before applying' using errcode='40001'; end if;
  update public.studio_records set payload=payload||jsonb_build_object('script',run.result->>'script','stage','script','approved',false),
    version=version+1,updated_at=clock_timestamp() where location_id=p_location_id and id=r.id;
  v_result := jsonb_build_object('reviewId',run.id,'recordId',r.id,'recordVersion',r.version+1);
  insert into public.studio_script_brief_applications(location_id,review_id,record_id,request_id,actor_app,actor_clerk_user_id,
    previous_version,record_version,previous_script,previous_stage,previous_approved,request,result)
    values(p_location_id,run.id,r.id,p_request_id,p_actor_app,p_clerk_user_id,r.version,r.version+1,r.payload->'script',r.payload->'stage',r.payload->'approved',v_request,v_result);
  return v_result;
end; $$;
revoke all on function public.studio_enqueue_text_run(text,text,text,uuid,jsonb,text,boolean,text) from public,anon,authenticated,service_role;
revoke all on function public.studio_lock_text_run_lease(text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.studio_validate_text_run_result(text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.studio_enqueue_script_brief(text,text,text,uuid,jsonb,text,boolean) from public,anon,authenticated;
revoke all on function public.studio_begin_text_run_attempt(text,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.studio_finish_text_run_attempt(text,uuid,uuid,text,uuid,uuid,jsonb,bigint,bigint,text,text) from public,anon,authenticated;
revoke all on function public.studio_apply_script_brief(text,text,text,uuid,uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.studio_enqueue_script_brief(text,text,text,uuid,jsonb,text,boolean) to service_role;
grant execute on function public.studio_begin_text_run_attempt(text,uuid,uuid,text,uuid) to service_role;
grant execute on function public.studio_finish_text_run_attempt(text,uuid,uuid,text,uuid,uuid,jsonb,bigint,bigint,text,text) to service_role;
grant execute on function public.studio_apply_script_brief(text,text,text,uuid,uuid,bigint,boolean) to service_role;
commit;
