do $$
declare w text:='c5100000-0000-4000-8000-000000000001'; s uuid:='c5300000-0000-4000-8000-000000000001'; cv uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); video text:='ccccccccccc'; result jsonb; original jsonb; input jsonb; run uuid; j studio.studio_jobs%rowtype;
begin
 if has_function_privilege('authenticated','studio.studio_run_youtube_schedule_now(text,text,text,uuid,bigint,uuid,uuid,text,text,text,boolean)','EXECUTE')
 or has_function_privilege('service_role','studio.studio_lock_youtube_source(text,uuid)','EXECUTE') then raise exception 'Unsafe manual discovery grants'; end if;
 perform studio.studio_create_substo_location(w,'YouTube run-now fixture','yt-now-owner');
 insert into studio.studio_location_members(location_id,location_app,clerk_user_id,role) values(w,'substo','yt-now-member','member');
 insert into studio.platform_google_youtube_connections(app,clerk_user_id,client_id,refresh_cipher,granted_scopes,version)
 values('substo','yt-now-owner','client','{}',array['https://www.googleapis.com/auth/youtube.readonly'],cv);
 perform studio.studio_save_schedule(w,s,0,'substo','yt-now-owner','youtube-discovery','Public research query',24,'09:00');
 begin perform studio.studio_run_youtube_schedule_now(w,'substo','yt-now-owner',s,1,req,cv,'search','','Label',false);
 raise exception 'Run without sharing consent'; exception when invalid_parameter_value then null; end;
 begin perform studio.studio_run_youtube_schedule_now(w,'substo','yt-now-member',s,1,req,cv,'search','','Label',true);
 raise exception 'Member borrowed owner grant'; exception when insufficient_privilege then null; end;
 original:=studio.studio_run_youtube_schedule_now(w,'substo','yt-now-owner',s,1,req,cv,'search','','Label',true);
 if studio.studio_run_youtube_schedule_now(w,'substo','yt-now-owner',s,1,req,cv,'search','','Label',true)<>original then raise exception 'Manual run replay'; end if;
 if exists(select 1 from studio.studio_schedule_recurring where location_id=w) or exists(select 1 from studio.platform_youtube_schedule_authorizations where location_id=w)
 then raise exception 'Run now enabled recurrence'; end if;
 if (select activation_token from studio.studio_schedule_executions where id=(original->>'executionId')::uuid) is not null then raise exception 'Manual run marked recurring'; end if;
 begin perform studio.studio_run_youtube_schedule_now(w,'substo','yt-now-owner',s,1,gen_random_uuid(),cv,'search','','Label',true);
 raise exception 'Second concurrent manual run'; exception when serialization_failure then null; end;
 run:=(original->>'discoveryRunId')::uuid; j.id:=(original->>'jobId')::uuid;
 perform studio.studio_claim_jobs('yt-now-worker',50,60); select * into j from studio.studio_jobs where id=j.id;
 input:=studio.studio_begin_youtube_discovery(w,run,j.id,'yt-now-worker',j.lease_token);
 if input->>'outcome'<>'ready' or input->>'source'<>'search' or input->>'query'<>'Public research query' or input->>'userId'<>'yt-now-owner' then raise exception 'Manual context %',input; end if;
 result:=studio.studio_finish_youtube_discovery(w,run,j.id,'yt-now-worker',j.lease_token,jsonb_build_array(video));
 if (select title from studio.studio_records where location_id=w and id=(result#>>'{links,0,recordId}')::uuid)<>'Label · '||video then raise exception 'Manual link not saved'; end if;
 perform studio.studio_complete_job(j.id,'yt-now-worker',j.lease_token,'{}');
 -- A definition edit after queuing fences the manual run.
 original:=studio.studio_run_youtube_schedule_now(w,'substo','yt-now-owner',s,1,gen_random_uuid(),cv,'search','','Label',true);
 perform studio.studio_save_schedule(w,s,1,'substo','yt-now-owner','youtube-discovery','Edited query',24,'09:00');
 run:=(original->>'discoveryRunId')::uuid; j.id:=(original->>'jobId')::uuid;
 perform studio.studio_claim_jobs('yt-now-worker',50,60); select * into j from studio.studio_jobs where id=j.id;
 begin perform studio.studio_begin_youtube_discovery(w,run,j.id,'yt-now-worker',j.lease_token);
 raise exception 'Edited definition still ran'; exception when insufficient_privilege then null; end;
end $$;
select 'Studio YouTube run-now assertions passed' as result;

-- Exercise the manual branch with the existing worker RPC contract and caps.
do $$
declare w text:='c6100000-0000-4000-8000-000000000001'; s uuid:=gen_random_uuid(); cv uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); channel text:='UC'||repeat('m',22); original jsonb; r studio.studio_schedule_recurring%rowtype;
 run uuid; j studio.studio_jobs%rowtype; n integer; other uuid;
begin
 perform studio.studio_create_substo_location(w,'Manual discovery boundaries','yt-boundary-owner');
 insert into studio.platform_google_youtube_connections(app,clerk_user_id,client_id,refresh_cipher,granted_scopes,version)
 values('substo','yt-boundary-owner','client','{}',array['https://www.googleapis.com/auth/youtube.readonly'],cv);
 perform studio.studio_save_schedule(w,s,0,'substo','yt-boundary-owner','youtube-discovery','Query',24,'09:00');
 begin
  perform studio.studio_run_youtube_schedule_now(w,'substo','yt-boundary-owner',s,1,req,cv,'approved_channel',channel,'Label',true);
  raise exception 'Unapproved channel accepted'; exception when insufficient_privilege then null;
 end;
 perform studio.studio_youtube_channel(w,'substo','yt-boundary-owner',channel,'Approved channel',false);
 perform studio.studio_enable_youtube_schedule(w,'substo','yt-boundary-owner',s,1,0,gen_random_uuid(),cv,'search','','Recurring label',true);
 select * into r from studio.studio_schedule_recurring where location_id=w and schedule_id=s;
 original:=studio.studio_run_youtube_schedule_now(w,'substo','yt-boundary-owner',s,1,req,cv,'approved_channel',channel,'Manual label',true);
 if (select to_jsonb(x) from studio.studio_schedule_recurring x where location_id=w and schedule_id=s)<>to_jsonb(r)
 then raise exception 'Manual run changed existing recurrence'; end if;
 begin
  perform studio.studio_run_youtube_schedule_now(w,'substo','yt-boundary-owner',s,1,req,cv,'search','','Other label',true);
  raise exception 'Request ID accepted different inputs'; exception when unique_violation then null;
 end;
 begin
  perform studio.studio_run_youtube_schedule_now(w,'estio','yt-boundary-owner',s,1,req,cv,'approved_channel',channel,'Manual label',true);
  raise exception 'Cross-app manual run accepted'; exception when insufficient_privilege then null;
 end;
 begin
  perform studio.studio_enable_youtube_schedule(w,'substo','yt-boundary-owner',s,1,r.version,req,cv,'search','','Label',true);
  raise exception 'Manual request reused for activation'; exception when unique_violation then null;
 end;
 update studio.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id=w and schedule_id=s returning * into r;
 if studio.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true)->>'outcome'<>'busy'
 then raise exception 'Dispatcher overlapped manual run'; end if;
 run:=(original->>'discoveryRunId')::uuid; j.id:=(original->>'jobId')::uuid;
 perform studio.studio_claim_jobs('yt-boundary-worker',50,60); select * into j from studio.studio_jobs where id=j.id;
 -- A slot is charged only once within the current worker lease.
 perform studio.studio_begin_youtube_discovery(w,run,j.id,j.lease_owner,j.lease_token);
 perform studio.studio_begin_youtube_discovery(w,run,j.id,j.lease_owner,j.lease_token);
 if (select requests from studio.studio_youtube_usage where location_id=w)<>1 then raise exception 'Same lease consumed duplicate slot'; end if;
 begin
  perform studio.studio_finish_youtube_discovery(w,run,j.id,j.lease_owner,gen_random_uuid(),'[]');
  raise exception 'Stale worker saved manual result'; exception when serialization_failure then null;
 end;
 begin
  delete from studio.studio_youtube_channels where location_id=w and channel_id=channel;
  perform studio.studio_finish_youtube_discovery(w,run,j.id,j.lease_owner,j.lease_token,'[]');
  raise exception 'Removed channel saved manual result'; exception when insufficient_privilege then null;
 end;
 begin
  delete from studio.platform_google_youtube_connections where app='substo' and clerk_user_id='yt-boundary-owner';
  if exists(select 1 from studio.studio_youtube_schedule_runs where id=run and
    (source_mode is not null or channel_id is not null or title_prefix is not null or connection_version is not null or schedule_version is not null))
  then raise exception 'Removed profile retained private manual source'; end if;
  perform studio.studio_finish_youtube_discovery(w,run,j.id,j.lease_owner,j.lease_token,'[]');
  raise exception 'Removed profile saved manual result'; exception when insufficient_privilege then null;
 end;
 begin
  delete from studio.studio_location_members where location_id=w and clerk_user_id='yt-boundary-owner';
  perform studio.studio_finish_youtube_discovery(w,run,j.id,j.lease_owner,j.lease_token,'[]');
  raise exception 'Removed member saved manual result'; exception when insufficient_privilege then null;
 end;
 -- Four more schedules reach the location queue cap of five.
 for n in 1..4 loop
  other:=gen_random_uuid();
  perform studio.studio_save_schedule(w,other,0,'substo','yt-boundary-owner','youtube-discovery','Query',24,'09:00');
  perform studio.studio_run_youtube_schedule_now(w,'substo','yt-boundary-owner',other,1,gen_random_uuid(),cv,'search','','Label',true);
 end loop;
 other:=gen_random_uuid();
 perform studio.studio_save_schedule(w,other,0,'substo','yt-boundary-owner','youtube-discovery','Query',24,'09:00');
 begin
  perform studio.studio_run_youtube_schedule_now(w,'substo','yt-boundary-owner',other,1,gen_random_uuid(),cv,'search','','Label',true);
  raise exception 'Manual queue cap exceeded'; exception when serialization_failure then null;
 end;
 perform studio.studio_finish_youtube_discovery(w,run,j.id,j.lease_owner,j.lease_token,'[]');
 perform studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,'{}');
 original:=studio.studio_run_youtube_schedule_now(w,'substo','yt-boundary-owner',s,1,gen_random_uuid(),cv,'search','','Label',true);
 run:=(original->>'discoveryRunId')::uuid; j.id:=(original->>'jobId')::uuid;
 perform studio.studio_claim_jobs('yt-boundary-worker',50,60); select * into j from studio.studio_jobs where id=j.id;
 update studio.studio_youtube_usage set requests=50 where location_id=w;
 if studio.studio_begin_youtube_discovery(w,run,j.id,j.lease_owner,j.lease_token)->>'outcome'<>'quota'
 then raise exception 'Manual daily cap bypassed'; end if;
end $$;
select 'Studio YouTube manual authorization, overlap and cap assertions passed' as result;
