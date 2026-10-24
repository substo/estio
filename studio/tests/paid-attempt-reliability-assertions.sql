-- Synthetic data only; final schema assertions after historical upgrade checks.
do $$
declare
  w uuid := 'c1000000-0000-4000-8000-000000000001';
  r uuid := 'c2000000-0000-4000-8000-000000000001';
  up uuid := 'c3000000-0000-4000-8000-000000000001';
  up2 uuid := 'c3000000-0000-4000-8000-000000000002';
  u public.studio_uploads%rowtype; j public.studio_jobs%rowtype; old_token uuid;
  a jsonb; aid uuid; usage uuid; tbl text; op text;
begin
  foreach tbl in array array['studio_transcription_attempts'] loop
    foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('service_role','public.'||tbl,op) then raise exception 'Unsafe direct write on %',tbl; end if;
    end loop;
    if has_table_privilege('authenticated','public.'||tbl,'SELECT') then raise exception 'Browser attempt read'; end if;
  end loop;
  if to_regprocedure('public.studio_complete_job(uuid,text,jsonb)') is not null
    or to_regprocedure('public.studio_extend_job_lease(uuid,text,integer)') is not null
    or to_regprocedure('public.studio_fail_job(uuid,text,text,text,boolean,integer)') is not null then raise exception 'Unfenced job overload'; end if;
  if has_function_privilege('service_role','public.studio_save_transcript_chunk(uuid,uuid,integer,numeric,numeric,text,text,jsonb)','EXECUTE')
    or has_function_privilege('service_role','public.studio_save_transcript(uuid,uuid,text,text,numeric)','EXECUTE')
    or has_function_privilege('service_role','public.studio_release_ai_spend(uuid,uuid)','EXECUTE')
    or has_function_privilege('service_role','public.studio_settle_ai_spend(uuid,uuid,bigint,text,bigint,bigint,numeric)','EXECUTE')
    or has_function_privilege('service_role','public.studio_reserve_ai_spend(uuid,text,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.studio_begin_transcription_attempt(uuid,uuid,uuid,text,uuid,integer,numeric)','EXECUTE')
    or has_function_privilege('service_role','public.studio_lock_transcription_lease(uuid,uuid,uuid,text,uuid)','EXECUTE') then raise exception 'Unfenced spend/transcript or unsafe RPC grant'; end if;

  perform public.studio_create_substo_workspace(w,'Reliability fixture','reliability-owner');
  insert into public.studio_records(workspace_id,id,kind,title,payload) values(w,r,'content','Audio','{}');
  insert into public.studio_workspace_ai_credentials(workspace_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
    values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','reliability-owner');
  perform public.studio_set_ai_budget(w,'substo','reliability-owner',1000000);
  perform public.studio_create_upload(w,'substo','reliability-owner',up,r,'test.ogg','audio/ogg',100,'studio-media');
  u := public.studio_complete_upload(w,'substo','reliability-owner',up,100);
  perform public.studio_claim_jobs('reliable-worker',50,60);
  select * into j from public.studio_jobs where id=u.transcription_job_id;
  if j.lease_token is null then raise exception 'Claim has no generation'; end if;

  -- Cross-workspace/upload and wrong-generation writes cannot create a hold.
  begin perform public.studio_begin_transcription_attempt('a1000000-0000-4000-8000-000000000001',up,j.id,'reliable-worker',j.lease_token,0,600);
    raise exception 'Foreign workspace accepted'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',gen_random_uuid(),0,600);
    raise exception 'Wrong generation accepted'; exception when sqlstate '40001' then null; end;
  if exists(select 1 from public.studio_ai_usage where workspace_id=w) then raise exception 'Failed fence left a hold'; end if;

  a := public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,0,600);
  aid := (a->>'attempt_id')::uuid;
  select usage_id into usage from public.studio_transcription_attempts where id=aid;
  if a->>'outcome' <> 'started' or (select status from public.studio_ai_usage where id=usage) <> 'reserved' then raise exception 'Missing durable reservation'; end if;
  if public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,0,600)->>'outcome' <> 'uncertain' then raise exception 'Started attempt replayed'; end if;
  -- Result write failure rolls back both chunk and settlement.
  begin perform public.studio_finish_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,aid,'hello','{}');
    raise exception 'Bad result accepted'; exception when check_violation then null; end;
  if exists(select 1 from public.studio_transcript_chunks where upload_id=up) or (select status from public.studio_ai_usage where id=usage) <> 'reserved' then raise exception 'Partial commit'; end if;
  perform public.studio_finish_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,aid,'hello','[]');
  -- Lost DB response: replay result commit and start do not call the provider.
  perform public.studio_finish_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,aid,'hello','[]');
  perform public.studio_close_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,aid,false);
  if public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,0,600)->>'outcome' <> 'saved'
    or (select status from public.studio_transcription_attempts where id=aid) <> 'succeeded'
    or (select cost_micros from public.studio_ai_usage where id=usage) <> 60000 then raise exception 'Commit replay corrupted spend'; end if;
  begin perform public.studio_finish_upload_transcript(w,up,j.id,'reliable-worker',j.lease_token,'whisper-1','en',610);
    raise exception 'Incomplete transcript assembled'; exception when sqlstate '22023' then null; end;

  -- An explicit rejection releases only its own hold and permits a fresh attempt.
  a := public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,1,10);
  aid := (a->>'attempt_id')::uuid;
  select usage_id into usage from public.studio_transcription_attempts where id=aid;
  perform public.studio_close_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,aid,true);
  if (select status from public.studio_ai_usage where id=usage) <> 'released' then raise exception 'Rejection retained hold'; end if;
  a := public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,1,10);
  aid := (a->>'attempt_id')::uuid;
  select usage_id into usage from public.studio_transcription_attempts where id=aid;

  -- Process death after begin/send: expiry fences writes before ANY reclaim.
  old_token := j.lease_token;
  update public.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
  if public.studio_extend_job_lease(j.id,'reliable-worker',old_token,60) or public.studio_complete_job(j.id,'reliable-worker',old_token,'{}')
    or public.studio_fail_job(j.id,'reliable-worker',old_token,'test_failure','x',false,null) <> 'lease_lost' then raise exception 'Expired job mutated'; end if;
  begin perform public.studio_finish_transcription_attempt(w,up,j.id,'reliable-worker',old_token,aid,'late','[]');
    raise exception 'Expired lease saved result'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_close_transcription_attempt(w,up,j.id,'reliable-worker',old_token,aid,true);
    raise exception 'Expired lease freed spend'; exception when sqlstate '40001' then null; end;
  begin perform public.studio_finish_upload_transcript(w,up,j.id,'reliable-worker',old_token,'whisper-1','en',600);
    raise exception 'Expired lease assembled'; exception when sqlstate '40001' then null; end;
  -- Reuse the same worker ID: generation still fences the stale execution.
  perform public.studio_claim_jobs('reliable-worker',50,60);
  select * into j from public.studio_jobs where id=j.id;
  if j.lease_token=old_token then raise exception 'Generation reused'; end if;
  if public.studio_complete_job(j.id,'reliable-worker',old_token,'{}') then raise exception 'Stale same-worker completion'; end if;
  if (select status from public.studio_transcription_attempts where id=aid) <> 'uncertain'
    or (select status from public.studio_ai_usage where id=usage) <> 'reserved' then raise exception 'Crash lost uncertainty/hold'; end if;
  if public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,1,10)->>'outcome' <> 'uncertain' then raise exception 'Crash retried provider'; end if;
  -- Manual job retry never bypasses an uncertain chunk.
  perform public.studio_fail_job(j.id,'reliable-worker',j.lease_token,'transcription_outcome_uncertain','Review required',false,null);
  perform public.studio_member_job_action(w,'substo','reliability-owner',j.id,'retry');
  perform public.studio_claim_jobs('reliable-worker',50,60);
  select * into j from public.studio_jobs where id=j.id;
  if public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,1,10)->>'outcome' <> 'uncertain' then raise exception 'Manual retry bypass'; end if;

  -- Unknown spend still counts against the cap; it is never released by retry.
  perform public.studio_set_ai_budget(w,'substo','reliability-owner',61000);
  if public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,2,10)->>'outcome' <> 'budget_exhausted' then
    raise exception 'Uncertain hold ignored by budget'; end if;
  perform public.studio_set_ai_budget(w,'substo','reliability-owner',1000000);

  -- Last-attempt crashes are recovered even when the job cannot retry again.
  a := public.studio_begin_transcription_attempt(w,up,j.id,'reliable-worker',j.lease_token,2,10);
  aid := (a->>'attempt_id')::uuid;
  update public.studio_jobs set attempts=max_attempts,lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
  perform public.studio_claim_jobs('reliable-worker',50,60);
  if (select status from public.studio_jobs where id=j.id) <> 'failed'
    or (select status from public.studio_transcription_attempts where id=aid) <> 'uncertain' then raise exception 'Final crash not recovered'; end if;
  if public.studio_recover_transcription_attempts() <> 0 then raise exception 'Recovery not idempotent'; end if;

  -- Successful final assembly, including JS fractional subtraction rounding.
  perform public.studio_create_upload(w,'substo','reliability-owner',up2,r,'second.ogg','audio/ogg',100,'studio-media');
  u := public.studio_complete_upload(w,'substo','reliability-owner',up2,100);
  perform public.studio_claim_jobs('reliable-worker',50,60);
  select * into j from public.studio_jobs where id=u.transcription_job_id;
  a := public.studio_begin_transcription_attempt(w,up2,j.id,'reliable-worker',j.lease_token,0,600);
  perform public.studio_finish_transcription_attempt(w,up2,j.id,'reliable-worker',j.lease_token,(a->>'attempt_id')::uuid,'first','[]');
  a := public.studio_begin_transcription_attempt(w,up2,j.id,'reliable-worker',j.lease_token,1,10.04200000000003);
  perform public.studio_finish_transcription_attempt(w,up2,j.id,'reliable-worker',j.lease_token,(a->>'attempt_id')::uuid,'last','[]');
  if (public.studio_finish_upload_transcript(w,up2,j.id,'reliable-worker',j.lease_token,'whisper-1','en',610.042)).text <> 'first last'
    or not public.studio_complete_job(j.id,'reliable-worker',j.lease_token,'{}') then raise exception 'Final assembly failed'; end if;
end;
$$;
select 'Studio paid attempt reliability assertions passed' as result;
