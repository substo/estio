-- Manual one-off YouTube discovery ("Run now"). Reuses the existing run/job
-- tables and worker handler; it never enables recurrence. The run row pins its
-- own source, profile grant and definition version instead of the recurring
-- authorization row.
begin;
alter table public.studio_youtube_schedule_runs
 add column manual boolean not null default false,
 add column source_mode text check(source_mode in ('approved_channel','search','subscription')),
 add column channel_id text,
 add column title_prefix text check(title_prefix is null or char_length(title_prefix) between 1 and 100),
 add column connection_version uuid,
 add column schedule_version bigint,
 add constraint studio_youtube_run_manual_source check(not manual
  or (source_mode is null and channel_id is null and title_prefix is null and connection_version is null and schedule_version is null)
  or (source_mode is not null and channel_id is not null
  and title_prefix is not null and connection_version is not null and schedule_version is not null
  and ((source_mode='search' and channel_id='') or (source_mode<>'search' and channel_id ~ '^UC[A-Za-z0-9_-]{22}$'))));

-- One source reader for both run kinds. Recurring runs keep their existing
-- consent checks; manual runs recheck membership, definition, grant and channel.
create function public.studio_lock_youtube_source(p_location text,p_run uuid)
returns public.platform_youtube_schedule_authorizations language plpgsql security definer set search_path='' as $$
declare run public.studio_youtube_schedule_runs%rowtype; g public.platform_youtube_schedule_authorizations%rowtype; s public.studio_schedules%rowtype;
begin
 select * into run from public.studio_youtube_schedule_runs where location_id=p_location and id=p_run;
 if run.id is null then raise exception 'Discovery run missing' using errcode='22023'; end if;
 if not run.manual then return public.studio_lock_youtube_schedule(p_location,run.schedule_id,run.activation_token); end if;
 if run.connection_version is null then raise exception 'Manual source authorization removed' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||run.actor_app||':'||run.created_by_clerk_user_id,0));
 select * into run from public.studio_youtube_schedule_runs where location_id=p_location and id=p_run;
 if run.connection_version is null then raise exception 'Manual source authorization removed' using errcode='42501'; end if;
 perform public.studio_lock_location_member(p_location,run.actor_app,run.created_by_clerk_user_id);
 select * into s from public.studio_schedules where location_id=p_location and id=run.schedule_id for share;
 if s.id is null or s.version<>run.schedule_version or s.preset_id<>'youtube-discovery' then raise exception 'Discovery definition changed' using errcode='42501'; end if;
 perform 1 from public.platform_google_youtube_connections where app=run.actor_app and clerk_user_id=run.created_by_clerk_user_id
 and version=run.connection_version and 'https://www.googleapis.com/auth/youtube.readonly'=any(granted_scopes) for share;
 if not found then raise exception 'Profile grant changed' using errcode='42501'; end if;
 if run.source_mode='approved_channel' then
  perform 1 from public.studio_youtube_channels where location_id=p_location and channel_id=run.channel_id for share;
  if not found then raise exception 'Channel approval removed' using errcode='42501'; end if;
 end if;
 g.location_id:=p_location; g.schedule_id:=run.schedule_id; g.app:=run.actor_app; g.clerk_user_id:=run.created_by_clerk_user_id;
 g.connection_version:=run.connection_version; g.activation_token:=run.activation_token; g.source_mode:=run.source_mode;
 g.channel_id:=run.channel_id; g.title_prefix:=run.title_prefix; g.expires_at:=run.created_at+interval '1 day';
 return g;
end; $$;
revoke all on function public.studio_lock_youtube_source(text,uuid) from public,anon,authenticated,service_role;

create or replace function public.studio_lock_youtube_run(p_location text,p_run uuid,p_job uuid,p_worker text,p_lease uuid)
returns public.studio_youtube_schedule_runs language plpgsql security definer set search_path='' as $$
declare run public.studio_youtube_schedule_runs%rowtype; j public.studio_jobs%rowtype;
begin
 select * into run from public.studio_youtube_schedule_runs where location_id=p_location and id=p_run and job_id=p_job;
 if run.id is null then raise exception 'Discovery run missing' using errcode='22023'; end if;
 perform public.studio_lock_youtube_source(p_location,p_run);
 select * into j from public.studio_jobs where location_id=p_location and id=p_job for update;
 if j.kind<>'studio.youtube_discovery' or j.payload->>'discoveryRunId' is distinct from p_run::text or j.status<>'running'
 or j.lease_owner is distinct from p_worker or j.lease_token is distinct from p_lease or j.lease_expires_at<=clock_timestamp() then
 raise exception 'Current discovery lease required' using errcode='40001'; end if;
 return run;
end; $$;

create or replace function public.studio_begin_youtube_discovery(p_location text,p_run uuid,p_job uuid,p_worker text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.studio_youtube_schedule_runs%rowtype; g public.platform_youtube_schedule_authorizations%rowtype; s public.studio_schedules%rowtype;
begin
 run:=public.studio_lock_youtube_run(p_location,p_run,p_job,p_worker,p_lease);
 if run.result is not null then return jsonb_build_object('outcome','saved','result',run.result); end if;
 if run.slot_lease_token is distinct from p_lease then
  if not public.studio_youtube_request_slot(p_location,run.actor_app,run.created_by_clerk_user_id) then return '{"outcome":"quota"}'; end if;
  update public.studio_youtube_schedule_runs set slot_lease_token=p_lease where id=p_run;
 end if;
 g:=public.studio_lock_youtube_source(p_location,p_run);
 select * into s from public.studio_schedules where location_id=p_location and id=run.schedule_id;
 return jsonb_build_object('outcome','ready','app',g.app,'userId',g.clerk_user_id,'connectionVersion',g.connection_version,
 'source',g.source_mode,'channelId',g.channel_id,'query',s.focus);
end; $$;

create or replace function public.studio_finish_youtube_discovery(p_location text,p_run uuid,p_job uuid,p_worker text,p_lease uuid,p_videos jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.studio_youtube_schedule_runs%rowtype; g public.platform_youtube_schedule_authorizations%rowtype; video text; record_id uuid;
 v_result jsonb:='[]'; was_existing boolean; observed timestamptz:=clock_timestamp();
begin
 run:=public.studio_lock_youtube_run(p_location,p_run,p_job,p_worker,p_lease);
 if run.result is not null then return run.result; end if;
 if run.slot_lease_token is distinct from p_lease or p_videos is null or jsonb_typeof(p_videos)<>'array' or jsonb_array_length(p_videos)>10
 or exists(select 1 from jsonb_array_elements(p_videos) v where jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[A-Za-z0-9_-]{11}$')
 or (select count(distinct v) from jsonb_array_elements_text(p_videos) v)<>jsonb_array_length(p_videos) then raise exception 'Bounded public video IDs required' using errcode='22023'; end if;
 g:=public.studio_lock_youtube_source(p_location,p_run);
 -- The existing bookmark RPC serializes per location and preserves all existing edits.
 perform public.studio_lock_youtube_member(p_location,g.app,g.clerk_user_id);
 for video in select value from jsonb_array_elements_text(p_videos) loop
  was_existing:=exists(select 1 from public.studio_youtube_bookmarks where location_id=p_location and video_id=video)
   or exists(select 1 from public.studio_records where location_id=p_location and kind='reference' and source_url='https://www.youtube.com/watch?v='||video);
  record_id:=public.studio_save_youtube_bookmark(p_location,g.app,g.clerk_user_id,gen_random_uuid(),video,g.title_prefix||' · '||video,
   jsonb_build_object('kind','saved_url','origin',case when run.manual then 'manual_discovery' else 'scheduled_discovery' end,'runId',p_run,'observedAt',observed,'provider','youtube_data_api','rights','research_link_only'));
  v_result:=v_result||jsonb_build_array(jsonb_build_object('videoId',video,'recordId',record_id,'reused',was_existing));
 end loop;
 v_result:=jsonb_build_object('links',v_result,'observedAt',observed);
 update public.studio_youtube_schedule_runs set result=v_result,completed_at=clock_timestamp() where id=p_run;
 return v_result;
end; $$;

-- Preserve the existing disconnect/reconnect/account-deletion privacy cleanup.
create or replace function public.platform_invalidate_youtube_schedules() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.studio_schedule_recurring r set enabled=false,next_run_at=null,version=version+1,last_outcome='profile_grant_changed',updated_at=clock_timestamp()
 from public.platform_youtube_schedule_authorizations g where r.location_id=g.location_id and r.schedule_id=g.schedule_id and r.activation_token=g.activation_token
 and g.app=old.app and g.clerk_user_id=old.clerk_user_id and r.enabled;
 delete from public.platform_youtube_schedule_authorizations where app=old.app and clerk_user_id=old.clerk_user_id;
 update public.studio_youtube_schedule_runs set source_mode=null,channel_id=null,title_prefix=null,connection_version=null,schedule_version=null
 where manual and actor_app=old.app and created_by_clerk_user_id=old.clerk_user_id and connection_version is not null;
 return old;
end; $$;

create function public.studio_run_youtube_schedule_now(p_location text,p_app text,p_user text,p_schedule uuid,p_version bigint,
 p_request uuid,p_connection_version uuid,p_source text,p_channel text,p_title text,p_confirm_share boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.studio_schedules%rowtype; prior public.studio_schedule_executions%rowtype; request jsonb;
 run uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid(); j public.studio_jobs%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('platform-youtube:'||p_app||':'||p_user,0));
 perform public.studio_lock_location_member(p_location,p_app,p_user);
 if p_schedule is null or p_version is null or p_version<1 or p_request is null
 or p_connection_version is null or p_source is null or p_source not in ('approved_channel','search','subscription')
 or p_channel is null or (p_source='search' and p_channel<>'') or (p_source<>'search' and p_channel !~ '^UC[A-Za-z0-9_-]{22}$')
 or p_title is null or char_length(btrim(p_title)) not between 1 and 100 or p_title ~ '[[:cntrl:]]' or p_confirm_share is distinct from true then
 raise exception 'Explicit profile-bound link sharing consent required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('schedule-command:'||p_location::text||':'||p_request::text,0));
 -- Like activation, the audit keeps only a digest of the private source choice.
 request:=jsonb_build_object('action','run_youtube_now','actor',p_user,'app',p_app,'scheduleId',p_schedule,'version',p_version,
 'connectionVersion',p_connection_version,'sourceDigest',encode(sha256(convert_to(jsonb_build_array(p_source,p_channel,btrim(p_title))::text,'UTF8')),'hex'));
 if exists(select 1 from public.studio_schedule_commands where location_id=p_location and request_id=p_request) then raise exception 'Request reused' using errcode='23505'; end if;
 select * into prior from public.studio_schedule_executions where location_id=p_location and request_id=p_request;
 if found then
  if prior.request is distinct from request then raise exception 'Run request reused' using errcode='23505'; end if;
  return jsonb_build_object('executionId',prior.id,'discoveryRunId',prior.youtube_run_id,'jobId',prior.job_id,'workflow',prior.workflow);
 end if;
 perform 1 from public.platform_google_youtube_connections where app=p_app and clerk_user_id=p_user and version=p_connection_version
 and 'https://www.googleapis.com/auth/youtube.readonly'=any(granted_scopes) for share;
 if not found then raise exception 'Current profile grant required' using errcode='42501'; end if;
 select * into s from public.studio_schedules where location_id=p_location and id=p_schedule for update;
 if s.id is null or s.version<>p_version or s.preset_id<>'youtube-discovery' then raise exception 'YouTube definition changed' using errcode='40001'; end if;
 if p_source='search' and btrim(s.focus)='' then raise exception 'Save a public search focus first' using errcode='22023'; end if;
 if p_source='approved_channel' then
  perform 1 from public.studio_youtube_channels where location_id=p_location and channel_id=p_channel for share;
  if not found then raise exception 'Channel not approved' using errcode='42501'; end if;
 end if;
 if exists(select 1 from public.studio_schedule_executions e join public.studio_jobs x on x.id=e.job_id
  where e.location_id=p_location and e.schedule_id=p_schedule and x.status in ('queued','running')) then
  raise exception 'A run for this schedule is already queued or running' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended('youtube-schedule-enqueue:'||p_location::text,0));
 if (select count(*) from public.studio_jobs where location_id=p_location and kind='studio.youtube_discovery' and status in ('queued','running'))>=5 then raise exception 'Too many active discovery runs' using errcode='40001'; end if;
 j:=public.studio_enqueue_job(p_location,'studio.youtube_discovery',jsonb_build_object('discoveryRunId',run),'youtube-discovery:'||run::text,p_user,3);
 insert into public.studio_youtube_schedule_runs(id,location_id,schedule_id,activation_token,job_id,actor_app,created_by_clerk_user_id,
  manual,source_mode,channel_id,title_prefix,connection_version,schedule_version)
 values(run,p_location,p_schedule,gen_random_uuid(),j.id,p_app,p_user,true,p_source,p_channel,btrim(p_title),p_connection_version,s.version);
 insert into public.studio_schedule_executions(id,location_id,schedule_id,request_id,actor_app,created_by_clerk_user_id,request,definition,workflow,youtube_run_id,job_id)
 values(execution,p_location,p_schedule,p_request,p_app,p_user,request,
 jsonb_build_object('version',s.version,'presetId',s.preset_id,'focus',s.focus,'intervalHours',s.interval_hours,'dailyTime',s.daily_time,'timeZone',s.time_zone),'youtube_discovery',run,j.id);
 return jsonb_build_object('executionId',execution,'discoveryRunId',run,'jobId',j.id,'workflow','youtube_discovery');
end; $$;
revoke all on function public.studio_run_youtube_schedule_now(text,text,text,uuid,bigint,uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.studio_run_youtube_schedule_now(text,text,text,uuid,bigint,uuid,uuid,text,text,text,boolean) to service_role;
commit;
