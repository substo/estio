do $$
declare w text:='c1100000-0000-4000-8000-000000000001'; s uuid:='c1300000-0000-4000-8000-000000000001';
 req uuid:=gen_random_uuid(); cv uuid:=gen_random_uuid(); channel text:='UCaaaaaaaaaaaaaaaaaaaaaa'; video text:='aaaaaaaaaaa';
 r studio.studio_schedule_recurring%rowtype; result jsonb; original jsonb; input jsonb; run uuid; j studio.studio_jobs%rowtype;
 record_id uuid; old_payload jsonb; tbl text; op text;
begin
 foreach tbl in array array['platform_youtube_schedule_authorizations','studio_youtube_schedule_runs'] loop
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
   if has_table_privilege('service_role','studio.'||tbl,op) then raise exception 'Unsafe direct mutation %',tbl; end if;
  end loop;
  if has_table_privilege('authenticated','studio.'||tbl,'SELECT') or has_table_privilege('anon','studio.'||tbl,'SELECT') then raise exception 'Exposed private discovery tables'; end if;
 end loop;
 if has_function_privilege('authenticated','studio.studio_begin_youtube_discovery(text,uuid,uuid,text,uuid)','EXECUTE')
 or has_function_privilege('service_role','studio.studio_lock_youtube_schedule(text,uuid,uuid)','EXECUTE') then raise exception 'Unsafe discovery RPC grants'; end if;
 perform studio.studio_create_substo_location(w,'YouTube schedule fixture','yt-schedule-owner');
 insert into studio.studio_location_members(location_id,location_app,clerk_user_id,role) values(w,'substo','yt-schedule-member','member');
 insert into studio.platform_google_youtube_connections(app,clerk_user_id,client_id,refresh_cipher,granted_scopes,version)
 values('substo','yt-schedule-owner','client','{"ciphertext":"sealed","iv":"iv","authTag":"tag","keyId":"v1"}',array['https://www.googleapis.com/auth/youtube.readonly'],cv);
 perform studio.studio_save_schedule(w,s,0,'substo','yt-schedule-owner','youtube-discovery','Public research query',24,'09:00');
 begin perform studio.studio_enable_youtube_schedule(w,'substo','yt-schedule-owner',s,1,0,req,cv,'subscription',channel,'My label',false);
 raise exception 'Implicit link sharing'; exception when invalid_parameter_value then null; end;
 begin perform studio.studio_enable_youtube_schedule(w,'substo','yt-schedule-member',s,1,0,req,cv,'subscription',channel,'My label',true);
 raise exception 'Member borrowed owner grant'; exception when insufficient_privilege then null; end;
 begin perform studio.studio_enable_youtube_schedule(w,'estio','yt-schedule-owner',s,1,0,req,cv,'subscription',channel,'My label',true);
 raise exception 'Cross-realm grant'; exception when insufficient_privilege then null; end;
 begin perform studio.studio_enable_youtube_schedule(w,'substo','yt-schedule-owner',s,1,0,req,gen_random_uuid(),'subscription',channel,'My label',true);
 raise exception 'Stale grant version'; exception when insufficient_privilege then null; end;
 original:=studio.studio_enable_youtube_schedule(w,'substo','yt-schedule-owner',s,1,0,req,cv,'subscription',channel,'My label',true);
 if studio.studio_enable_youtube_schedule(w,'substo','yt-schedule-owner',s,1,0,req,cv,'subscription',channel,'My label',true)<>original then raise exception 'Activation replay'; end if;
 if exists(select 1 from studio.studio_jobs where location_id=w) then raise exception 'Activation enqueued immediately'; end if;
 if (select snapshot::text from studio.studio_schedule_recurring where location_id=w and schedule_id=s) like '%'||channel||'%'
 or (select request::text from studio.studio_schedule_commands where location_id=w and request_id=req) like '%'||channel||'%' then raise exception 'Private source leaked into location snapshots/command audit'; end if;
 update studio.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id=w and schedule_id=s returning * into r;
 result:=studio.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 if result->>'outcome'<>'queued' then raise exception 'YouTube dispatch failed %',result; end if;
 select youtube_run_id,job_id into run,j.id from studio.studio_schedule_executions where id=(result->>'executionId')::uuid;
 if studio.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true)->>'outcome'<>'not_due' then raise exception 'Duplicate YouTube tick'; end if;
 perform studio.studio_claim_jobs('yt-schedule-worker',50,60); select * into j from studio.studio_jobs where id=j.id;
 begin perform studio.studio_begin_youtube_discovery(w,run,j.id,'yt-schedule-worker',gen_random_uuid());
 raise exception 'Foreign lease read private source'; exception when serialization_failure then null; end;
 input:=studio.studio_begin_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token);
 if input->>'channelId'<>channel or input->>'connectionVersion'<>cv::text or input->>'userId'<>'yt-schedule-owner' then raise exception 'Private worker context not bound to explicit principal'; end if;
 perform studio.studio_begin_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token);
 if (select requests from studio.studio_youtube_usage where location_id=w and day=(now() at time zone 'UTC')::date)<>1 then raise exception 'Same claim consumed duplicate quota'; end if;
 begin perform studio.studio_finish_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token,jsonb_build_array(video,video));
 raise exception 'Duplicate IDs accepted'; exception when invalid_parameter_value then null; end;
 if exists(select 1 from studio.studio_records where location_id=w) then raise exception 'Invalid finish partially saved'; end if;
 update studio.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
 begin perform studio.studio_finish_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token,jsonb_build_array(video));
 raise exception 'Expired lease saved results'; exception when serialization_failure then null; end;
 update studio.studio_jobs set lease_expires_at=clock_timestamp()+interval '60 seconds' where id=j.id;
 result:=studio.studio_finish_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token,jsonb_build_array(video));
 if studio.studio_finish_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token,jsonb_build_array(video))<>result then raise exception 'Finish replay'; end if;
 record_id:=(result#>>'{links,0,recordId}')::uuid;
 if (select title from studio.studio_records where location_id=w and id=record_id)<>'My label · '||video
 or (select approved from studio.studio_records where location_id=w and id=record_id)
 or result::text like '%'||channel||'%' then raise exception 'Provider metadata/private source persisted or automatic approval'; end if;
 update studio.studio_records set title='Human revised title',payload=payload||'{"notes":"Exact human notes","custom":true,"approved":true}',version=5 where location_id=w and id=record_id returning payload into old_payload;
 perform studio.studio_complete_job(j.id,'yt-schedule-worker',j.lease_token,'{}');
 update studio.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id=w and schedule_id=s returning * into r;
 result:=studio.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 select youtube_run_id,job_id into run,j.id from studio.studio_schedule_executions where id=(result->>'executionId')::uuid;
 perform studio.studio_claim_jobs('yt-schedule-worker',50,60); select * into j from studio.studio_jobs where id=j.id;
 perform studio.studio_begin_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token);
 result:=studio.studio_finish_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token,jsonb_build_array(video));
 if result#>>'{links,0,reused}'<>'true' or (select count(*) from studio.studio_records where location_id=w)<>1
 or (select title from studio.studio_records where location_id=w and id=record_id)<>'Human revised title'
 or (select payload from studio.studio_records where location_id=w and id=record_id)<>old_payload
 or (select version from studio.studio_records where location_id=w and id=record_id)<>5 then raise exception 'Repeated discovery overwrote human work'; end if;
 perform studio.studio_complete_job(j.id,'yt-schedule-worker',j.lease_token,'{}');
 -- Revoke after provider read: no late result can be persisted, and private source is removed.
 update studio.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id=w and schedule_id=s returning * into r;
 result:=studio.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 select youtube_run_id,job_id into run,j.id from studio.studio_schedule_executions where id=(result->>'executionId')::uuid;
 perform studio.studio_claim_jobs('yt-schedule-worker',50,60); select * into j from studio.studio_jobs where id=j.id;
 perform studio.studio_begin_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token);
 perform studio.platform_clear_youtube_connection('substo','yt-schedule-owner');
 if exists(select 1 from studio.platform_youtube_schedule_authorizations where location_id=w)
 or (select enabled from studio.studio_schedule_recurring where location_id=w and schedule_id=s) then raise exception 'Profile removal retained authorization'; end if;
 begin perform studio.studio_finish_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token,'["bbbbbbbbbbb"]');
 raise exception 'Late post-revocation result saved'; exception when insufficient_privilege then null; end;
 if (select count(*) from studio.studio_records where location_id=w)<>1 or exists(select 1 from studio.studio_ai_usage where location_id=w) then raise exception 'Revoked discovery saved data or used AI budget'; end if;
 -- Reconnect and expire: cleanup pauses and removes private source, never adopts old jobs.
 cv:=gen_random_uuid();
 insert into studio.platform_google_youtube_connections(app,clerk_user_id,client_id,refresh_cipher,granted_scopes,version)
 values('substo','yt-schedule-owner','client','{"ciphertext":"new","iv":"iv","authTag":"tag","keyId":"v1"}',array['https://www.googleapis.com/auth/youtube.readonly'],cv);
 select * into r from studio.studio_schedule_recurring where location_id=w and schedule_id=s;
 perform studio.studio_enable_youtube_schedule(w,'substo','yt-schedule-owner',s,1,r.version,gen_random_uuid(),cv,'search','','New search label',true);
 begin perform studio.studio_begin_youtube_discovery(w,run,j.id,'yt-schedule-worker',j.lease_token);
 raise exception 'Old job inherited reconnected grant'; exception when insufficient_privilege then null; end;
 update studio.platform_youtube_schedule_authorizations set expires_at=clock_timestamp()-interval '1 second' where location_id=w;
 perform studio.studio_prune_youtube_schedule_authorizations();
 if exists(select 1 from studio.platform_youtube_schedule_authorizations where location_id=w)
 or (select enabled from studio.studio_schedule_recurring where location_id=w and schedule_id=s) then raise exception 'Expired authorization remained active'; end if;
end $$;
select 'Studio YouTube schedule assertions passed' as result;

do $$
declare w text:='c4100000-0000-4000-8000-000000000001'; s uuid:='c4300000-0000-4000-8000-000000000001'; cv uuid:=gen_random_uuid();
 channel text:='UCbbbbbbbbbbbbbbbbbbbbbb'; r studio.studio_schedule_recurring%rowtype; result jsonb; run uuid; j studio.studio_jobs%rowtype;
begin
 perform studio.studio_create_substo_location(w,'Approved channel fixture','yt-approved-owner');
 insert into studio.platform_google_youtube_connections(app,clerk_user_id,client_id,refresh_cipher,granted_scopes,version)
 values('substo','yt-approved-owner','client','{}',array['https://www.googleapis.com/auth/youtube.readonly'],cv),
 ('estio','yt-approved-owner','other-client','{}',array['https://www.googleapis.com/auth/youtube.readonly'],gen_random_uuid());
 perform studio.studio_save_schedule(w,s,0,'substo','yt-approved-owner','youtube-discovery','Query',24,'09:00');
 begin perform studio.studio_enable_youtube_schedule(w,'substo','yt-approved-owner',s,1,0,gen_random_uuid(),cv,'approved_channel',channel,'Label',true);
 raise exception 'Unapproved channel activated'; exception when insufficient_privilege then null; end;
 perform studio.studio_youtube_channel(w,'substo','yt-approved-owner',channel,'My approved channel',false);
 perform studio.studio_enable_youtube_schedule(w,'substo','yt-approved-owner',s,1,0,gen_random_uuid(),cv,'approved_channel',channel,'Label',true);
 -- Changing the other realm's same-ID connection has no effect.
 perform studio.platform_clear_youtube_connection('estio','yt-approved-owner');
 if not (select enabled from studio.studio_schedule_recurring where location_id=w and schedule_id=s) then raise exception 'Cross-realm removal paused schedule'; end if;
 update studio.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id=w and schedule_id=s returning * into r;
 result:=studio.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 select youtube_run_id,job_id into run,j.id from studio.studio_schedule_executions where id=(result->>'executionId')::uuid;
 perform studio.studio_claim_jobs('yt-approved-worker',50,60); select * into j from studio.studio_jobs where id=j.id;
 perform studio.studio_youtube_channel(w,'substo','yt-approved-owner',channel,'',true);
 begin perform studio.studio_begin_youtube_discovery(w,run,j.id,'yt-approved-worker',j.lease_token);
 raise exception 'Removed approval still authorized reads'; exception when insufficient_privilege then null; end;
 -- A connection version rotation stops and removes old profile authorizations.
 update studio.platform_google_youtube_connections set version=gen_random_uuid() where app='substo' and clerk_user_id='yt-approved-owner';
 if exists(select 1 from studio.platform_youtube_schedule_authorizations where location_id=w)
 or (select enabled from studio.studio_schedule_recurring where location_id=w and schedule_id=s) then raise exception 'Reconnection adopted old consent'; end if;
 if exists(select 1 from studio.studio_records where location_id=w) then raise exception 'Rejected reads created records'; end if;
end $$;
select 'Studio YouTube source and realm assertions passed' as result;
