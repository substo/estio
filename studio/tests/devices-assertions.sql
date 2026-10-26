-- Synthetic paired devices only. No live credentials or network/provider calls.
do $$
declare
 w uuid:='da000000-0000-4000-8000-000000000001'; w2 uuid:='da000000-0000-4000-8000-000000000002';
 d uuid; d2 uuid; j uuid; j2 uuid; lease uuid; oldlease uuid; r jsonb; body jsonb; v_count int;
begin
 perform public.studio_create_substo_workspace(w,'Mac tests','mac-owner');
 perform public.studio_create_substo_workspace(w2,'Other Mac tests','other-owner');
 if has_table_privilege('authenticated','public.studio_devices','SELECT') or has_column_privilege('service_role','public.studio_devices','token_hash','SELECT')
 or has_function_privilege('service_role','public.studio_claim_device_jobs(uuid,uuid,text,integer,integer)','EXECUTE')
 or has_function_privilege('anon','public.studio_device_command(text,text,text,jsonb)','EXECUTE') then raise exception 'Unsafe device privileges'; end if;
 begin
  perform public.studio_manage_device(w,'substo','other-owner','create',gen_random_uuid(),'Bad',null,repeat('a',64));
  raise exception 'Cross Business manager accepted';
 exception when sqlstate '42501' then null; end;
 begin
  perform public.studio_manage_device(w,'estio','mac-owner','create',gen_random_uuid(),'Bad',null,repeat('a',64));
  raise exception 'Cross realm manager accepted';
 exception when sqlstate '42501' then null; end;
 d:=(public.studio_manage_device(w,'substo','mac-owner','create',gen_random_uuid(),'Mac',null,repeat('a',64))->>'deviceId')::uuid;
 d2:=(public.studio_manage_device(w2,'substo','other-owner','create',gen_random_uuid(),'Other',null,repeat('b',64))->>'deviceId')::uuid;
 j:=(public.studio_manage_device(w,'substo','mac-owner','diagnostic','da000000-0000-4000-8000-000000000003',null,d,null,'codex','gpt-5')->>'jobId')::uuid;
 if (public.studio_manage_device(w,'substo','mac-owner','diagnostic','da000000-0000-4000-8000-000000000003',null,d,null,'codex','gpt-5')->>'jobId')::uuid<>j then raise exception 'Diagnostic not idempotent'; end if;
 if (select payload from public.studio_jobs where id=j)<>'{"provider":"codex","model":"gpt-5"}' then raise exception 'Selection lost'; end if;
 begin perform public.studio_manage_device(w,'substo','mac-owner','diagnostic',gen_random_uuid(),null,d,null,'other','model'); raise exception 'Invalid provider'; exception when sqlstate '22023' then null; end;
 j2:=(public.studio_manage_device(w2,'substo','other-owner','diagnostic',gen_random_uuid(),null,d2)->>'jobId')::uuid;
 -- Offline indefinitely: hosted recovery never converts routing or claims the job.
 update public.studio_jobs set run_after=clock_timestamp()-interval '30 days' where id in(j,j2);
 perform public.studio_claim_jobs('hosted-test',50,60);
 if exists(select 1 from public.studio_jobs where id in(j,j2) and (status<>'queued' or attempts<>0 or execution_target<>'device')) then raise exception 'Hosted claimed offline work'; end if;
 begin perform public.studio_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}'); raise exception 'Bad token accepted'; exception when sqlstate '42501' then null; end;
 begin perform public.studio_device_command(repeat('a',64),'estio','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}'); raise exception 'Cross realm token accepted'; exception when sqlstate '42501' then null; end;
 perform public.studio_device_command(repeat('a',64),'substo','heartbeat',jsonb_build_object('workerId','mac','release','test','startedAt',clock_timestamp(),'report','{}'::jsonb));
 if (select seen_at from public.studio_devices where id=d) is null then raise exception 'No heartbeat'; end if;
 r:=public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":50,"leaseSeconds":60}');
 if jsonb_array_length(r)<>1 or r->0->>'id'<>j::text then raise exception 'Cross Business claim %',r; end if;
 lease:=(r->0->>'lease_token')::uuid;
 body:=jsonb_build_object('jobId',j,'workerId','mac','leaseToken',lease,'leaseSeconds',60,'result','{}'::jsonb,'failure',jsonb_build_object('code','test','message','safe','retryable',true));
 if public.studio_device_command(repeat('a',64),'substo','extend',body)<>'true' then raise exception 'Extend rejected'; end if;
 begin perform public.studio_device_command(repeat('b',64),'substo','complete',body); raise exception 'Cross Business complete'; exception when sqlstate '42501' then null; end;
 update public.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
 if public.studio_device_command(repeat('a',64),'substo','complete',body)<>'false' then raise exception 'Expired completion accepted'; end if;
 if public.studio_device_command(repeat('a',64),'substo','extend',body)<>'false' then raise exception 'Expired extension accepted'; end if;
 if public.studio_device_command(repeat('a',64),'substo','fail',body)<>'"lease_lost"' then raise exception 'Expired failure accepted'; end if;
 oldlease:=lease;
 r:=public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}');
 lease:=(r->0->>'lease_token')::uuid;
 if lease is null or lease=oldlease then raise exception 'Recovery did not fence lease'; end if;
 if public.studio_device_command(repeat('a',64),'substo','complete',body)<>'false' then raise exception 'Stale completion accepted'; end if;
 body:=jsonb_set(body,'{leaseToken}',to_jsonb(lease));
 if public.studio_device_command(repeat('a',64),'substo','fail',body)<>'"retry_scheduled"' then raise exception 'Retry semantics lost'; end if;
 update public.studio_jobs set run_after=clock_timestamp()-interval '1 second' where id=j;
 r:=public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}');
 body:=jsonb_set(body,'{leaseToken}',r->0->'lease_token');
 if public.studio_device_command(repeat('a',64),'substo','complete',body)<>'true' or public.studio_device_command(repeat('a',64),'substo','complete',body)<>'false' then raise exception 'Completion idempotency lost'; end if;
 if (select count(*) from public.studio_job_events where job_id=j and event='succeeded')<>1 then raise exception 'Duplicate event'; end if;
 -- Revoke while a valid running lease exists; every operation must be fenced.
 r:=public.studio_device_command(repeat('b',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}');
 body:=jsonb_build_object('jobId',j2,'workerId','mac','leaseToken',r->0->'lease_token','leaseSeconds',60,'result','{}'::jsonb);
 perform public.studio_manage_device(w2,'substo','other-owner','revoke',gen_random_uuid(),null,d2);
 for r in select to_jsonb(x) from unnest(array['heartbeat','claim','extend','complete','fail']) x loop
  begin perform public.studio_device_command(repeat('b',64),'substo',r#>>'{}',body); raise exception 'Revoked operation accepted'; exception when sqlstate '42501' then null; end;
 end loop;
 -- A previously paired manager who loses their role cannot keep operating.
 update public.studio_workspace_memberships set role='member' where workspace_id=w and clerk_user_id='mac-owner';
 begin perform public.studio_device_command(repeat('a',64),'substo','heartbeat',body); raise exception 'Former manager still authorized'; exception when sqlstate '42501' then null; end;
 delete from public.studio_workspace_memberships where workspace_id=w and clerk_user_id='mac-owner';
 begin perform public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}'); raise exception 'Removed creator still authorized'; exception when sqlstate '42501' then null; end;
 delete from public.studio_workspaces where id in(w,w2);
end $$;

-- Manual retries must not let a member spend a paired manager's subscription.
do $$
declare
 w uuid:='da000000-0000-4000-8000-000000000010';
 d uuid; j uuid; hosted public.studio_jobs%rowtype; retried public.studio_jobs%rowtype;
begin
 perform public.studio_create_substo_workspace(w,'Device retry tests','retry-owner');
 insert into public.studio_workspace_memberships(workspace_id,workspace_brand,clerk_user_id,role)
 values(w,'substo','retry-member','member'),(w,'substo','retry-admin','admin');
 d:=(public.studio_manage_device(w,'substo','retry-owner','create',gen_random_uuid(),'Retry Mac',null,repeat('d',64))->>'deviceId')::uuid;
 j:=(public.studio_manage_device(w,'substo','retry-owner','diagnostic',gen_random_uuid(),null,d)->>'jobId')::uuid;
 update public.studio_jobs set status='failed',attempts=max_attempts,finished_at=clock_timestamp() where id=j;
 begin
  perform public.studio_member_job_action(w,'substo','retry-member',j,'retry');
  raise exception 'Member retried device job';
 exception when sqlstate '42501' then null; end;
 if exists(select 1 from public.studio_jobs where id=j and (status<>'failed' or attempts<>max_attempts))
  or exists(select 1 from public.studio_job_events where job_id=j and event='requeued') then
  raise exception 'Forbidden retry changed job or events';
 end if;
 retried:=public.studio_member_job_action(w,'substo','retry-admin',j,'retry');
 if retried.status<>'queued' or retried.attempts<>0 or retried.finished_at is not null
  or retried.execution_target<>'device' or retried.device_id<>d
  or (select count(*) from public.studio_job_events where job_id=j and event='requeued' and actor_clerk_user_id='retry-admin')<>1 then
  raise exception 'Admin device retry lost existing semantics';
 end if;
 -- Cancel remains a member action, including for device jobs.
 retried:=public.studio_member_job_action(w,'substo','retry-member',j,'cancel');
 if retried.status<>'cancelled' then raise exception 'Member device cancel regressed'; end if;
 update public.studio_jobs set status='failed',attempts=max_attempts,finished_at=clock_timestamp() where id=j;
 perform public.studio_manage_device(w,'substo','retry-owner','revoke',gen_random_uuid(),null,d);
 begin
  perform public.studio_member_job_action(w,'substo','retry-admin',j,'retry');
  raise exception 'Admin retried revoked device job';
 exception when sqlstate '42501' then null; end;
 if exists(select 1 from public.studio_jobs where id=j and (status<>'failed' or attempts<>max_attempts))
  or (select count(*) from public.studio_job_events where job_id=j and event='requeued')<>1 then
  raise exception 'Revoked retry changed job or events';
 end if;
 hosted:=public.studio_enqueue_job(w,'studio.diagnostic','{}',null,'retry-member',3);
 update public.studio_jobs set status='failed',attempts=max_attempts,finished_at=clock_timestamp() where id=hosted.id;
 hosted:=public.studio_member_job_action(w,'substo','retry-member',hosted.id,'retry');
 if hosted.status<>'queued' or hosted.attempts<>0 or hosted.finished_at is not null or hosted.execution_target<>'hosted' then
  raise exception 'Member hosted retry regressed';
 end if;
 hosted:=public.studio_member_job_action(w,'substo','retry-member',hosted.id,'cancel');
 if hosted.status<>'cancelled' then raise exception 'Member hosted cancel regressed'; end if;
 delete from public.studio_workspaces where id=w;
end $$;
