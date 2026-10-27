do $$
declare
  w text := 'ae100000-0000-4000-8000-000000000001'; other_w text := 'ae100000-0000-4000-8000-000000000002';
  sched uuid := 'ae300000-0000-4000-8000-000000000001'; brief uuid := 'ae300000-0000-4000-8000-000000000002'; yt uuid := 'ae300000-0000-4000-8000-000000000003';
  idea uuid := 'ae200000-0000-4000-8000-000000000001'; source uuid := 'ae200000-0000-4000-8000-000000000002';
  req uuid := 'ae500000-0000-4000-8000-000000000001'; selection jsonb; outcome jsonb; replay jsonb; script_out jsonb; j public.studio_jobs%rowtype; a uuid; op text;
begin
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('service_role','public.studio_schedule_executions',op) then raise exception 'Mutable schedule execution ledger'; end if;
  end loop;
  if has_table_privilege('authenticated','public.studio_schedule_executions','SELECT')
    or has_function_privilege('authenticated','public.studio_run_schedule_now(text,text,text,uuid,bigint,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.studio_run_schedule_now(text,text,text,uuid,bigint,uuid,jsonb,boolean)','EXECUTE') then raise exception 'Unsafe execution grants'; end if;
  perform public.studio_create_substo_location(w,'Schedule execution fixture','schedule-owner');
  perform public.studio_create_substo_location(other_w,'Other schedule fixture','schedule-other');
  insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role) values(w,'substo','schedule-member','member');
  perform public.studio_save_schedule(w,sched,0,'substo','schedule-owner','idea-review','Saved audience focus',24,'09:00');
  perform public.studio_save_schedule(w,brief,0,'substo','schedule-owner','script-brief','Saved brief focus',168,'09:00');
  perform public.studio_save_schedule(w,yt,0,'substo','schedule-owner','youtube-discovery','Search',24,'09:00');
  if exists(select 1 from public.studio_jobs where location_id=w) then raise exception 'Draft save enqueued work'; end if;
  insert into public.studio_records(location_id,id,kind,title,payload) values
    (w,idea,'content','Schedule idea','{"stage":"idea","script":"Existing human script"}'),
    (w,source,'reference','Schedule research','{"notes":"Saved supporting evidence"}');
  selection := jsonb_build_array(jsonb_build_object('id',idea,'version',1));
  begin perform public.studio_run_schedule_now(w,'estio','schedule-owner',sched,1,req,selection,true);
    raise exception 'Wrong realm execution'; exception when sqlstate '42501' then null; end;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-other',sched,1,req,selection,true);
    raise exception 'Non-member execution'; exception when sqlstate '42501' then null; end;
  begin perform public.studio_run_schedule_now(other_w,'substo','schedule-other',sched,1,req,selection,true);
    raise exception 'Foreign schedule execution'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-owner',sched,1,req,selection,false);
    raise exception 'Unconfirmed execution'; exception when sqlstate '22023' then null; end;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-owner',sched,2,req,selection,true);
    raise exception 'Stale schedule execution'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-owner',yt,1,req,selection,true);
    raise exception 'YouTube scheduled without a personal grant'; exception when sqlstate '22023' then null; end;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-owner',brief,1,req,selection,true);
    raise exception 'Unsourced brief'; exception when sqlstate '22023' then null; end;
  if exists(select 1 from public.studio_jobs where location_id=w) or exists(select 1 from public.studio_schedule_executions where location_id=w) then raise exception 'Failed command left rows'; end if;
  insert into public.studio_record_links values(w,idea,source);
  outcome := public.studio_run_schedule_now(w,'substo','schedule-member',sched,1,req,selection,true);
  if outcome->>'workflow'<>'idea_review' or (select snapshot->>'focus' from public.studio_idea_reviews where id=(outcome->>'reviewId')::uuid)<>'Saved audience focus'
    or (select created_by_clerk_user_id from public.studio_schedule_executions where id=(outcome->>'executionId')::uuid)<>'schedule-member' then raise exception 'Lost saved definition/actor'; end if;
  if (select count(*) from public.studio_jobs where location_id=w)<>1 then raise exception 'Extra jobs'; end if;
  if public.studio_run_schedule_now(w,'substo','schedule-member',sched,1,req,selection,true)<>outcome then raise exception 'Run replay failed'; end if;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-member',sched,1,gen_random_uuid(),selection,true);
    raise exception 'Second active run allowed'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-member',brief,1,req,selection,true);
    raise exception 'Request reused across schedules'; exception when unique_violation then null; end;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-owner',sched,1,req,selection,true);
    raise exception 'Request reused by another actor'; exception when unique_violation then null; end;
  -- Replay survives changed definitions/inputs, without minting new work.
  perform public.studio_save_schedule(w,sched,1,'substo','schedule-owner','script-brief','Later focus',168,'12:00');
  update public.studio_records set version=2 where location_id=w and id=idea;
  if public.studio_run_schedule_now(w,'substo','schedule-member',sched,1,req,selection,true)<>outcome
    or (select definition->>'focus' from public.studio_schedule_executions where id=(outcome->>'executionId')::uuid)<>'Saved audience focus' then raise exception 'Replay changed history'; end if;
  delete from public.studio_location_memberships where location_id=w and clerk_user_id='schedule-member';
  begin perform public.studio_run_schedule_now(w,'substo','schedule-member',sched,1,req,selection,true);
    raise exception 'Revoked actor replayed'; exception when sqlstate '42501' then null; end;
  begin perform public.studio_run_schedule_now(w,'substo','schedule-owner',brief,1,gen_random_uuid(),selection,true);
    raise exception 'Stale selected idea'; exception when sqlstate '40001' then null; end;
  selection := jsonb_build_array(jsonb_build_object('id',idea,'version',2));
  script_out := public.studio_run_schedule_now(w,'substo','schedule-owner',brief,1,gen_random_uuid(),selection,true);
  if (select kind from public.studio_jobs where id=(script_out->>'jobId')::uuid)<>'studio.script_brief'
    or (select payload->>'script' from public.studio_records where location_id=w and id=idea)<>'Existing human script' then raise exception 'Wrong workflow or automatic application'; end if;
  -- Terminal crash still blocks a fresh run until explicit reconciliation/replacement.
  insert into public.studio_location_ai_credentials(location_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
    values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','schedule-owner');
  perform public.studio_set_ai_budget(w,'substo','schedule-owner',1000000);
  perform public.studio_claim_jobs('schedule-worker',50,60);
  select * into j from public.studio_jobs where id=(outcome->>'jobId')::uuid;
  a := (public.studio_begin_text_run_attempt(w,(outcome->>'reviewId')::uuid,j.id,'schedule-worker',j.lease_token)->>'attempt_id')::uuid;
  update public.studio_jobs set attempts=max_attempts,lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
  perform public.studio_claim_jobs('schedule-worker',50,60);
  begin perform public.studio_run_schedule_now(w,'substo','schedule-owner',sched,2,gen_random_uuid(),selection,true);
    raise exception 'New command bypassed uncertain charge'; exception when sqlstate '40001' then null; end;
  perform public.studio_review_ai_attempt(w,'substo','schedule-owner',a,gen_random_uuid(),1,'no_charge','Synthetic provider evidence confirms no charge for the earlier request.',0,false);
  begin perform public.studio_run_schedule_now(w,'substo','schedule-owner',sched,2,gen_random_uuid(),selection,true);
    raise exception 'Billing review silently enabled another run'; exception when sqlstate '40001' then null; end;
  if (select count(*) from public.studio_schedule_executions where location_id=w)<>2 then raise exception 'Failed commands changed history'; end if;
end $$;
select 'Studio schedule execution assertions passed' as result;
