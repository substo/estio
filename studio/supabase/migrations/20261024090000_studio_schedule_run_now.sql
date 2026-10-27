-- Manual hosted execution only. Draft saves/imports remain inactive.
begin;
create table public.studio_schedule_executions (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  schedule_id uuid not null,
  request_id uuid not null,
  actor_app text not null check (actor_app in ('estio','substo')),
  created_by_clerk_user_id text not null,
  request jsonb not null,
  definition jsonb not null,
  workflow text not null check (workflow in ('idea_review','script_brief')),
  review_id uuid not null unique references public.studio_idea_reviews(id),
  job_id uuid not null unique references public.studio_jobs(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (location_id,schedule_id) references public.studio_schedules(location_id,id),
  unique (location_id,request_id)
);
create index studio_schedule_execution_history_idx on public.studio_schedule_executions(location_id,schedule_id,created_at desc,id);
alter table public.studio_schedule_executions enable row level security;
revoke all on public.studio_schedule_executions from public,anon,authenticated,service_role;
grant select on public.studio_schedule_executions to service_role;

create function public.studio_run_schedule_now(p_location_id text,p_actor_app text,p_clerk_user_id text,
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
revoke all on function public.studio_run_schedule_now(text,text,text,uuid,bigint,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.studio_run_schedule_now(text,text,text,uuid,bigint,uuid,jsonb,boolean) to service_role;
commit;
