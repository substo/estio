-- Synthetic fixtures. Upgrade, isolation, paid accounting and advisory results.
do $$
declare
  w uuid := 'f1000000-0000-4000-8000-000000000001';
  other_w uuid := 'f1000000-0000-4000-8000-000000000002';
  idea uuid := 'f2000000-0000-4000-8000-000000000001';
  source uuid := 'f2000000-0000-4000-8000-000000000002';
  req uuid := 'f5000000-0000-4000-8000-000000000001';
  review uuid; j public.studio_jobs%rowtype; a uuid; usage uuid; body jsonb; selection jsonb; outcome jsonb; replay jsonb; n integer; op text; legacy_up uuid := 'f6000000-0000-4000-8000-000000000001';
begin
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('service_role','public.studio_idea_reviews',op) or has_table_privilege('service_role','public.studio_ai_attempts',op)
      or has_table_privilege('service_role','public.studio_ai_attempt_reviews',op) then raise exception 'Unsafe direct AI write'; end if;
  end loop;
  if has_function_privilege('authenticated','public.studio_enqueue_idea_review(uuid,text,text,uuid,jsonb,text,boolean)','EXECUTE')
    or has_function_privilege('service_role','public.studio_lock_idea_review_lease(uuid,uuid,uuid,text,uuid)','EXECUTE')
    or has_table_privilege('authenticated','public.studio_idea_reviews','SELECT') then raise exception 'Unsafe AI grants'; end if;
  perform public.studio_create_substo_workspace(w,'Idea review fixture','idea-owner');
  perform public.studio_create_substo_workspace(other_w,'Other ideas','idea-other');
  insert into public.studio_workspace_memberships(workspace_id,workspace_brand,clerk_user_id,role) values(w,'substo','idea-member','member');
  insert into public.studio_records(workspace_id,id,kind,title,payload) values
    (w,idea,'content','A useful idea','{"stage":"idea","notes":"User notes"}'),
    (w,source,'reference','Research','{"url":"https://example.com/source","transcript":"Saved source words"}');
  insert into public.studio_record_links values(w,idea,source);
  selection := jsonb_build_array(jsonb_build_object('id',idea,'version',1));
  begin perform public.studio_enqueue_idea_review(w,'substo','idea-other',req,selection,'AI',true);
    raise exception 'Non-member enqueued'; exception when sqlstate '42501' then null; end;
  begin perform public.studio_enqueue_idea_review(w,'estio','idea-owner',req,selection,'AI',true);
    raise exception 'Wrong realm enqueued'; exception when sqlstate '42501' then null; end;
  begin perform public.studio_enqueue_idea_review(other_w,'substo','idea-other',req,selection,'AI',true);
    raise exception 'Foreign record enqueued'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_enqueue_idea_review(w,'substo','idea-owner',req,selection,'AI',false);
    raise exception 'Implicit spend'; exception when sqlstate '22023' then null; end;
  begin perform public.studio_enqueue_idea_review(w,'substo','idea-owner',req,jsonb_build_array(jsonb_build_object('id',idea,'version',9)),'AI',true);
    raise exception 'Stale input selected'; exception when sqlstate '40001' then null; end;
  outcome := public.studio_enqueue_idea_review(w,'substo','idea-member',req,selection,'AI',true);
  review := (outcome->>'reviewId')::uuid;
  if (select snapshot->'ideas'->0->'sources'->0->>'excerpt' from public.studio_idea_reviews where id=review)<>'Saved source words' then raise exception 'Snapshot lost research'; end if;
  replay := public.studio_enqueue_idea_review(w,'substo','idea-member',req,selection,'AI',true);
  if replay<>outcome then raise exception 'Duplicate enqueue'; end if;
  begin perform public.studio_enqueue_idea_review(w,'substo','idea-member',req,selection,'changed',true);
    raise exception 'Request ID reused'; exception when unique_violation then null; end;
  perform public.studio_claim_jobs('idea-worker',50,60);
  select * into j from public.studio_jobs where id=(outcome->>'jobId')::uuid;
  if public.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'outcome'<>'budget_exhausted' then raise exception 'Unfunded call permitted'; end if;
  insert into public.studio_workspace_ai_credentials(workspace_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
    values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','idea-owner');
  perform public.studio_set_ai_budget(w,'substo','idea-owner',1000000);
  begin perform public.studio_begin_idea_review_attempt(other_w,review,j.id,'idea-worker',j.lease_token);
    raise exception 'Cross-workspace attempt'; exception when sqlstate '40001' then null; end;
  a := (public.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'attempt_id')::uuid;
  select usage_id into usage from public.studio_ai_attempts where id=a;
  if (select reserved_micros from public.studio_ai_usage where id=usage)<>10000 then raise exception 'Missing durable hold'; end if;
  if exists(select 1 from public.studio_transcription_attempts where id=a) then raise exception 'Legacy view includes text attempts'; end if;
  if public.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'outcome'<>'uncertain' then raise exception 'Paid call replayed'; end if;
  body := jsonb_build_object('recommendation',idea,'reason','Best supported idea','verificationGap','Verify source claims',
    'scores',jsonb_build_array(jsonb_build_object('ideaId',idea,'relevance',4,'evidence',2,'timeliness',3,'differentiation',4,'ease',5,'rationale','Useful with incomplete evidence','sourceIds',jsonb_build_array(source))));
  begin perform public.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body-'verificationGap',1001,100,'resp_fixture','gpt-6-luna-standard-2026-10-23');
    raise exception 'Malformed result saved'; exception when sqlstate '22023' then null; end;
  begin perform public.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,jsonb_set(body,'{scores,0,sourceIds}',jsonb_build_array(idea)),1001,100,'resp_fixture','gpt-6-luna-standard-2026-10-23');
    raise exception 'Invented citation saved'; exception when sqlstate '22023' then null; end;
  if (select status from public.studio_ai_usage where id=usage)<>'reserved' or (select result from public.studio_idea_reviews where id=review) is not null then raise exception 'Invalid output partially committed'; end if;
  -- Edit while the paid call is in flight. Save historical advisory output only.
  update public.studio_records set version=2,payload=payload||'{"notes":"New human notes"}' where workspace_id=w and id=idea;
  perform public.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body,1001,100,'resp_fixture','gpt-6-luna-standard-2026-10-23');
  perform public.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body,1001,100,'resp_fixture','gpt-6-luna-standard-2026-10-23');
  if not (select stale_at_completion from public.studio_idea_reviews where id=review)
    or (select cost_micros from public.studio_ai_usage where id=usage)<>151
    or (select payload->>'notes' from public.studio_records where workspace_id=w and id=idea)<>'New human notes' then raise exception 'Unsafe advisory commit'; end if;
  if public.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'outcome'<>'saved' then raise exception 'Committed result not reused'; end if;
  perform public.studio_complete_job(j.id,'idea-worker',j.lease_token,'{}');
  -- Enqueue replay must still work after current record versions changed.
  if public.studio_enqueue_idea_review(w,'substo','idea-member',req,selection,'AI',true)<>outcome then raise exception 'Replay depended on current content'; end if;

  selection := jsonb_build_array(jsonb_build_object('id',idea,'version',2));
  outcome := public.studio_enqueue_idea_review(w,'substo','idea-owner',gen_random_uuid(),selection,'second',true);
  review := (outcome->>'reviewId')::uuid;
  perform public.studio_claim_jobs('idea-worker',50,60);
  select * into j from public.studio_jobs where id=(outcome->>'jobId')::uuid;
  a := (public.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'attempt_id')::uuid;
  select usage_id into usage from public.studio_ai_attempts where id=a;
  -- Crash recovery is now shared, even at the final attempt.
  update public.studio_jobs set attempts=max_attempts,lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
  perform public.studio_claim_jobs('idea-worker',50,60);
  if (select status from public.studio_ai_attempts where id=a)<>'uncertain' or (select status from public.studio_ai_usage where id=usage)<>'reserved' then raise exception 'Text crash lost hold'; end if;
  begin perform public.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body,1001,100,'late','gpt-6-luna-standard-2026-10-23');
    raise exception 'Expired text worker saved'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_review_ai_attempt(w,'substo','idea-member',a,gen_random_uuid(),1,'no_charge','Synthetic support case confirms no provider processing.',0,false);
    raise exception 'Member reconciled paid text call'; exception when sqlstate '42501' then null; end;
  perform public.studio_review_ai_attempt(w,'substo','idea-owner',a,gen_random_uuid(),1,'billed','Synthetic provider billing confirms 0.000151 USD for this request.',151,false);
  if (select model from public.studio_ai_usage where id=usage)<>'gpt-6-luna' then raise exception 'Text reconciliation billed as audio'; end if;
  perform public.studio_member_job_action(w,'substo','idea-member',j.id,'retry');
  perform public.studio_claim_jobs('idea-worker',50,60);
  select * into j from public.studio_jobs where id=j.id;
  if public.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'outcome'<>'reconciled' then raise exception 'Text billing implicitly authorized resend'; end if;
  perform public.studio_fail_job(j.id,'idea-worker',j.lease_token,'ai_replacement_required','Review required',false,null);
  perform public.studio_review_ai_attempt(w,'substo','idea-owner',a,gen_random_uuid(),2,'authorize_replacement','Explicitly authorize a second paid text review for this missing result.',null,true);
  perform public.studio_claim_jobs('idea-worker',50,60);
  select * into j from public.studio_jobs where id=j.id;
  a := (public.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'attempt_id')::uuid;
  perform public.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body,1001,100,'resp_second','gpt-6-luna-standard-2026-10-23');
  if (select sum(cost_micros) from public.studio_ai_usage where workspace_id=w)<>453 then raise exception 'Replacement lost earlier spend'; end if;
  select count(*) into n from public.studio_ai_attempt_reviews where workspace_id=w;
  if n<>2 then raise exception 'Missing shared reconciliation audit'; end if;
  -- Actual legacy transcription RPC success after the table-to-view upgrade.
  perform public.studio_create_upload(w,'substo','idea-owner',legacy_up,idea,'audio.ogg','audio/ogg',100,'studio-media');
  perform public.studio_complete_upload(w,'substo','idea-owner',legacy_up,100);
  perform public.studio_claim_jobs('legacy-after-upgrade',50,60);
  select * into j from public.studio_jobs where workspace_id=w and kind='studio.transcribe_upload';
  a := (public.studio_begin_transcription_attempt(w,legacy_up,j.id,'legacy-after-upgrade',j.lease_token,0,10)->>'attempt_id')::uuid;
  perform public.studio_finish_transcription_attempt(w,legacy_up,j.id,'legacy-after-upgrade',j.lease_token,a,'Legacy audio result','[]');
  if (public.studio_finish_upload_transcript(w,legacy_up,j.id,'legacy-after-upgrade',j.lease_token,'whisper-1','en',10)).text<>'Legacy audio result' then
    raise exception 'Legacy transcription upgrade regressed'; end if;
end; $$;
select 'Studio hosted idea review assertions passed' as result;
