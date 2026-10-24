do $$
declare
 w uuid:='b0100000-0000-4000-8000-000000000001'; s uuid:='b0300000-0000-4000-8000-000000000001'; yt uuid:='b0300000-0000-4000-8000-000000000002';
 idea uuid:='b0200000-0000-4000-8000-000000000001'; src uuid:='b0200000-0000-4000-8000-000000000002'; req uuid:=gen_random_uuid();
 selection jsonb; result jsonb; original jsonb; r public.studio_schedule_recurring%rowtype; j public.studio_jobs%rowtype; run uuid; op text; tbl text;
begin
 foreach tbl in array array['studio_schedule_recurring','studio_schedule_commands','studio_schedule_ticks'] loop
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
   if has_table_privilege('service_role','public.'||tbl,op) then raise exception 'Mutable recurring table %',tbl; end if;
  end loop;
  if has_table_privilege('authenticated','public.'||tbl,'SELECT') then raise exception 'Browser table exposed'; end if;
 end loop;
 if has_function_privilege('authenticated','public.studio_dispatch_schedule(uuid,uuid,uuid,timestamptz,boolean)','EXECUTE')
 or to_regprocedure('public.studio_begin_text_run_attempt_v21(uuid,uuid,uuid,text,uuid)') is not null
 or has_function_privilege('service_role','public.studio_build_selected_text_snapshot(uuid,jsonb,text,text)','EXECUTE') then raise exception 'Unsafe recurring RPC grants'; end if;
 if public.studio_next_schedule_due('2026-03-28 23:00Z',24,'03:30','Asia/Nicosia')<>'2026-03-29 01:30Z'::timestamptz
 or public.studio_next_schedule_due('2026-03-29 01:31Z',24,'03:30','Asia/Nicosia')<>'2026-03-30 00:30Z'::timestamptz
 or public.studio_next_schedule_due('2026-10-24 23:00Z',24,'03:30','Asia/Nicosia')<>'2026-10-25 01:30Z'::timestamptz
 or public.studio_next_schedule_due('2026-10-25 01:30Z',24,'03:30','Asia/Nicosia')<>'2026-10-26 01:30Z'::timestamptz
 or public.studio_next_schedule_due('2026-03-28 23:00Z',168,'03:30','Asia/Nicosia')<>'2026-04-04 23:00Z'::timestamptz then raise exception 'DST/elapsed cadence mismatch'; end if;
 perform public.studio_create_substo_workspace(w,'Recurring fixture','recurring-owner');
 insert into public.studio_workspace_memberships(workspace_id,workspace_brand,clerk_user_id,role) values(w,'substo','recurring-member','member');
 perform public.studio_save_schedule(w,s,0,'substo','recurring-owner','script-brief','Pinned focus',24,'09:00');
 perform public.studio_save_schedule(w,yt,0,'substo','recurring-owner','youtube-discovery','Search',24,'09:00');
 insert into public.studio_records(workspace_id,id,kind,title,payload) values(w,idea,'content','Pinned idea','{"stage":"idea","script":"Human script"}'),(w,src,'reference','Pinned research','{"notes":"Exact evidence"}');
 insert into public.studio_record_links values(w,idea,src);
 selection:=jsonb_build_array(jsonb_build_object('id',idea,'version',1));
 begin perform public.studio_set_schedule_recurring(w,'substo','recurring-member',s,1,0,req,'enable',selection,false);
  raise exception 'Implicit recurring consent'; exception when invalid_parameter_value then null; end;
 begin perform public.studio_set_schedule_recurring(w,'estio','recurring-member',s,1,0,req,'enable',selection,true);
  raise exception 'Wrong realm enabled'; exception when insufficient_privilege then null; end;
 begin perform public.studio_set_schedule_recurring(w,'substo','nonmember',s,1,0,req,'enable',selection,true);
  raise exception 'Nonmember enabled'; exception when insufficient_privilege then null; end;
 begin perform public.studio_set_schedule_recurring(w,'substo','recurring-member',yt,1,0,req,'enable',selection,true);
  raise exception 'YouTube enabled'; exception when invalid_parameter_value then null; end;
 original:=public.studio_set_schedule_recurring(w,'substo','recurring-member',s,1,0,req,'enable',selection,true);
 if public.studio_set_schedule_recurring(w,'substo','recurring-member',s,1,0,req,'enable',selection,true)<>original then raise exception 'Enable replay'; end if;
 if exists(select 1 from public.studio_jobs where workspace_id=w) or exists(select 1 from public.studio_ai_usage where workspace_id=w) then raise exception 'Activation incurred work'; end if;
 select * into r from public.studio_schedule_recurring where workspace_id=w and schedule_id=s;
 if not r.enabled or r.next_run_at<=clock_timestamp() or r.snapshot->>'focus'<>'Pinned focus' then raise exception 'Missing pinned consent'; end if;
 if public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true)->>'outcome'<>'not_due' then raise exception 'Early dispatch'; end if;
 update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '3 days' where workspace_id=w and schedule_id=s returning * into r;
 result:=public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 if result->>'outcome'<>'queued' then raise exception 'Due dispatch failed %',result; end if;
 select review_id,job_id into run,j.id from public.studio_schedule_executions where id=(result->>'executionId')::uuid;
 if (select snapshot from public.studio_idea_reviews where id=run)<>r.snapshot
 or (select count(*) from public.studio_jobs where workspace_id=w)<>1
 or (select payload->>'script' from public.studio_records where workspace_id=w and id=idea)<>'Human script' then raise exception 'Dispatch changed inputs/content or caught up multiple times'; end if;
 if public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true)->>'outcome'<>'not_due' then raise exception 'Due replay enqueued again'; end if;
 if (select next_run_at from public.studio_schedule_recurring where workspace_id=w and schedule_id=s)<=clock_timestamp() then raise exception 'Catch-up backlog retained'; end if;
 -- An active job skips an occurrence without creating more work.
 update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where workspace_id=w and schedule_id=s returning * into r;
 if public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true)->>'outcome'<>'busy' then raise exception 'Active overlap'; end if;
 if (select count(*) from public.studio_jobs where workspace_id=w)<>1 then raise exception 'Busy tick created another job'; end if;
 -- Paused queued jobs cannot begin a paid attempt.
 perform public.studio_set_schedule_recurring(w,'substo','recurring-owner',s,1,1,gen_random_uuid(),'pause','[]',false);
 perform public.studio_claim_jobs('recurring-worker',50,60);
 select * into j from public.studio_jobs where id=j.id;
 if public.studio_begin_text_run_attempt(w,run,j.id,'recurring-worker',j.lease_token)->>'outcome'<>'schedule_inactive'
 or exists(select 1 from public.studio_ai_usage where workspace_id=w) then raise exception 'Paused consent spent money'; end if;
 -- Replay must not enable again after a later pause.
 if public.studio_set_schedule_recurring(w,'substo','recurring-member',s,1,0,req,'enable',selection,true)<>original
 or (select enabled from public.studio_schedule_recurring where workspace_id=w and schedule_id=s) then raise exception 'Replay reactivated paused work'; end if;
 perform public.studio_set_schedule_recurring(w,'substo','recurring-member',s,1,2,gen_random_uuid(),'enable',selection,true);
 if public.studio_begin_text_run_attempt(w,run,j.id,'recurring-worker',j.lease_token)->>'outcome'<>'schedule_inactive' then raise exception 'Old generation inherited new consent'; end if;
 -- Cancel synthetic old job to test fresh dispatch conditions.
 update public.studio_jobs set status='cancelled',finished_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,lease_token=null where id=j.id;
 update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where workspace_id=w and schedule_id=s returning * into r;
 -- Exact provider input changes without a version bump also invalidate consent.
 update public.studio_records set payload='{"notes":"Changed evidence"}' where workspace_id=w and id=src;
 result:=public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 if result->>'outcome'<>'inputs_changed'
 or (select enabled from public.studio_schedule_recurring where workspace_id=w and schedule_id=s) then raise exception 'Changed source dispatched %, state %',result,(select row_to_json(z) from public.studio_schedule_recurring z where workspace_id=w and schedule_id=s); end if;
 perform public.studio_set_schedule_recurring(w,'substo','recurring-member',s,1,4,gen_random_uuid(),'enable',selection,true);
 -- Definition edits pause atomically.
 perform public.studio_save_schedule(w,s,1,'substo','recurring-owner','script-brief','New focus',168,'10:00');
 if (select enabled from public.studio_schedule_recurring where workspace_id=w and schedule_id=s)
 or (select last_outcome from public.studio_schedule_recurring where workspace_id=w and schedule_id=s)<>'definition_changed' then raise exception 'Definition edit retained consent'; end if;
 perform public.studio_set_schedule_recurring(w,'substo','recurring-member',s,2,6,gen_random_uuid(),'enable',selection,true);
 update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where workspace_id=w and schedule_id=s returning * into r;
 delete from public.studio_workspace_memberships where workspace_id=w and clerk_user_id='recurring-member';
 if public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true)->>'outcome'<>'authority_revoked' then raise exception 'Revoked member dispatched'; end if;
 begin perform public.studio_set_schedule_recurring(w,'substo','recurring-member',s,1,0,req,'enable',selection,true);
  raise exception 'Revoked replay'; exception when insufficient_privilege then null; end;
 -- A current remaining member can replace consent, while stale state is rejected.
 begin perform public.studio_set_schedule_recurring(w,'substo','recurring-owner',s,2,7,gen_random_uuid(),'enable',selection,true);
  raise exception 'Stale state activation'; exception when serialization_failure then null; end;
end $$;
select 'Studio recurring schedule assertions passed' as result;

do $$
declare w uuid:='b1100000-0000-4000-8000-000000000001'; s uuid:='b1300000-0000-4000-8000-000000000001';
 idea uuid:='b1200000-0000-4000-8000-000000000001'; selection jsonb;
 r public.studio_schedule_recurring%rowtype; result jsonb; j public.studio_jobs%rowtype; run uuid; a uuid;
begin
 insert into public.studio_workspaces(id,brand,workspace_type,name,estio_location_id) values(w,'estio','estio_location','Estio recurring fixture','synthetic-location');
 insert into public.studio_records(workspace_id,id,kind,title,payload) values(w,idea,'content','Estio idea','{"stage":"idea"}');
 selection:=jsonb_build_array(jsonb_build_object('id',idea,'version',1));
 perform public.studio_save_schedule(w,s,0,'estio','estio-author','idea-review','Estio focus',24,'09:00');
 perform public.studio_set_schedule_recurring(w,'estio','estio-author',s,1,0,gen_random_uuid(),'enable',selection,true);
 update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where workspace_id=w and schedule_id=s returning * into r;
 if public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,false)->>'outcome'<>'authority_revoked'
 or exists(select 1 from public.studio_jobs where workspace_id=w) then raise exception 'Estio denial ignored'; end if;
 perform public.studio_set_schedule_recurring(w,'estio','estio-author',s,1,2,gen_random_uuid(),'enable',selection,true);
 update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where workspace_id=w and schedule_id=s returning * into r;
 result:=public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 select review_id,job_id into run,j.id from public.studio_schedule_executions where id=(result->>'executionId')::uuid;
 insert into public.studio_workspace_ai_credentials(workspace_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
 values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','estio-author');
 perform public.studio_set_ai_budget(w,'estio','estio-author',1000000);
 perform public.studio_claim_jobs('recurring-estio-worker',50,60);
 select * into j from public.studio_jobs where id=j.id;
 a:=(public.studio_begin_text_run_attempt(w,run,j.id,'recurring-estio-worker',j.lease_token)->>'attempt_id')::uuid;
 if a is null then raise exception 'Authorized recurring attempt did not start'; end if;
 update public.studio_jobs set attempts=max_attempts,lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
 perform public.studio_claim_jobs('recurring-estio-worker',50,60);
 update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where workspace_id=w and schedule_id=s returning * into r;
 result:=public.studio_dispatch_schedule(w,s,r.activation_token,r.next_run_at,true);
 if result->>'outcome'<>'charge_review_required' or (select enabled from public.studio_schedule_recurring where workspace_id=w and schedule_id=s)
 or (select count(*) from public.studio_jobs where workspace_id=w)<>1
 or (select status from public.studio_ai_usage where id=(select usage_id from public.studio_ai_attempts where id=a))<>'reserved' then raise exception 'Recurring crash lost hold or authorized new spend'; end if;
end $$;
select 'Studio recurring paid recovery assertions passed' as result;
