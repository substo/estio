begin;
-- Shared snapshot mechanics for interactive enqueue and pinned recurring consent.
create function public.studio_build_selected_text_snapshot(p_location_id text,p_selection jsonb,p_focus text,p_workflow text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; v_ideas jsonb; v_snapshot jsonb;
begin
  if p_workflow is null or p_workflow not in ('idea_review','script_brief') or p_focus is null or char_length(p_focus)>300
    or p_selection is null or jsonb_typeof(p_selection)<>'array' or jsonb_array_length(p_selection) not between 1 and 5
    or (p_workflow='script_brief' and jsonb_array_length(p_selection)<>1) then raise exception 'Invalid recurring inputs' using errcode='22023'; end if;
  select array_agg((x->>'id')::uuid order by x->>'id') into ids from jsonb_array_elements(p_selection) x;
  if (select count(distinct id) from unnest(ids) id) <> jsonb_array_length(p_selection)
    or exists(select 1 from jsonb_array_elements(p_selection) x where x->>'version' is null or (x->>'version') !~ '^[1-9][0-9]{0,14}$') then
    raise exception 'Invalid idea selection' using errcode='22023'; end if;
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
  return v_snapshot;
end; $$;
revoke all on function public.studio_build_selected_text_snapshot(text,jsonb,text,text) from public,anon,authenticated,service_role;

create or replace function public.studio_enqueue_text_run(p_location_id text, p_actor_app text, p_clerk_user_id text,
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
  if (select count(*) from public.studio_jobs where location_id=p_location_id and kind in ('studio.idea_review','studio.script_brief','studio.knowledge_extract') and status in ('queued','running'))>=5 then
    raise exception 'Too many active idea reviews' using errcode='40001'; end if;
  v_snapshot := public.studio_build_selected_text_snapshot(p_location_id,p_selection,p_focus,p_workflow);
  j := public.studio_enqueue_job(p_location_id,'studio.'||p_workflow,jsonb_build_object('reviewId',v_review),'text-run:'||p_request_id::text,p_clerk_user_id,5);
  insert into public.studio_idea_reviews(id,location_id,request_id,created_by_clerk_user_id,actor_app,request,snapshot,job_id,workflow,prompt_version)
    values(v_review,p_location_id,p_request_id,p_clerk_user_id,p_actor_app,v_request,v_snapshot,j.id,p_workflow,case when p_workflow='script_brief' then 'studio.script-brief.v1' else 'studio.idea-review.v1' end);
  return jsonb_build_object('reviewId',v_review,'jobId',j.id);
end; $$;

create table public.studio_schedule_recurring (
  location_id text not null, schedule_id uuid not null,
  version bigint not null default 1 check (version>0),
  enabled boolean not null default false,
  actor_app text not null check (actor_app in ('estio','substo')),
  authorized_by text not null,
  schedule_version bigint not null,
  selection jsonb not null,
  snapshot jsonb not null check (octet_length(snapshot::text)<=24000),
  activation_token uuid not null default gen_random_uuid(),
  next_run_at timestamptz,
  last_outcome text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(location_id,schedule_id),
  foreign key(location_id,schedule_id) references public.studio_schedules(location_id,id),
  check (enabled=(next_run_at is not null))
);
create index studio_schedule_due_idx on public.studio_schedule_recurring(next_run_at,location_id,schedule_id) where enabled;
create table public.studio_schedule_commands (
  location_id text not null references public.studio_locations(location_id), request_id uuid not null,
  request jsonb not null, result jsonb not null, snapshot jsonb,
  created_at timestamptz not null default clock_timestamp(), primary key(location_id,request_id)
);
alter table public.studio_schedule_executions add column activation_token uuid, add column due_at timestamptz;
create unique index studio_schedule_due_execution_idx on public.studio_schedule_executions(location_id,schedule_id,activation_token,due_at) where activation_token is not null;
create table public.studio_schedule_ticks (
  location_id text not null, schedule_id uuid not null, activation_token uuid not null, due_at timestamptz not null,
  outcome text not null check (outcome in ('queued','busy','authority_revoked','inputs_changed','charge_review_required')),
  execution_id uuid references public.studio_schedule_executions(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(location_id,schedule_id,activation_token,due_at),
  foreign key(location_id,schedule_id) references public.studio_schedules(location_id,id)
);
alter table public.studio_schedule_recurring enable row level security;
alter table public.studio_schedule_commands enable row level security;
alter table public.studio_schedule_ticks enable row level security;
revoke all on public.studio_schedule_recurring,public.studio_schedule_commands,public.studio_schedule_ticks from public,anon,authenticated,service_role;
grant select on public.studio_schedule_recurring,public.studio_schedule_commands,public.studio_schedule_ticks to service_role;

-- Daily wall time uses PostgreSQL's IANA rules: a gap rolls forward; a repeated
-- time uses its later (standard-time) occurrence. Weekly is 168 elapsed hours.
create function public.studio_next_schedule_due(p_after timestamptz,p_interval integer,p_time text,p_zone text)
returns timestamptz language plpgsql set search_path='' as $$
declare candidate timestamptz; d date;
begin
  if p_after is null or p_interval is null or p_interval not in (24,168) or p_zone is distinct from 'Asia/Nicosia'
    or p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid cadence' using errcode='22023'; end if;
  if p_interval=168 then return p_after+interval '168 hours'; end if;
  d := (p_after at time zone p_zone)::date;
  candidate := (d+p_time::time) at time zone p_zone;
  if candidate<=p_after then candidate := ((d+1)+p_time::time) at time zone p_zone; end if;
  return candidate;
end; $$;
revoke all on function public.studio_next_schedule_due(timestamptz,integer,text,text) from public,anon,authenticated,service_role;

create function public.studio_set_schedule_recurring(p_location_id text,p_actor_app text,p_clerk_user_id text,
  p_schedule_id uuid,p_expected_version bigint,p_state_version bigint,p_request_id uuid,p_action text,p_selection jsonb,p_confirm_paid boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.studio_schedules%rowtype; r public.studio_schedule_recurring%rowtype; prior public.studio_schedule_commands%rowtype;
  command jsonb; result jsonb; v_snapshot jsonb; v_workflow text;
begin
  perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  if p_schedule_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
    or p_state_version is null or p_state_version<0 or p_action is null or p_action not in ('enable','pause') then
    raise exception 'Invalid schedule command' using errcode='22023'; end if;
  if p_action='enable' and p_confirm_paid is distinct from true then raise exception 'Explicit recurring spend authorization required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('schedule-command:'||p_location_id::text||':'||p_request_id::text,0));
  command := jsonb_build_object('action',p_action,'scheduleId',p_schedule_id,'version',p_expected_version,'stateVersion',p_state_version,
    'actor',p_clerk_user_id,'app',p_actor_app,'selection',p_selection,'confirmPaid',p_confirm_paid);
  select * into prior from public.studio_schedule_commands where location_id=p_location_id and request_id=p_request_id;
  if found then
    if prior.request is distinct from command then raise exception 'Command request reused' using errcode='23505'; end if;
    return prior.result;
  end if;
  if exists(select 1 from public.studio_schedule_executions where location_id=p_location_id and request_id=p_request_id) then raise exception 'Run request reused' using errcode='23505'; end if;
  select * into s from public.studio_schedules where location_id=p_location_id and id=p_schedule_id for update;
  if s.id is null or s.version<>p_expected_version then raise exception 'Schedule changed' using errcode='40001'; end if;
  select * into r from public.studio_schedule_recurring where location_id=p_location_id and schedule_id=p_schedule_id for update;
  if coalesce(r.version,0)<>p_state_version then raise exception 'Activation changed' using errcode='40001'; end if;
  if p_action='enable' then
    if s.preset_id not in ('idea-review','script-brief') then raise exception 'YouTube needs a personal grant design' using errcode='22023'; end if;
    v_workflow := case when s.preset_id='idea-review' then 'idea_review' else 'script_brief' end;
    v_snapshot := public.studio_build_selected_text_snapshot(p_location_id,p_selection,s.focus,v_workflow);
    insert into public.studio_schedule_recurring(location_id,schedule_id,actor_app,authorized_by,schedule_version,selection,snapshot,enabled,next_run_at,last_outcome)
      values(p_location_id,p_schedule_id,p_actor_app,p_clerk_user_id,s.version,p_selection,v_snapshot,true,
        public.studio_next_schedule_due(clock_timestamp(),s.interval_hours,s.daily_time,s.time_zone),'enabled')
      on conflict(location_id,schedule_id) do update set version=studio_schedule_recurring.version+1,
        actor_app=excluded.actor_app,authorized_by=excluded.authorized_by,schedule_version=excluded.schedule_version,
        selection=excluded.selection,snapshot=excluded.snapshot,enabled=true,activation_token=gen_random_uuid(),
        next_run_at=excluded.next_run_at,last_outcome='enabled',updated_at=clock_timestamp() returning * into r;
  else
    if r.schedule_id is null then raise exception 'No activation to pause' using errcode='40001'; end if;
    update public.studio_schedule_recurring set enabled=false,next_run_at=null,version=version+1,last_outcome='paused',updated_at=clock_timestamp()
      where location_id=p_location_id and schedule_id=p_schedule_id returning * into r;
  end if;
  result:=jsonb_build_object('enabled',r.enabled,'stateVersion',r.version,'nextRunAt',r.next_run_at);
  insert into public.studio_schedule_commands(location_id,request_id,request,result,snapshot) values(p_location_id,p_request_id,command,result,v_snapshot);
  return result;
end; $$;
revoke all on function public.studio_set_schedule_recurring(text,text,text,uuid,bigint,bigint,uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.studio_set_schedule_recurring(text,text,text,uuid,bigint,bigint,uuid,text,jsonb,boolean) to service_role;

-- Definition edits invalidate consent atomically, including imported updates.
create function public.studio_pause_edited_schedule() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.studio_schedule_recurring set enabled=false,next_run_at=null,version=version+1,last_outcome='definition_changed',updated_at=clock_timestamp()
    where location_id=new.location_id and schedule_id=new.id and enabled;
  return new;
end; $$;
revoke all on function public.studio_pause_edited_schedule() from public,anon,authenticated,service_role;
create trigger studio_schedule_definition_changed after update on public.studio_schedules for each row execute function public.studio_pause_edited_schedule();

create function public.studio_dispatch_schedule(p_location_id text,p_schedule_id uuid,p_activation_token uuid,p_due_at timestamptz,p_estio_authorized boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.studio_schedules%rowtype; r public.studio_schedule_recurring%rowtype;
  v_snapshot jsonb; outcome text; result jsonb; v_execution uuid; v_authorized boolean:=true; v_workflow text;
begin
  -- Match membership->definition->activation lock order with interactive commands.
  select * into r from public.studio_schedule_recurring where location_id=p_location_id and schedule_id=p_schedule_id;
  if not found or r.activation_token is distinct from p_activation_token then return '{"outcome":"not_due"}'; end if;
  begin
    perform public.studio_lock_location_member(p_location_id,r.actor_app,r.authorized_by);
  exception when insufficient_privilege then v_authorized:=false;
  end;
  if r.actor_app='estio' and p_estio_authorized is distinct from true then v_authorized:=false; end if;
  select * into s from public.studio_schedules where location_id=p_location_id and id=p_schedule_id for update;
  select * into r from public.studio_schedule_recurring where location_id=p_location_id and schedule_id=p_schedule_id for update;
  if not r.enabled or r.activation_token is distinct from p_activation_token or r.next_run_at is distinct from p_due_at
    or r.next_run_at>clock_timestamp() then return '{"outcome":"not_due"}'; end if;
  if not v_authorized then outcome:='authority_revoked';
  elsif s.version<>r.schedule_version then outcome:='inputs_changed';
  elsif exists(select 1 from public.studio_schedule_executions e join public.studio_ai_attempts a on a.job_id=e.job_id
    where e.location_id=p_location_id and e.schedule_id=p_schedule_id and a.status in ('started','uncertain') and not a.replacement_authorized
      and not exists(select 1 from public.studio_jobs j where j.id=e.job_id and j.status in ('queued','running'))) then outcome:='charge_review_required';
  elsif exists(select 1 from public.studio_schedule_executions e join public.studio_jobs j on j.id=e.job_id
    where e.location_id=p_location_id and e.schedule_id=p_schedule_id and j.status in ('queued','running')) then outcome:='busy';
  else
    v_workflow:=case when s.preset_id='idea-review' then 'idea_review' else 'script_brief' end;
    begin
      begin
        v_snapshot:=public.studio_build_selected_text_snapshot(p_location_id,r.selection,s.focus,v_workflow);
      exception when serialization_failure or invalid_parameter_value then outcome:='inputs_changed'; end;
      if outcome='inputs_changed' or v_snapshot is distinct from r.snapshot then outcome:='inputs_changed';
      else
        result:=public.studio_run_schedule_now(p_location_id,r.actor_app,r.authorized_by,p_schedule_id,s.version,gen_random_uuid(),r.selection,true);
        v_execution:=(result->>'executionId')::uuid;
        update public.studio_schedule_executions set activation_token=r.activation_token,due_at=p_due_at where id=v_execution;
        outcome:='queued';
      end if;
    exception when serialization_failure then outcome:='busy'; when invalid_parameter_value then outcome:='inputs_changed';
    end;
  end if;
  update public.studio_schedule_recurring set
    enabled=outcome in ('queued','busy'),next_run_at=case when outcome in ('queued','busy') then public.studio_next_schedule_due(clock_timestamp(),s.interval_hours,s.daily_time,s.time_zone) else null end,
    last_outcome=outcome,version=version+case when outcome in ('queued','busy') then 0 else 1 end,updated_at=clock_timestamp()
    where location_id=p_location_id and schedule_id=p_schedule_id;
  insert into public.studio_schedule_ticks(location_id,schedule_id,activation_token,due_at,outcome,execution_id) values(p_location_id,p_schedule_id,r.activation_token,p_due_at,outcome,v_execution);
  return jsonb_build_object('outcome',outcome,'executionId',v_execution);
end; $$;
revoke all on function public.studio_dispatch_schedule(text,uuid,uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.studio_dispatch_schedule(text,uuid,uuid,timestamptz,boolean) to service_role;

-- Fence queued recurring jobs immediately before reserving spend. Pausing cannot
-- undo an already authorized/in-flight provider request.
create or replace function public.studio_begin_text_run_attempt(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.studio_schedule_executions%rowtype; r public.studio_schedule_recurring%rowtype; s public.studio_schedules%rowtype; fresh jsonb;
  j public.studio_jobs%rowtype; a uuid; u uuid; billing text; v_workflow text;
begin
  select * into e from public.studio_schedule_executions where location_id=p_location_id and job_id=p_job_id and activation_token is not null;
  if found then
    begin
      perform public.studio_lock_location_member(p_location_id,e.actor_app,e.created_by_clerk_user_id);
    exception when insufficient_privilege then return '{"outcome":"schedule_inactive"}'; end;
    select * into s from public.studio_schedules where location_id=p_location_id and id=e.schedule_id for share;
    select * into r from public.studio_schedule_recurring where location_id=p_location_id and schedule_id=e.schedule_id for share;
    if not r.enabled or r.activation_token is distinct from e.activation_token or r.schedule_version<>s.version then return '{"outcome":"schedule_inactive"}'; end if;
    begin fresh:=public.studio_build_selected_text_snapshot(p_location_id,r.selection,s.focus,e.workflow);
      if fresh is distinct from r.snapshot then return '{"outcome":"schedule_inactive"}'; end if;
    exception when serialization_failure or invalid_parameter_value then return '{"outcome":"schedule_inactive"}'; end;
  end if;
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
revoke all on function public.studio_begin_text_run_attempt(text,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.studio_begin_text_run_attempt(text,uuid,uuid,text,uuid) to service_role;
create or replace function public.studio_run_schedule_now(p_location_id text,p_actor_app text,p_clerk_user_id text,
  p_schedule_id uuid,p_expected_version bigint,p_request_id uuid,p_selection jsonb,p_confirm_paid boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.studio_schedules%rowtype; prior public.studio_schedule_executions%rowtype;
  v_request jsonb; v_workflow text; v_result jsonb; v_execution uuid := gen_random_uuid();
begin
  perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  if p_schedule_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
    or p_confirm_paid is distinct from true or p_selection is null or jsonb_typeof(p_selection)<>'array'
    or jsonb_array_length(p_selection) not between 1 and 5 then
    raise exception 'Select current ideas and explicitly authorize this paid run' using errcode='22023'; end if;
  -- Shared across schedules so one request UUID cannot race into two ledgers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('schedule-command:'||p_location_id::text||':'||p_request_id::text,0));
  v_request := jsonb_build_object('scheduleId',p_schedule_id,'version',p_expected_version,'selection',p_selection,
    'actor',p_clerk_user_id,'app',p_actor_app);
  if exists(select 1 from public.studio_schedule_commands where location_id=p_location_id and request_id=p_request_id) then raise exception 'Activation request reused' using errcode='23505'; end if;
  select * into prior from public.studio_schedule_executions where location_id=p_location_id and request_id=p_request_id;
  if found then
    if prior.request is distinct from v_request then raise exception 'Schedule request reused' using errcode='23505'; end if;
    return jsonb_build_object('executionId',prior.id,'reviewId',prior.review_id,'jobId',prior.job_id,'workflow',prior.workflow);
  end if;
  -- Serializes different request IDs with one another and with draft edits.
  select * into s from public.studio_schedules where location_id=p_location_id and id=p_schedule_id for update;
  if s.id is null or s.version<>p_expected_version then raise exception 'Schedule changed; reload' using errcode='40001'; end if;
  if s.preset_id not in ('idea-review','script-brief') then
    raise exception 'Scheduled YouTube discovery needs a separately selected personal grant' using errcode='22023'; end if;
  if exists(select 1 from public.studio_schedule_executions e join public.studio_jobs j on j.id=e.job_id
      where e.location_id=p_location_id and e.schedule_id=p_schedule_id and j.status in ('queued','running'))
    or exists(select 1 from public.studio_schedule_executions e join public.studio_ai_attempts a on a.job_id=e.job_id
      where e.location_id=p_location_id and e.schedule_id=p_schedule_id and a.status in ('started','uncertain') and not a.replacement_authorized) then
    raise exception 'A schedule run is active or needs charge reconciliation; use its existing job' using errcode='40001'; end if;
  v_workflow := case when s.preset_id='idea-review' then 'idea_review' else 'script_brief' end;
  -- A private child request UUID prevents cross-feature command identity reuse.
  -- Existing enqueue owns current version/stage/source validation and snapshots.
  v_result := public.studio_enqueue_text_run(p_location_id,p_actor_app,p_clerk_user_id,gen_random_uuid(),p_selection,s.focus,true,v_workflow);
  insert into public.studio_schedule_executions(id,location_id,schedule_id,request_id,actor_app,created_by_clerk_user_id,
    request,definition,workflow,review_id,job_id) values(v_execution,p_location_id,p_schedule_id,p_request_id,p_actor_app,p_clerk_user_id,
    v_request,jsonb_build_object('version',s.version,'presetId',s.preset_id,'focus',s.focus,'intervalHours',s.interval_hours,
      'dailyTime',s.daily_time,'timeZone',s.time_zone),v_workflow,(v_result->>'reviewId')::uuid,(v_result->>'jobId')::uuid);
  return v_result||jsonb_build_object('executionId',v_execution,'workflow',v_workflow);
end; $$;
commit;
