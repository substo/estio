-- Synthetic fixtures. Upgrade, isolation, paid accounting and advisory results.
do $$
declare
  w text := 'f1000000-0000-4000-8000-000000000001';
  other_w text := 'f1000000-0000-4000-8000-000000000002';
  idea uuid := 'f2000000-0000-4000-8000-000000000001';
  source uuid := 'f2000000-0000-4000-8000-000000000002';
  req uuid := 'f5000000-0000-4000-8000-000000000001';
  review uuid; j studio.studio_jobs%rowtype; a uuid; usage uuid; body jsonb; selection jsonb; outcome jsonb; replay jsonb; n integer; op text; legacy_up uuid := 'f6000000-0000-4000-8000-000000000001';
begin
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('service_role','studio.studio_idea_reviews',op) or has_table_privilege('service_role','studio.studio_ai_attempts',op)
      or has_table_privilege('service_role','studio.studio_ai_attempt_reviews',op) then raise exception 'Unsafe direct AI write'; end if;
  end loop;
  if has_function_privilege('authenticated','studio.studio_enqueue_idea_review(text,text,text,uuid,jsonb,text,boolean)','EXECUTE')
    or has_function_privilege('service_role','studio.studio_lock_idea_review_lease(text,uuid,uuid,text,uuid)','EXECUTE')
    or has_table_privilege('authenticated','studio.studio_idea_reviews','SELECT') then raise exception 'Unsafe AI grants'; end if;
  perform studio.studio_create_substo_location(w,'Idea review fixture','idea-owner');
  perform studio.studio_create_substo_location(other_w,'Other ideas','idea-other');
  insert into studio.studio_location_members(location_id,location_app,clerk_user_id,role) values(w,'substo','idea-member','member');
  insert into studio.studio_records(location_id,id,kind,title,payload) values
    (w,idea,'content','A useful idea','{"stage":"idea","notes":"User notes"}'),
    (w,source,'reference','Research','{"url":"https://example.com/source","transcript":"Saved source words"}');
  insert into studio.studio_record_links values(w,idea,source);
  selection := jsonb_build_array(jsonb_build_object('id',idea,'version',1));
  begin perform studio.studio_enqueue_idea_review(w,'substo','idea-other',req,selection,'AI',true);
    raise exception 'Non-member enqueued'; exception when sqlstate '42501' then null; end;
  begin perform studio.studio_enqueue_idea_review(w,'estio','idea-owner',req,selection,'AI',true);
    raise exception 'Wrong realm enqueued'; exception when sqlstate '42501' then null; end;
  begin perform studio.studio_enqueue_idea_review(other_w,'substo','idea-other',req,selection,'AI',true);
    raise exception 'Foreign record enqueued'; exception when sqlstate '40001' then null; end;
  begin perform studio.studio_enqueue_idea_review(w,'substo','idea-owner',req,selection,'AI',false);
    raise exception 'Implicit spend'; exception when sqlstate '22023' then null; end;
  begin perform studio.studio_enqueue_idea_review(w,'substo','idea-owner',req,jsonb_build_array(jsonb_build_object('id',idea,'version',9)),'AI',true);
    raise exception 'Stale input selected'; exception when sqlstate '40001' then null; end;
  outcome := studio.studio_enqueue_idea_review(w,'substo','idea-member',req,selection,'AI',true);
  review := (outcome->>'reviewId')::uuid;
  if (select snapshot->'ideas'->0->'sources'->0->>'excerpt' from studio.studio_idea_reviews where id=review)<>'Saved source words' then raise exception 'Snapshot lost research'; end if;
  replay := studio.studio_enqueue_idea_review(w,'substo','idea-member',req,selection,'AI',true);
  if replay<>outcome then raise exception 'Duplicate enqueue'; end if;
  begin perform studio.studio_enqueue_idea_review(w,'substo','idea-member',req,selection,'changed',true);
    raise exception 'Request ID reused'; exception when unique_violation then null; end;
  perform studio.studio_claim_jobs('idea-worker',50,60);
  select * into j from studio.studio_jobs where id=(outcome->>'jobId')::uuid;
  if studio.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'outcome'<>'budget_exhausted' then raise exception 'Unfunded call permitted'; end if;
  insert into studio.studio_location_ai_credentials(location_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
    values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','idea-owner');
  perform studio.studio_set_ai_budget(w,'substo','idea-owner',1000000);
  begin perform studio.studio_begin_idea_review_attempt(other_w,review,j.id,'idea-worker',j.lease_token);
    raise exception 'Cross-location attempt'; exception when sqlstate '40001' then null; end;
  a := (studio.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'attempt_id')::uuid;
  select usage_id into usage from studio.studio_ai_attempts where id=a;
  if (select reserved_micros from studio.studio_ai_usage where id=usage)<>10000 then raise exception 'Missing durable hold'; end if;
  if exists(select 1 from studio.studio_transcription_attempts where id=a) then raise exception 'Legacy view includes text attempts'; end if;
  if studio.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'outcome'<>'uncertain' then raise exception 'Paid call replayed'; end if;
  body := jsonb_build_object('recommendation',idea,'reason','Best supported idea','verificationGap','Verify source claims',
    'scores',jsonb_build_array(jsonb_build_object('ideaId',idea,'relevance',4,'evidence',2,'timeliness',3,'differentiation',4,'ease',5,'rationale','Useful with incomplete evidence','sourceIds',jsonb_build_array(source))));
  begin perform studio.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body-'verificationGap',1001,100,'resp_fixture','gpt-6-luna-standard-2026-10-23');
    raise exception 'Malformed result saved'; exception when sqlstate '22023' then null; end;
  begin perform studio.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,jsonb_set(body,'{scores,0,sourceIds}',jsonb_build_array(idea)),1001,100,'resp_fixture','gpt-6-luna-standard-2026-10-23');
    raise exception 'Invented citation saved'; exception when sqlstate '22023' then null; end;
  if (select status from studio.studio_ai_usage where id=usage)<>'reserved' or (select result from studio.studio_idea_reviews where id=review) is not null then raise exception 'Invalid output partially committed'; end if;
  -- Edit while the paid call is in flight. Save historical advisory output only.
  update studio.studio_records set version=2,payload=payload||'{"notes":"New human notes"}' where location_id=w and id=idea;
  perform studio.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body,1001,100,'resp_fixture','gpt-6-luna-standard-2026-10-23');
  perform studio.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body,1001,100,'resp_fixture','gpt-6-luna-standard-2026-10-23');
  if not (select stale_at_completion from studio.studio_idea_reviews where id=review)
    or (select cost_micros from studio.studio_ai_usage where id=usage)<>151
    or (select payload->>'notes' from studio.studio_records where location_id=w and id=idea)<>'New human notes' then raise exception 'Unsafe advisory commit'; end if;
  if studio.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'outcome'<>'saved' then raise exception 'Committed result not reused'; end if;
  perform studio.studio_complete_job(j.id,'idea-worker',j.lease_token,'{}');
  -- Enqueue replay must still work after current record versions changed.
  if studio.studio_enqueue_idea_review(w,'substo','idea-member',req,selection,'AI',true)<>outcome then raise exception 'Replay depended on current content'; end if;

  selection := jsonb_build_array(jsonb_build_object('id',idea,'version',2));
  outcome := studio.studio_enqueue_idea_review(w,'substo','idea-owner',gen_random_uuid(),selection,'second',true);
  review := (outcome->>'reviewId')::uuid;
  perform studio.studio_claim_jobs('idea-worker',50,60);
  select * into j from studio.studio_jobs where id=(outcome->>'jobId')::uuid;
  a := (studio.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'attempt_id')::uuid;
  select usage_id into usage from studio.studio_ai_attempts where id=a;
  -- Crash recovery is now shared, even at the final attempt.
  update studio.studio_jobs set attempts=max_attempts,lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
  perform studio.studio_claim_jobs('idea-worker',50,60);
  if (select status from studio.studio_ai_attempts where id=a)<>'uncertain' or (select status from studio.studio_ai_usage where id=usage)<>'reserved' then raise exception 'Text crash lost hold'; end if;
  begin perform studio.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body,1001,100,'late','gpt-6-luna-standard-2026-10-23');
    raise exception 'Expired text worker saved'; exception when sqlstate '40001' then null; end;
  begin perform studio.studio_review_ai_attempt(w,'substo','idea-member',a,gen_random_uuid(),1,'no_charge','Synthetic support case confirms no provider processing.',0,false);
    raise exception 'Member reconciled paid text call'; exception when sqlstate '42501' then null; end;
  perform studio.studio_review_ai_attempt(w,'substo','idea-owner',a,gen_random_uuid(),1,'billed','Synthetic provider billing confirms 0.000151 USD for this request.',151,false);
  if (select model from studio.studio_ai_usage where id=usage)<>'gpt-6-luna' then raise exception 'Text reconciliation billed as audio'; end if;
  perform studio.studio_member_job_action(w,'substo','idea-member',j.id,'retry');
  perform studio.studio_claim_jobs('idea-worker',50,60);
  select * into j from studio.studio_jobs where id=j.id;
  if studio.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'outcome'<>'reconciled' then raise exception 'Text billing implicitly authorized resend'; end if;
  perform studio.studio_fail_job(j.id,'idea-worker',j.lease_token,'ai_replacement_required','Review required',false,null);
  perform studio.studio_review_ai_attempt(w,'substo','idea-owner',a,gen_random_uuid(),2,'authorize_replacement','Explicitly authorize a second paid text review for this missing result.',null,true);
  perform studio.studio_claim_jobs('idea-worker',50,60);
  select * into j from studio.studio_jobs where id=j.id;
  a := (studio.studio_begin_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token)->>'attempt_id')::uuid;
  perform studio.studio_finish_idea_review_attempt(w,review,j.id,'idea-worker',j.lease_token,a,body,1001,100,'resp_second','gpt-6-luna-standard-2026-10-23');
  if (select sum(cost_micros) from studio.studio_ai_usage where location_id=w)<>453 then raise exception 'Replacement lost earlier spend'; end if;
  select count(*) into n from studio.studio_ai_attempt_reviews where location_id=w;
  if n<>2 then raise exception 'Missing shared reconciliation audit'; end if;
  -- Actual legacy transcription RPC success after the table-to-view upgrade.
  perform studio.studio_create_upload(w,'substo','idea-owner',legacy_up,idea,'audio.ogg','audio/ogg',100,'studio-media');
  perform studio.studio_complete_upload(w,'substo','idea-owner',legacy_up,100);
  perform studio.studio_claim_jobs('legacy-after-upgrade',50,60);
  select * into j from studio.studio_jobs where location_id=w and kind='studio.transcribe_upload';
  a := (studio.studio_begin_transcription_attempt(w,legacy_up,j.id,'legacy-after-upgrade',j.lease_token,0,10)->>'attempt_id')::uuid;
  perform studio.studio_finish_transcription_attempt(w,legacy_up,j.id,'legacy-after-upgrade',j.lease_token,a,'Legacy audio result','[]');
  if (studio.studio_finish_upload_transcript(w,legacy_up,j.id,'legacy-after-upgrade',j.lease_token,'whisper-1','en',10)).text<>'Legacy audio result' then
    raise exception 'Legacy transcription upgrade regressed'; end if;
end; $$;
select 'Studio hosted idea review assertions passed' as result;
