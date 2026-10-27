do $$
declare
  w text := 'ab100000-0000-4000-8000-000000000001'; other_w text := 'ab100000-0000-4000-8000-000000000002';
  idea uuid := 'ab200000-0000-4000-8000-000000000001'; source uuid := 'ab200000-0000-4000-8000-000000000002';
  req uuid := 'ab500000-0000-4000-8000-000000000001'; apply_req uuid := 'ab500000-0000-4000-8000-000000000002';
  run uuid; a uuid; usage uuid; j public.studio_jobs%rowtype; selection jsonb; outcome jsonb; applied jsonb; body jsonb; legacy jsonb; op text;
begin
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('service_role','public.studio_script_brief_applications',op) then raise exception 'Application audit is mutable'; end if;
  end loop;
  if has_table_privilege('authenticated','public.studio_script_brief_applications','SELECT')
    or has_function_privilege('authenticated','public.studio_apply_script_brief(text,text,text,uuid,uuid,bigint,boolean)','EXECUTE')
    or has_function_privilege('service_role','public.studio_enqueue_text_run(text,text,text,uuid,jsonb,text,boolean,text)','EXECUTE')
    or has_function_privilege('service_role','public.studio_validate_text_run_result(text,jsonb,jsonb)','EXECUTE') then raise exception 'Unsafe script grants'; end if;
  perform public.studio_create_substo_location(w,'Script fixture','brief-owner');
  perform public.studio_create_substo_location(other_w,'Other script fixture','brief-other');
  insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role) values(w,'substo','brief-member','member');
  insert into public.studio_records(location_id,id,kind,title,payload) values
    (w,idea,'content','Human title',jsonb_build_object('stage','idea','approved',true,'notes','Exact human notes','script',E'Previous script.\n','custom',jsonb_build_object('keep',true))),
    (w,source,'reference','Research',jsonb_build_object('url','https://example.com/source','notes','Saved evidence words'));
  selection := jsonb_build_array(jsonb_build_object('id',idea,'version',1));
  begin perform public.studio_enqueue_script_brief(w,'substo','brief-owner',req,selection,'AI',true);
    raise exception 'Unlinked unsourced script accepted'; exception when sqlstate '22023' then null; end;
  if exists(select 1 from public.studio_idea_reviews where location_id=w) or exists(select 1 from public.studio_jobs where location_id=w) then raise exception 'Failed enqueue left rows'; end if;
  insert into public.studio_record_links values(w,idea,source);
  begin perform public.studio_enqueue_script_brief(w,'substo','brief-other',req,selection,'AI',true);
    raise exception 'Non-member script enqueue'; exception when sqlstate '42501' then null; end;
  begin perform public.studio_enqueue_script_brief(w,'estio','brief-owner',req,selection,'AI',true);
    raise exception 'Wrong realm script enqueue'; exception when sqlstate '42501' then null; end;
  begin perform public.studio_enqueue_script_brief(other_w,'substo','brief-other',req,selection,'AI',true);
    raise exception 'Foreign idea accepted'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_enqueue_script_brief(w,'substo','brief-owner',req,selection,'AI',false);
    raise exception 'Unconfirmed paid script accepted'; exception when sqlstate '22023' then null; end;
  outcome := public.studio_enqueue_script_brief(w,'substo','brief-owner',req,selection,'AI',true); run := (outcome->>'reviewId')::uuid;
  if public.studio_enqueue_script_brief(w,'substo','brief-owner',req,selection,'AI',true)<>outcome then raise exception 'Enqueue replay'; end if;
  begin perform public.studio_enqueue_idea_review(w,'substo','brief-owner',req,selection,'AI',true);
    raise exception 'Cross-workflow request reuse'; exception when unique_violation then null; end;
  insert into public.studio_location_ai_credentials(location_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
    values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','brief-owner');
  perform public.studio_set_ai_budget(w,'substo','brief-owner',1000000);
  perform public.studio_claim_jobs('brief-worker',50,60); select * into j from public.studio_jobs where id=(outcome->>'jobId')::uuid;
  if j.kind<>'studio.script_brief' or (select prompt_version from public.studio_idea_reviews where id=run)<>'studio.script-brief.v1' then raise exception 'Wrong dispatch'; end if;
  begin perform public.studio_begin_idea_review_attempt(w,run,j.id,'brief-worker',j.lease_token);
    raise exception 'Legacy idea endpoint processed brief'; exception when sqlstate '40001' then null; end;
  a := (public.studio_begin_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token)->>'attempt_id')::uuid;
  select usage_id into usage from public.studio_ai_attempts where id=a;
  if (select operation from public.studio_ai_attempts where id=a)<>'script_brief' then raise exception 'Wrong metering operation'; end if;
  body := jsonb_build_object('audiencePromise','A useful method','angle','A practical angle','hook','Start here',
    'outline',jsonb_build_array('Problem','Method'),'claims',jsonb_build_array(jsonb_build_object('claim','A saved claim','sourceIds',jsonb_build_array(source),'verificationNeeded',true)),
    'verificationGaps',jsonb_build_array('Verify the source claim independently'),'script',E'First complete draft.\n[VERIFY: saved claim]');
  begin perform public.studio_finish_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token,a,jsonb_set(body,'{claims,0,sourceIds}',jsonb_build_array(idea)),1000,5000,'resp_brief','gpt-6-luna-standard-2026-10-23');
    raise exception 'Invented source accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.studio_finish_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token,a,jsonb_set(jsonb_set(body,'{claims,0,sourceIds}','[]'),'{claims,0,verificationNeeded}','false'),1000,5000,'resp_brief','gpt-6-luna-standard-2026-10-23');
    raise exception 'Unsupported unmarked claim accepted'; exception when sqlstate '22023' then null; end;
  if (select status from public.studio_ai_usage where id=usage)<>'reserved' then raise exception 'Failed output settled'; end if;
  perform public.studio_finish_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token,a,body,1000,5000,'resp_brief','gpt-6-luna-standard-2026-10-23');
  perform public.studio_finish_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token,a,body,1000,5000,'resp_brief','gpt-6-luna-standard-2026-10-23');
  perform public.studio_complete_job(j.id,'brief-worker',j.lease_token,'{}');
  if (select payload->>'script' from public.studio_records where location_id=w and id=idea)<>E'Previous script.\n'
    or (select cost_micros from public.studio_ai_usage where id=usage)<>2600 then raise exception 'Generation mutated content or usage'; end if;
  begin perform public.studio_apply_script_brief(w,'substo','brief-owner',run,apply_req,1,false);
    raise exception 'Unconfirmed draft apply'; exception when sqlstate '22023' then null; end;
  begin perform public.studio_apply_script_brief(w,'estio','brief-owner',run,apply_req,1,true);
    raise exception 'Wrong realm apply'; exception when sqlstate '42501' then null; end;
  begin perform public.studio_apply_script_brief(other_w,'substo','brief-other',run,apply_req,1,true);
    raise exception 'Foreign draft apply'; exception when sqlstate '22023' then null; end;
  -- A source changes after generation. Correct content version alone is insufficient.
  update public.studio_records set version=2 where location_id=w and id=source;
  begin perform public.studio_apply_script_brief(w,'substo','brief-owner',run,apply_req,1,true);
    raise exception 'Changed source applied'; exception when sqlstate '40001' then null; end;
  if exists(select 1 from public.studio_script_brief_applications where location_id=w) then raise exception 'Failed apply appended audit'; end if;

  outcome := public.studio_enqueue_script_brief(w,'substo','brief-owner',gen_random_uuid(),selection,'fresh',true); run := (outcome->>'reviewId')::uuid;
  perform public.studio_claim_jobs('brief-worker',50,60); select * into j from public.studio_jobs where id=(outcome->>'jobId')::uuid;
  a := (public.studio_begin_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token)->>'attempt_id')::uuid;
  perform public.studio_finish_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token,a,body,1000,5000,'resp_fresh','gpt-6-luna-standard-2026-10-23');
  perform public.studio_complete_job(j.id,'brief-worker',j.lease_token,'{}');
  applied := public.studio_apply_script_brief(w,'substo','brief-member',run,apply_req,1,true);
  if (select payload->>'script' from public.studio_records where location_id=w and id=idea)<>body->>'script'
    or (select payload->>'stage' from public.studio_records where location_id=w and id=idea)<>'script'
    or (select approved from public.studio_records where location_id=w and id=idea)
    or (select title from public.studio_records where location_id=w and id=idea)<>'Human title'
    or (select payload->>'notes' from public.studio_records where location_id=w and id=idea)<>'Exact human notes'
    or (select payload->'custom' from public.studio_records where location_id=w and id=idea)<>'{"keep":true}'::jsonb
    or (select count(*) from public.studio_record_links where location_id=w and source_id=idea)<>1 then raise exception 'Apply changed unrelated content'; end if;
  if (select previous_script#>>'{}' from public.studio_script_brief_applications where review_id=run)<>E'Previous script.\n'
    or (select record_version from public.studio_script_brief_applications where review_id=run)<>2 then raise exception 'Lossy application audit'; end if;
  -- A lost apply response followed by human edits must not apply again.
  update public.studio_records set payload=payload||'{"script":"Later human script"}',version=3 where location_id=w and id=idea;
  if public.studio_apply_script_brief(w,'substo','brief-member',run,apply_req,1,true)<>applied
    or (select payload->>'script' from public.studio_records where location_id=w and id=idea)<>'Later human script' then raise exception 'Replay overwrote newer edit'; end if;
  begin perform public.studio_apply_script_brief(w,'substo','brief-member',run,gen_random_uuid(),3,true);
    raise exception 'Applied the same brief twice'; exception when sqlstate '40001' then null; end;
  delete from public.studio_location_memberships where location_id=w and clerk_user_id='brief-member';
  begin perform public.studio_apply_script_brief(w,'substo','brief-member',run,apply_req,1,true);
    raise exception 'Revoked member replayed apply'; exception when sqlstate '42501' then null; end;

  update public.studio_records set payload=payload||'{"stage":"idea"}',version=4 where location_id=w and id=idea;
  selection := jsonb_build_array(jsonb_build_object('id',idea,'version',4));
  outcome := public.studio_enqueue_script_brief(w,'substo','brief-owner',gen_random_uuid(),selection,'recovery',true); run := (outcome->>'reviewId')::uuid;
  perform public.studio_claim_jobs('brief-worker',50,60); select * into j from public.studio_jobs where id=(outcome->>'jobId')::uuid;
  a := (public.studio_begin_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token)->>'attempt_id')::uuid;
  update public.studio_jobs set attempts=max_attempts,lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
  perform public.studio_claim_jobs('brief-worker',50,60);
  if (select status from public.studio_ai_attempts where id=a)<>'uncertain' then raise exception 'Brief crash not recovered'; end if;
  perform public.studio_review_ai_attempt(w,'substo','brief-owner',a,gen_random_uuid(),1,'billed','Synthetic provider evidence confirms an earlier billed brief request.',151,false);
  perform public.studio_review_ai_attempt(w,'substo','brief-owner',a,gen_random_uuid(),2,'authorize_replacement','Explicitly authorize another paid draft after billing reconciliation.',null,true);
  perform public.studio_claim_jobs('brief-worker',50,60); select * into j from public.studio_jobs where id=j.id;
  a := (public.studio_begin_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token)->>'attempt_id')::uuid;
  perform public.studio_finish_text_run_attempt(w,run,j.id,'brief-worker',j.lease_token,a,body,1000,5000,'resp_replacement','gpt-6-luna-standard-2026-10-23');
  perform public.studio_complete_job(j.id,'brief-worker',j.lease_token,'{}');
  if (select sum(cost_micros) from public.studio_ai_usage where location_id=w)<>7951 then raise exception 'Brief replacement lost earlier usage'; end if;
  -- The legacy idea entry points still validate and meter idea output after upgrade.
  outcome := public.studio_enqueue_idea_review(w,'substo','brief-owner',gen_random_uuid(),selection,'legacy idea',true); run := (outcome->>'reviewId')::uuid;
  perform public.studio_claim_jobs('brief-worker',50,60); select * into j from public.studio_jobs where id=(outcome->>'jobId')::uuid;
  a := (public.studio_begin_idea_review_attempt(w,run,j.id,'brief-worker',j.lease_token)->>'attempt_id')::uuid;
  legacy := jsonb_build_object('recommendation',idea,'reason','A good idea','verificationGap','Verify the source','scores',jsonb_build_array(jsonb_build_object('ideaId',idea,'relevance',3,'evidence',2,'timeliness',3,'differentiation',3,'ease',4,'rationale','Needs more evidence','sourceIds',jsonb_build_array(source))));
  perform public.studio_finish_idea_review_attempt(w,run,j.id,'brief-worker',j.lease_token,a,legacy,1000,100,'resp_legacy','gpt-6-luna-standard-2026-10-23');
  perform public.studio_complete_job(j.id,'brief-worker',j.lease_token,'{}');
end; $$;
select 'Studio script brief assertions passed' as result;
