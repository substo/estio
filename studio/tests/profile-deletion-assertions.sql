do $$
declare
 w uuid:='e1100000-0000-4000-8000-000000000001'; estio_w uuid:='e1100000-0000-4000-8000-000000000002';
 yt uuid:='e1300000-0000-4000-8000-000000000001'; text_s uuid:='e1300000-0000-4000-8000-000000000002'; other_s uuid:='e1300000-0000-4000-8000-000000000003'; estio_s uuid:='e1300000-0000-4000-8000-000000000004';
 idea uuid:='e1200000-0000-4000-8000-000000000001'; cv uuid:=gen_random_uuid(); ecv uuid:=gen_random_uuid();
 body_hash text:=repeat('a',64); at_time timestamptz:='2026-10-24 00:00:00Z'; cipher jsonb:='{"ciphertext":"sealed","iv":"iv","authTag":"tag","keyId":"v1"}';
 selection jsonb; result jsonb; replay jsonb; run uuid; j public.studio_jobs%rowtype; r public.studio_schedule_recurring%rowtype;
 bookmark uuid; tbl text; op text;
begin
 foreach tbl in array array['platform_profile_deletions','platform_profile_deletion_events'] loop
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
   if has_table_privilege('service_role','public.'||tbl,op) then raise exception 'Deletion fence/audit mutable'; end if;
  end loop;
  if has_table_privilege('authenticated','public.'||tbl,'SELECT') then raise exception 'Deletion data exposed'; end if;
 end loop;
 if has_function_privilege('authenticated','public.platform_delete_profile(text,text,text,timestamptz,text)','EXECUTE')
 or has_function_privilege('service_role','public.platform_require_active_profile(text,text)','EXECUTE') then raise exception 'Deletion RPC exposed'; end if;
 perform public.studio_create_substo_workspace(w,'Deleted profile fixture','user_same_id');
 insert into public.studio_workspace_memberships(workspace_id,workspace_brand,clerk_user_id,role) values(w,'substo','user_other','member');
 insert into public.studio_workspaces(id,brand,workspace_type,name,estio_location_id) values(estio_w,'estio','estio_location','Other realm fixture','profile-fixture-location');
 insert into public.platform_google_youtube_connections(brand,clerk_user_id,client_id,refresh_cipher,granted_scopes,version) values
 ('substo','user_same_id','client',cipher,array['https://www.googleapis.com/auth/youtube.readonly'],cv),
 ('estio','user_same_id','estio-client',cipher,array['https://www.googleapis.com/auth/youtube.readonly'],ecv),
 ('substo','user_other','client',cipher,array['https://www.googleapis.com/auth/youtube.readonly'],gen_random_uuid());
 perform public.platform_youtube_oauth('begin','substo','user_same_id',repeat('b',64),repeat('c',64));
 perform public.platform_youtube_oauth('consume','substo','user_same_id',repeat('b',64),repeat('c',64));
 perform public.platform_youtube_oauth('begin','estio','user_same_id',repeat('b',64),repeat('c',64));
 perform public.studio_save_record(w,idea,'content','Profile-owned queued idea','{"stage":"idea","notes":"Exact human input"}',0,'user_same_id');
 selection:=jsonb_build_array(jsonb_build_object('id',idea,'version',1));
 perform public.studio_save_schedule(w,yt,0,'substo','user_same_id','youtube-discovery','Public query',24,'09:00');
 perform public.studio_enable_youtube_schedule(w,'substo','user_same_id',yt,1,0,gen_random_uuid(),cv,'search','','Profile research',true);
 perform public.studio_save_schedule(w,text_s,0,'substo','user_same_id','idea-review','Text focus',24,'09:00');
 perform public.studio_set_schedule_recurring(w,'substo','user_same_id',text_s,1,0,gen_random_uuid(),'enable',selection,true);
 perform public.studio_save_schedule(w,other_s,0,'substo','user_other','idea-review','Other author',24,'09:00');
 perform public.studio_set_schedule_recurring(w,'substo','user_other',other_s,1,0,gen_random_uuid(),'enable',selection,true);
 perform public.studio_save_schedule(estio_w,estio_s,0,'estio','user_same_id','youtube-discovery','Other realm query',24,'09:00');
 perform public.studio_enable_youtube_schedule(estio_w,'estio','user_same_id',estio_s,1,0,gen_random_uuid(),ecv,'search','','Estio research',true);
 bookmark:=public.studio_save_youtube_bookmark(w,'substo','user_same_id',gen_random_uuid(),'aaaaaaaaaaa','Keep shared research','{"kind":"saved_url","rights":"research_link_only"}');
 insert into public.studio_workspace_ai_credentials(workspace_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
 values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','user_same_id');
 perform public.studio_set_ai_budget(w,'substo','user_same_id',1000000);
 update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where workspace_id=w and schedule_id=text_s returning * into r;
 result:=public.studio_dispatch_schedule(w,text_s,r.activation_token,r.next_run_at,true);
 select review_id,job_id into run,j.id from public.studio_schedule_executions where id=(result->>'executionId')::uuid;
 result:=public.platform_delete_profile('substo','user_same_id','msg_delete_fixture',at_time,body_hash);replay:=result;
 if result->>'credentialsRemoved'<>'1' or result->>'pendingConsentsRemoved'<>'1' or result->>'sourceAuthorizationsRemoved'<>'1'
 or result->>'recurrencesPaused'<>'2' then raise exception 'Incomplete cleanup counts %',result; end if;
 if exists(select 1 from public.platform_google_youtube_connections where brand='substo' and clerk_user_id='user_same_id')
 or exists(select 1 from public.platform_google_youtube_oauth_states where brand='substo' and clerk_user_id='user_same_id')
 or exists(select 1 from public.platform_youtube_schedule_authorizations where brand='substo' and clerk_user_id='user_same_id')
 or exists(select 1 from public.studio_schedule_recurring where actor_brand='substo' and authorized_by='user_same_id' and enabled) then raise exception 'Deleted personal access remains'; end if;
 if not exists(select 1 from public.platform_google_youtube_connections where brand='estio' and clerk_user_id='user_same_id' and version=ecv)
 or not exists(select 1 from public.platform_google_youtube_oauth_states where brand='estio' and clerk_user_id='user_same_id')
 or not exists(select 1 from public.platform_google_youtube_connections where brand='substo' and clerk_user_id='user_other')
 or not (select enabled from public.studio_schedule_recurring where workspace_id=w and schedule_id=other_s)
 or not (select enabled from public.studio_schedule_recurring where workspace_id=estio_w and schedule_id=estio_s) then raise exception 'Cleanup crossed realm/profile boundary'; end if;
 if not exists(select 1 from public.studio_records where workspace_id=w and id=bookmark and title='Keep shared research')
 or not exists(select 1 from public.studio_workspace_memberships where workspace_id=w and clerk_user_id='user_same_id' and role='owner')
 or not exists(select 1 from public.studio_workspace_ai_credentials where workspace_id=w)
 or not exists(select 1 from public.studio_idea_reviews where id=run) then raise exception 'Cleanup deleted workspace-owned data'; end if;
 if public.platform_delete_profile('substo','user_same_id','msg_delete_fixture',at_time,body_hash)<>replay
 or (select count(*) from public.platform_profile_deletion_events where brand='substo' and event_id='msg_delete_fixture')<>1 then raise exception 'Deletion replay mutated result/history'; end if;
 begin perform public.platform_delete_profile('substo','user_other','msg_delete_fixture',at_time,body_hash);
 raise exception 'Event ID reused for another principal'; exception when unique_violation then null; end;
 if public.platform_youtube_oauth('begin','substo','user_same_id',repeat('b',64),repeat('d',64))
 or public.platform_youtube_oauth('commit','substo','user_same_id',repeat('b',64),repeat('c',64),cipher,'client',array['https://www.googleapis.com/auth/youtube.readonly']) then raise exception 'Deleted OAuth resurrected'; end if;
 begin insert into public.platform_google_youtube_connections(brand,clerk_user_id,client_id,refresh_cipher,granted_scopes) values('substo','user_same_id','client',cipher,array['https://www.googleapis.com/auth/youtube.readonly']);
 raise exception 'Direct owner-side grant recreated'; exception when insufficient_privilege then null; end;
 begin perform public.studio_create_substo_workspace('e1100000-0000-4000-8000-000000000009','Resurrection attempt','user_same_id');
 raise exception 'Deleted identity created another workspace'; exception when insufficient_privilege then null; end;
 begin perform public.studio_create_substo_workspace('e1100000-0000-4000-8000-000000000009','Resurrection attempt',' user_same_id ');
 raise exception 'Whitespace alias bypassed deletion'; exception when insufficient_privilege then null; end;
 if exists(select 1 from public.studio_workspaces where id='e1100000-0000-4000-8000-000000000009') then raise exception 'Denied creation left orphan workspace'; end if;
 begin perform public.studio_set_schedule_recurring(w,'substo','user_same_id',text_s,1,2,gen_random_uuid(),'enable',selection,true);
 raise exception 'Deleted identity reauthorized recurrence'; exception when insufficient_privilege then null; end;
 perform public.studio_claim_jobs('deleted-profile-worker',50,60); select * into j from public.studio_jobs where id=j.id;
 if public.studio_begin_text_run_attempt(w,run,j.id,'deleted-profile-worker',j.lease_token)->>'outcome'<>'schedule_inactive'
 or exists(select 1 from public.studio_ai_usage where workspace_id=w) then raise exception 'Deleted profile started scheduled paid work'; end if;
 -- A different verified deletion delivery is monotonic, including an older event time.
 result:=public.platform_delete_profile('substo','user_same_id','msg_delete_older',at_time-interval '1 day',repeat('e',64));
 if result->>'alreadyDeleted'<>'true' or (select first_event_id from public.platform_profile_deletions where brand='substo' and clerk_user_id='user_same_id')<>'msg_delete_fixture' then raise exception 'Late event undid deletion'; end if;
 -- Identical event IDs across distinct realms remain independent.
 perform public.platform_delete_profile('estio','user_same_id','msg_delete_fixture',at_time,body_hash);
 if (select count(*) from public.platform_profile_deletions where clerk_user_id='user_same_id')<>2 then raise exception 'Deletion realm IDs merged'; end if;
 -- Failure after credential cleanup must roll back the marker and all deletions.
 insert into public.platform_google_youtube_connections(brand,clerk_user_id,client_id,refresh_cipher,granted_scopes) values('substo','user_rollback','client',cipher,array['https://www.googleapis.com/auth/youtube.readonly']);
 perform public.platform_youtube_oauth('begin','substo','user_rollback',repeat('b',64),repeat('c',64));
 alter table public.platform_profile_deletion_events add constraint forced_profile_audit_failure check (clerk_user_id<>'user_rollback') not valid;
 begin perform public.platform_delete_profile('substo','user_rollback','msg_rollback',at_time,body_hash);
 raise exception 'Forced deletion failure did not fire'; exception when check_violation then null; end;
 alter table public.platform_profile_deletion_events drop constraint forced_profile_audit_failure;
 if exists(select 1 from public.platform_profile_deletions where brand='substo' and clerk_user_id='user_rollback')
 or not exists(select 1 from public.platform_google_youtube_connections where brand='substo' and clerk_user_id='user_rollback')
 or not exists(select 1 from public.platform_google_youtube_oauth_states where brand='substo' and clerk_user_id='user_rollback') then raise exception 'Failed audit partially deleted profile access'; end if;
end $$;
select 'Platform profile deletion assertions passed' as result;
