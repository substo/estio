begin;
-- Private per-profile authorization, never exposed by workspace state readers.
create table public.platform_youtube_schedule_authorizations (
 workspace_id uuid not null,schedule_id uuid not null,brand text not null,clerk_user_id text not null,
 connection_version uuid not null,activation_token uuid not null,
 source_mode text not null check(source_mode in ('approved_channel','search','subscription')),
 channel_id text not null, title_prefix text not null check(char_length(title_prefix) between 1 and 100),
 expires_at timestamptz not null default(clock_timestamp()+interval '30 days'),
 primary key(workspace_id,schedule_id),
 foreign key(workspace_id,schedule_id) references public.studio_schedules(workspace_id,id),
 check((source_mode='search' and channel_id='') or (source_mode<>'search' and channel_id ~ '^UC[A-Za-z0-9_-]{22}$'))
);
create table public.studio_youtube_schedule_runs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,schedule_id uuid not null,
 activation_token uuid not null,job_id uuid not null unique references public.studio_jobs(id),
 actor_brand text not null,created_by_clerk_user_id text not null,
 result jsonb,created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 foreign key(workspace_id,schedule_id) references public.studio_schedules(workspace_id,id)
);
alter table public.studio_schedule_executions alter column review_id drop not null;
alter table public.studio_schedule_executions add column youtube_run_id uuid unique references public.studio_youtube_schedule_runs(id);
alter table public.studio_schedule_executions drop constraint studio_schedule_executions_workflow_check;
alter table public.studio_schedule_executions add constraint studio_schedule_execution_subject check(
 (workflow in ('idea_review','script_brief') and review_id is not null and youtube_run_id is null) or
 (workflow='youtube_discovery' and review_id is null and youtube_run_id is not null));
alter table public.platform_youtube_schedule_authorizations enable row level security;
alter table public.studio_youtube_schedule_runs enable row level security;
revoke all on public.platform_youtube_schedule_authorizations,public.studio_youtube_schedule_runs from public,anon,authenticated,service_role;
grant select on public.platform_youtube_schedule_authorizations,public.studio_youtube_schedule_runs to service_role;

create function public.studio_enable_youtube_schedule(p_workspace uuid,p_brand text,p_user text,p_schedule uuid,p_version bigint,
 p_state_version bigint,p_request uuid,p_connection_version uuid,p_source text,p_channel text,p_title text,p_confirm_share boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.studio_schedules%rowtype; r public.studio_schedule_recurring%rowtype;
 request jsonb; prior public.studio_schedule_commands%rowtype; result jsonb; snapshot jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||p_brand||':'||p_user,0));
 perform public.studio_lock_workspace_member(p_workspace,p_brand,p_user);
 if p_schedule is null or p_version is null or p_version<1 or p_state_version is null or p_state_version<0 or p_request is null
 or p_connection_version is null or p_source is null or p_source not in ('approved_channel','search','subscription')
 or p_channel is null or (p_source='search' and p_channel<>'') or (p_source<>'search' and p_channel !~ '^UC[A-Za-z0-9_-]{22}$')
 or p_title is null or char_length(btrim(p_title)) not between 1 and 100 or p_title ~ '[[:cntrl:]]' or p_confirm_share is distinct from true then
 raise exception 'Explicit profile-bound recurring sharing consent required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('schedule-command:'||p_workspace::text||':'||p_request::text,0));
 request:=jsonb_build_object('action','enable_youtube','actor',p_user,'brand',p_brand,'scheduleId',p_schedule,'version',p_version,'stateVersion',p_state_version,
 'connectionVersion',p_connection_version,'sourceDigest',encode(sha256(convert_to(jsonb_build_array(p_source,p_channel,p_title)::text,'UTF8')),'hex'));
 select * into prior from public.studio_schedule_commands where workspace_id=p_workspace and request_id=p_request;
 if found then
  if prior.request is distinct from request then raise exception 'Request reused' using errcode='23505'; end if;
  return prior.result;
 end if;
 if exists(select 1 from public.studio_schedule_executions where workspace_id=p_workspace and request_id=p_request) then raise exception 'Run request reused' using errcode='23505'; end if;
 perform 1 from public.platform_google_youtube_connections where brand=p_brand and clerk_user_id=p_user and version=p_connection_version
 and 'https://www.googleapis.com/auth/youtube.readonly'=any(granted_scopes) for share;
 if not found then raise exception 'Current profile grant required' using errcode='42501'; end if;
 select * into s from public.studio_schedules where workspace_id=p_workspace and id=p_schedule for update;
 if s.id is null or s.version<>p_version or s.preset_id<>'youtube-discovery' then raise exception 'YouTube definition changed' using errcode='40001'; end if;
 if p_source='search' and btrim(s.focus)='' then raise exception 'Save a public search focus first' using errcode='22023'; end if;
 if p_source='approved_channel' then
  perform 1 from public.studio_youtube_channels where workspace_id=p_workspace and channel_id=p_channel for share;
  if not found then raise exception 'Channel not approved' using errcode='42501'; end if;
 end if;
 select * into r from public.studio_schedule_recurring where workspace_id=p_workspace and schedule_id=p_schedule for update;
 if coalesce(r.version,0)<>p_state_version then raise exception 'Activation changed' using errcode='40001'; end if;
 snapshot:=jsonb_build_object('workflow','youtube_discovery','maxLinks',10,'rights','research_link_only','titlePrefix',btrim(p_title));
 insert into public.studio_schedule_recurring(workspace_id,schedule_id,actor_brand,authorized_by,schedule_version,selection,snapshot,enabled,next_run_at,last_outcome)
 values(p_workspace,p_schedule,p_brand,p_user,s.version,'[]',snapshot,true,public.studio_next_schedule_due(clock_timestamp(),s.interval_hours,s.daily_time,s.time_zone),'enabled')
 on conflict(workspace_id,schedule_id) do update set version=studio_schedule_recurring.version+1,actor_brand=excluded.actor_brand,authorized_by=excluded.authorized_by,
 schedule_version=excluded.schedule_version,selection='[]',snapshot=excluded.snapshot,enabled=true,activation_token=gen_random_uuid(),next_run_at=excluded.next_run_at,last_outcome='enabled',updated_at=clock_timestamp() returning * into r;
 insert into public.platform_youtube_schedule_authorizations(workspace_id,schedule_id,brand,clerk_user_id,connection_version,activation_token,source_mode,channel_id,title_prefix)
 values(p_workspace,p_schedule,p_brand,p_user,p_connection_version,r.activation_token,p_source,p_channel,btrim(p_title))
 on conflict(workspace_id,schedule_id) do update set brand=excluded.brand,clerk_user_id=excluded.clerk_user_id,connection_version=excluded.connection_version,
 activation_token=excluded.activation_token,source_mode=excluded.source_mode,channel_id=excluded.channel_id,title_prefix=excluded.title_prefix,expires_at=clock_timestamp()+interval '30 days';
 result:=jsonb_build_object('enabled',true,'stateVersion',r.version,'nextRunAt',r.next_run_at);
 insert into public.studio_schedule_commands(workspace_id,request_id,request,result,snapshot) values(p_workspace,p_request,request,result,snapshot);
 return result;
end; $$;
revoke all on function public.studio_enable_youtube_schedule(uuid,text,text,uuid,bigint,bigint,uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.studio_enable_youtube_schedule(uuid,text,text,uuid,bigint,bigint,uuid,uuid,text,text,text,boolean) to service_role;

create function public.studio_lock_youtube_schedule(p_workspace uuid,p_schedule uuid,p_token uuid)
returns public.platform_youtube_schedule_authorizations language plpgsql security definer set search_path='' as $$
declare g public.platform_youtube_schedule_authorizations%rowtype; r public.studio_schedule_recurring%rowtype; s public.studio_schedules%rowtype;
begin
 select * into g from public.platform_youtube_schedule_authorizations where workspace_id=p_workspace and schedule_id=p_schedule;
 if g.schedule_id is null or g.activation_token is distinct from p_token then raise exception 'Profile authorization unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||g.brand||':'||g.clerk_user_id,0));
 perform public.studio_lock_workspace_member(p_workspace,g.brand,g.clerk_user_id);
 select * into s from public.studio_schedules where workspace_id=p_workspace and id=p_schedule for share;
 select * into r from public.studio_schedule_recurring where workspace_id=p_workspace and schedule_id=p_schedule for share;
 select * into g from public.platform_youtube_schedule_authorizations where workspace_id=p_workspace and schedule_id=p_schedule for share;
 if g.schedule_id is null or not r.enabled or r.activation_token is distinct from p_token or g.activation_token is distinct from p_token
 or g.brand is distinct from r.actor_brand or g.clerk_user_id is distinct from r.authorized_by or g.expires_at<=clock_timestamp()
 or r.schedule_version<>s.version or s.preset_id<>'youtube-discovery' then raise exception 'Discovery consent changed' using errcode='42501'; end if;
 perform 1 from public.platform_google_youtube_connections where brand=g.brand and clerk_user_id=g.clerk_user_id and version=g.connection_version
 and 'https://www.googleapis.com/auth/youtube.readonly'=any(granted_scopes) for share;
 if not found then raise exception 'Profile grant changed' using errcode='42501'; end if;
 if g.source_mode='approved_channel' then
  perform 1 from public.studio_youtube_channels where workspace_id=p_workspace and channel_id=g.channel_id for share;
  if not found then raise exception 'Channel approval removed' using errcode='42501'; end if;
 end if;
 return g;
end; $$;
revoke all on function public.studio_lock_youtube_schedule(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.platform_invalidate_youtube_schedules() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.studio_schedule_recurring r set enabled=false,next_run_at=null,version=version+1,last_outcome='profile_grant_changed',updated_at=clock_timestamp()
 from public.platform_youtube_schedule_authorizations g where r.workspace_id=g.workspace_id and r.schedule_id=g.schedule_id and r.activation_token=g.activation_token
 and g.brand=old.brand and g.clerk_user_id=old.clerk_user_id and r.enabled;
 delete from public.platform_youtube_schedule_authorizations where brand=old.brand and clerk_user_id=old.clerk_user_id;
 return old;
end; $$;
revoke all on function public.platform_invalidate_youtube_schedules() from public,anon,authenticated,service_role;
create trigger platform_youtube_schedules_invalidated after update or delete on public.platform_google_youtube_connections for each row execute function public.platform_invalidate_youtube_schedules();

create function public.studio_prune_youtube_schedule_authorizations() returns integer language plpgsql security definer set search_path='' as $$
declare g record; n integer:=0;
begin
 for g in select * from public.platform_youtube_schedule_authorizations where expires_at<=clock_timestamp() order by brand,clerk_user_id,workspace_id,schedule_id limit 100 loop
  perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||g.brand||':'||g.clerk_user_id,0));
  update public.studio_schedule_recurring set enabled=false,next_run_at=null,version=version+1,last_outcome='authorization_expired',updated_at=clock_timestamp()
  where workspace_id=g.workspace_id and schedule_id=g.schedule_id and activation_token=g.activation_token and enabled;
  delete from public.platform_youtube_schedule_authorizations where workspace_id=g.workspace_id and schedule_id=g.schedule_id and activation_token=g.activation_token and expires_at<=clock_timestamp();
  n:=n+1;
 end loop;
 return n;
end; $$;
revoke all on function public.studio_prune_youtube_schedule_authorizations() from public,anon,authenticated;
grant execute on function public.studio_prune_youtube_schedule_authorizations() to service_role;

-- Enqueue only after the shared dispatcher owns the due occurrence locks.
create function public.studio_enqueue_youtube_schedule(p_workspace uuid,p_schedule uuid,p_token uuid,p_due timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare g public.platform_youtube_schedule_authorizations%rowtype; run uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid(); j public.studio_jobs%rowtype; s public.studio_schedules%rowtype;
begin
 g:=public.studio_lock_youtube_schedule(p_workspace,p_schedule,p_token);
 select * into s from public.studio_schedules where workspace_id=p_workspace and id=p_schedule;
 perform pg_advisory_xact_lock(hashtextextended('youtube-schedule-enqueue:'||p_workspace::text,0));
 if (select count(*) from public.studio_jobs where workspace_id=p_workspace and kind='studio.youtube_discovery' and status in ('queued','running'))>=5 then raise exception 'Too many active discovery runs' using errcode='40001'; end if;
 j:=public.studio_enqueue_job(p_workspace,'studio.youtube_discovery',jsonb_build_object('discoveryRunId',run),'youtube-discovery:'||run::text,g.clerk_user_id,3);
 insert into public.studio_youtube_schedule_runs(id,workspace_id,schedule_id,activation_token,job_id,actor_brand,created_by_clerk_user_id)
 values(run,p_workspace,p_schedule,p_token,j.id,g.brand,g.clerk_user_id);
 insert into public.studio_schedule_executions(id,workspace_id,schedule_id,request_id,actor_brand,created_by_clerk_user_id,request,definition,workflow,youtube_run_id,job_id,activation_token,due_at)
 values(execution,p_workspace,p_schedule,gen_random_uuid(),g.brand,g.clerk_user_id,jsonb_build_object('origin','due_dispatch'),
 jsonb_build_object('version',s.version,'presetId',s.preset_id,'focus',s.focus,'intervalHours',s.interval_hours,'dailyTime',s.daily_time,'timeZone',s.time_zone),'youtube_discovery',run,j.id,p_token,p_due);
 return execution;
end; $$;
revoke all on function public.studio_enqueue_youtube_schedule(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;

alter table public.studio_youtube_schedule_runs add column slot_lease_token uuid;
create function public.studio_lock_youtube_run(p_workspace uuid,p_run uuid,p_job uuid,p_worker text,p_lease uuid)
returns public.studio_youtube_schedule_runs language plpgsql security definer set search_path='' as $$
declare run public.studio_youtube_schedule_runs%rowtype; j public.studio_jobs%rowtype;
begin
 select * into run from public.studio_youtube_schedule_runs where workspace_id=p_workspace and id=p_run and job_id=p_job;
 if run.id is null then raise exception 'Discovery run missing' using errcode='22023'; end if;
 perform public.studio_lock_youtube_schedule(p_workspace,run.schedule_id,run.activation_token);
 select * into j from public.studio_jobs where workspace_id=p_workspace and id=p_job for update;
 if j.kind<>'studio.youtube_discovery' or j.payload->>'discoveryRunId' is distinct from p_run::text or j.status<>'running'
 or j.lease_owner is distinct from p_worker or j.lease_token is distinct from p_lease or j.lease_expires_at<=clock_timestamp() then
 raise exception 'Current discovery lease required' using errcode='40001'; end if;
 return run;
end; $$;
revoke all on function public.studio_lock_youtube_run(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.studio_begin_youtube_discovery(p_workspace uuid,p_run uuid,p_job uuid,p_worker text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.studio_youtube_schedule_runs%rowtype; g public.platform_youtube_schedule_authorizations%rowtype; s public.studio_schedules%rowtype;
begin
 run:=public.studio_lock_youtube_run(p_workspace,p_run,p_job,p_worker,p_lease);
 if run.result is not null then return jsonb_build_object('outcome','saved','result',run.result); end if;
 if run.slot_lease_token is distinct from p_lease then
  if not public.studio_youtube_request_slot(p_workspace,run.actor_brand,run.created_by_clerk_user_id) then return '{"outcome":"quota"}'; end if;
  update public.studio_youtube_schedule_runs set slot_lease_token=p_lease where id=p_run;
 end if;
 select * into g from public.platform_youtube_schedule_authorizations where workspace_id=p_workspace and schedule_id=run.schedule_id;
 select * into s from public.studio_schedules where workspace_id=p_workspace and id=run.schedule_id;
 return jsonb_build_object('outcome','ready','brand',g.brand,'userId',g.clerk_user_id,'connectionVersion',g.connection_version,
 'source',g.source_mode,'channelId',g.channel_id,'query',s.focus);
end; $$;
revoke all on function public.studio_begin_youtube_discovery(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.studio_begin_youtube_discovery(uuid,uuid,uuid,text,uuid) to service_role;
create function public.studio_finish_youtube_discovery(p_workspace uuid,p_run uuid,p_job uuid,p_worker text,p_lease uuid,p_videos jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.studio_youtube_schedule_runs%rowtype; g public.platform_youtube_schedule_authorizations%rowtype; video text; record_id uuid;
 v_result jsonb:='[]'; was_existing boolean; observed timestamptz:=clock_timestamp();
begin
 run:=public.studio_lock_youtube_run(p_workspace,p_run,p_job,p_worker,p_lease);
 if run.result is not null then return run.result; end if;
 if run.slot_lease_token is distinct from p_lease or p_videos is null or jsonb_typeof(p_videos)<>'array' or jsonb_array_length(p_videos)>10
 or exists(select 1 from jsonb_array_elements(p_videos) v where jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[A-Za-z0-9_-]{11}$')
 or (select count(distinct v) from jsonb_array_elements_text(p_videos) v)<>jsonb_array_length(p_videos) then raise exception 'Bounded public video IDs required' using errcode='22023'; end if;
 select * into g from public.platform_youtube_schedule_authorizations where workspace_id=p_workspace and schedule_id=run.schedule_id;
 -- The existing bookmark RPC serializes per workspace and preserves all existing edits.
 perform public.studio_lock_youtube_member(p_workspace,g.brand,g.clerk_user_id);
 for video in select value from jsonb_array_elements_text(p_videos) loop
  was_existing:=exists(select 1 from public.studio_youtube_bookmarks where workspace_id=p_workspace and video_id=video)
   or exists(select 1 from public.studio_records where workspace_id=p_workspace and kind='reference' and source_url='https://www.youtube.com/watch?v='||video);
  record_id:=public.studio_save_youtube_bookmark(p_workspace,g.brand,g.clerk_user_id,gen_random_uuid(),video,g.title_prefix||' · '||video,
   jsonb_build_object('kind','saved_url','origin','scheduled_discovery','runId',p_run,'observedAt',observed,'provider','youtube_data_api','rights','research_link_only'));
  v_result:=v_result||jsonb_build_array(jsonb_build_object('videoId',video,'recordId',record_id,'reused',was_existing));
 end loop;
 v_result:=jsonb_build_object('links',v_result,'observedAt',observed);
 update public.studio_youtube_schedule_runs set result=v_result,completed_at=clock_timestamp() where id=p_run;
 return v_result;
end; $$;
revoke all on function public.studio_finish_youtube_discovery(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_finish_youtube_discovery(uuid,uuid,uuid,text,uuid,jsonb) to service_role;

-- Confirmed grant/source/authority failure pauses only this claim's generation.
create function public.studio_stop_youtube_discovery(p_workspace uuid,p_run uuid,p_job uuid,p_worker text,p_lease uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare run public.studio_youtube_schedule_runs%rowtype; j public.studio_jobs%rowtype;
begin
 select * into run from public.studio_youtube_schedule_runs where workspace_id=p_workspace and id=p_run and job_id=p_job;
 if run.id is null or p_reason is null or p_reason not in ('profile_grant_changed','source_unavailable','authority_revoked') then raise exception 'Invalid stop request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||run.actor_brand||':'||run.created_by_clerk_user_id,0));
 perform 1 from public.studio_schedules where workspace_id=p_workspace and id=run.schedule_id for share;
 perform 1 from public.studio_schedule_recurring where workspace_id=p_workspace and schedule_id=run.schedule_id for update;
 select * into j from public.studio_jobs where id=p_job for update;
 if j.status<>'running' or j.lease_owner is distinct from p_worker or j.lease_token is distinct from p_lease or j.lease_expires_at<=clock_timestamp() then raise exception 'Current lease required' using errcode='40001'; end if;
 update public.studio_schedule_recurring set enabled=false,next_run_at=null,version=version+1,last_outcome=p_reason,updated_at=clock_timestamp()
 where workspace_id=p_workspace and schedule_id=run.schedule_id and activation_token=run.activation_token and enabled;
end; $$;
revoke all on function public.studio_stop_youtube_discovery(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_stop_youtube_discovery(uuid,uuid,uuid,text,uuid,text) to service_role;

create or replace function public.studio_dispatch_schedule(p_workspace_id uuid,p_schedule_id uuid,p_activation_token uuid,p_due_at timestamptz,p_estio_authorized boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.studio_schedules%rowtype; r public.studio_schedule_recurring%rowtype;
  v_snapshot jsonb; outcome text; result jsonb; v_execution uuid; v_authorized boolean:=true; v_workflow text;
begin
  -- Match membership->definition->activation lock order with interactive commands.
  select * into r from public.studio_schedule_recurring where workspace_id=p_workspace_id and schedule_id=p_schedule_id;
  if not found or r.activation_token is distinct from p_activation_token then return '{"outcome":"not_due"}'; end if;
  if r.snapshot->>'workflow'='youtube_discovery' then
    perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||r.actor_brand||':'||r.authorized_by,0));
  end if;
  begin
    perform public.studio_lock_workspace_member(p_workspace_id,r.actor_brand,r.authorized_by);
  exception when insufficient_privilege then v_authorized:=false;
  end;
  if r.actor_brand='estio' and p_estio_authorized is distinct from true then v_authorized:=false; end if;
  select * into s from public.studio_schedules where workspace_id=p_workspace_id and id=p_schedule_id for update;
  select * into r from public.studio_schedule_recurring where workspace_id=p_workspace_id and schedule_id=p_schedule_id for update;
  if not r.enabled or r.activation_token is distinct from p_activation_token or r.next_run_at is distinct from p_due_at
    or r.next_run_at>clock_timestamp() then return '{"outcome":"not_due"}'; end if;
  if not v_authorized then outcome:='authority_revoked';
  elsif s.version<>r.schedule_version then outcome:='inputs_changed';
  elsif exists(select 1 from public.studio_schedule_executions e join public.studio_ai_attempts a on a.job_id=e.job_id
    where e.workspace_id=p_workspace_id and e.schedule_id=p_schedule_id and a.status in ('started','uncertain') and not a.replacement_authorized
      and not exists(select 1 from public.studio_jobs j where j.id=e.job_id and j.status in ('queued','running'))) then outcome:='charge_review_required';
  elsif exists(select 1 from public.studio_schedule_executions e join public.studio_jobs j on j.id=e.job_id
    where e.workspace_id=p_workspace_id and e.schedule_id=p_schedule_id and j.status in ('queued','running')) then outcome:='busy';
  elsif s.preset_id='youtube-discovery' then
    begin
      v_execution:=public.studio_enqueue_youtube_schedule(p_workspace_id,p_schedule_id,r.activation_token,p_due_at);
      outcome:='queued';
    exception when insufficient_privilege or invalid_parameter_value then outcome:='inputs_changed'; when serialization_failure then outcome:='busy'; end;
  else
    v_workflow:=case when s.preset_id='idea-review' then 'idea_review' else 'script_brief' end;
    begin
      begin
        v_snapshot:=public.studio_build_selected_text_snapshot(p_workspace_id,r.selection,s.focus,v_workflow);
      exception when serialization_failure or invalid_parameter_value then outcome:='inputs_changed'; end;
      if outcome='inputs_changed' or v_snapshot is distinct from r.snapshot then outcome:='inputs_changed';
      else
        result:=public.studio_run_schedule_now(p_workspace_id,r.actor_brand,r.authorized_by,p_schedule_id,s.version,gen_random_uuid(),r.selection,true);
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
    where workspace_id=p_workspace_id and schedule_id=p_schedule_id;
  insert into public.studio_schedule_ticks(workspace_id,schedule_id,activation_token,due_at,outcome,execution_id) values(p_workspace_id,p_schedule_id,r.activation_token,p_due_at,outcome,v_execution);
  return jsonb_build_object('outcome',outcome,'executionId',v_execution);
end; $$;
commit;
