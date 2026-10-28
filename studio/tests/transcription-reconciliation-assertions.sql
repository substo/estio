-- Synthetic manager evidence only. No real provider billing assertions.
do $$
declare
  w text := 'd1000000-0000-4000-8000-000000000001';
  other_w text := 'd1000000-0000-4000-8000-000000000002';
  r uuid := 'd2000000-0000-4000-8000-000000000001';
  up uuid := 'd3000000-0000-4000-8000-000000000001';
  request_id uuid := 'd4000000-0000-4000-8000-000000000001';
  authorize_id uuid := 'd4000000-0000-4000-8000-000000000002';
  evidence text := 'Synthetic provider support case 123 confirms no charge for this attempt.';
  j studio.studio_jobs%rowtype; u studio.studio_uploads%rowtype; a uuid; a2 uuid; old_usage uuid;
  v jsonb; replay jsonb; old_token uuid; n integer; op text;
begin
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('service_role','studio.studio_transcription_reviews',op) then raise exception 'Mutable review log'; end if;
  end loop;
  if has_table_privilege('authenticated','studio.studio_transcription_reviews','SELECT')
    or has_function_privilege('authenticated','studio.studio_review_transcription_attempt(text,text,text,uuid,uuid,bigint,text,text,bigint,boolean)','EXECUTE')
    or not has_function_privilege('service_role','studio.studio_review_transcription_attempt(text,text,text,uuid,uuid,bigint,text,text,bigint,boolean)','EXECUTE') then raise exception 'Unsafe review grants'; end if;

  perform studio.studio_create_substo_location(w,'Reconciliation fixture','review-owner');
  perform studio.studio_create_substo_location(other_w,'Other review fixture','review-other');
  insert into studio.studio_location_members(location_id,location_app,clerk_user_id,role)
    values(w,'substo','review-member','member'),(w,'substo','review-admin','admin');
  insert into studio.studio_records(location_id,id,kind,title,payload) values(w,r,'content','Audio','{}');
  insert into studio.studio_location_ai_credentials(location_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
    values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','review-owner');
  perform studio.studio_set_ai_budget(w,'substo','review-owner',1000000);
  perform studio.studio_create_upload(w,'substo','review-owner',up,r,'test.ogg','audio/ogg',100,'studio-media');
  u := studio.studio_complete_upload(w,'substo','review-owner',up,100);
  perform studio.studio_claim_jobs('review-worker',50,60);
  select * into j from studio.studio_jobs where id=u.transcription_job_id;
  a := (studio.studio_begin_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,0,600)->>'attempt_id')::uuid;
  select usage_id into old_usage from studio.studio_transcription_attempts where id=a;
  old_token := j.lease_token;
  begin perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,request_id,1,'no_charge',evidence,0,false);
    raise exception 'Live worker reviewed'; exception when sqlstate '40001' then null; end;
  update studio.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;

  begin perform studio.studio_review_transcription_attempt(w,'substo','review-member',a,request_id,1,'no_charge',evidence,0,false);
    raise exception 'Member reviewed'; exception when sqlstate '42501' then null; end;
  begin perform studio.studio_review_transcription_attempt(w,'estio','review-owner',a,request_id,1,'no_charge',evidence,0,false);
    raise exception 'Wrong realm reviewed'; exception when sqlstate '42501' then null; end;
  begin perform studio.studio_review_transcription_attempt(other_w,'substo','review-other',a,request_id,1,'no_charge',evidence,0,false);
    raise exception 'Foreign location reviewed'; exception when sqlstate '22023' then null; end;
  delete from studio.studio_location_members where location_id=w and clerk_user_id='review-admin';
  begin perform studio.studio_review_transcription_attempt(w,'substo','review-admin',a,request_id,1,'no_charge',evidence,0,false);
    raise exception 'Revoked manager reviewed'; exception when sqlstate '42501' then null; end;
  begin perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,request_id,1,'no_charge','timeout',0,false);
    raise exception 'No evidence accepted'; exception when sqlstate '22023' then null; end;
  begin perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,request_id,1,'authorize_replacement',evidence,null,true);
    raise exception 'Unreconciled replacement authorized'; exception when sqlstate '40001' then null; end;
  if exists(select 1 from studio.studio_transcription_reviews where location_id=w) or (select status from studio.studio_ai_usage where id=old_usage) <> 'reserved' then raise exception 'Denied review changed state'; end if;

  v := studio.studio_review_transcription_attempt(w,'substo','review-owner',a,request_id,1,'no_charge',evidence,0,false);
  if (select status from studio.studio_ai_usage where id=old_usage) <> 'released'
    or (select billing_outcome from studio.studio_transcription_attempts where id=a) <> 'no_charge'
    or (select status from studio.studio_jobs where id=j.id) <> 'failed' then raise exception 'No-charge review incomplete'; end if;
  -- Lost response replay is the exact same event, even with its old version.
  replay := studio.studio_review_transcription_attempt(w,'substo','review-owner',a,request_id,1,'no_charge',evidence,0,false);
  if v <> replay or (select count(*) from studio.studio_transcription_reviews where location_id=w) <> 1 then raise exception 'Review replay changed state'; end if;
  begin perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,request_id,1,'billed',evidence,100,false);
    raise exception 'Request ID reused'; exception when unique_violation then null; end;
  begin perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,gen_random_uuid(),1,'authorize_replacement',evidence,null,true);
    raise exception 'Stale version accepted'; exception when sqlstate '40001' then null; end;
  begin perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,gen_random_uuid(),2,'authorize_replacement',evidence,null,false);
    raise exception 'Implicit replacement accepted'; exception when sqlstate '22023' then null; end;
  begin perform studio.studio_finish_transcription_attempt(w,up,j.id,'review-worker',old_token,a,'late','[]');
    raise exception 'Old worker completed reconciled attempt'; exception when sqlstate '40001' then null; end;
  -- Ordinary member retry cannot turn a billing decision into paid authority.
  perform studio.studio_member_job_action(w,'substo','review-member',j.id,'retry');
  perform studio.studio_claim_jobs('review-worker',50,60);
  select * into j from studio.studio_jobs where id=j.id;
  if studio.studio_begin_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,0,600)->>'outcome' <> 'reconciled' then raise exception 'Billing decision unblocked resend'; end if;
  perform studio.studio_fail_job(j.id,'review-worker',j.lease_token,'transcription_outcome_uncertain','Review required',false,null);
  v := studio.studio_review_transcription_attempt(w,'substo','review-owner',a,authorize_id,2,'authorize_replacement',evidence,null,true);
  select count(*) into n from studio.studio_job_events where job_id=j.id and event='requeued';
  replay := studio.studio_review_transcription_attempt(w,'substo','review-owner',a,authorize_id,2,'authorize_replacement',evidence,null,true);
  if replay <> v or (select count(*) from studio.studio_job_events where job_id=j.id and event='requeued') <> n then raise exception 'Duplicate authorization requeued'; end if;
  perform studio.studio_claim_jobs('review-worker',50,60);
  select * into j from studio.studio_jobs where id=j.id;
  -- Replay after reclaim must not reset a running job or create a second paid call.
  perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,authorize_id,2,'authorize_replacement',evidence,null,true);
  if (select status from studio.studio_jobs where id=j.id) <> 'running' then raise exception 'Replay interrupted running job'; end if;
  a2 := (studio.studio_begin_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,0,600)->>'attempt_id')::uuid;
  if a2=a or a2 is null then raise exception 'Replacement did not get distinct durable attempt'; end if;
  perform studio.studio_finish_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,a2,'first','[]');

  a := (studio.studio_begin_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,1,10)->>'attempt_id')::uuid;
  select usage_id into old_usage from studio.studio_transcription_attempts where id=a;
  perform studio.studio_close_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,a,false);
  perform studio.studio_fail_job(j.id,'review-worker',j.lease_token,'transcription_outcome_uncertain','Review required',false,null);
  -- Provider evidence can settle above the original estimate; original month stays.
  update studio.studio_ai_usage set usage_month='2026-01-01' where id=old_usage;
  perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,gen_random_uuid(),1,'billed','Synthetic provider billing record confirms 0.001800 USD for this chunk.',1800,false);
  if (select cost_micros from studio.studio_ai_usage where id=old_usage) <> 1800
    or (select usage_month from studio.studio_ai_usage where id=old_usage) <> '2026-01-01' then raise exception 'Confirmed usage incorrect'; end if;
  begin perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,gen_random_uuid(),2,'no_charge',evidence,0,false);
    raise exception 'Confirmed billing overwritten'; exception when sqlstate '40001' then null; end;
  perform studio.studio_review_transcription_attempt(w,'substo','review-owner',a,gen_random_uuid(),2,'authorize_replacement',evidence,null,true);
  perform studio.studio_claim_jobs('review-worker',50,60);
  select * into j from studio.studio_jobs where id=j.id;
  if studio.studio_begin_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,0,600)->>'outcome' <> 'saved' then raise exception 'Successful chunk rebilled'; end if;
  a2 := (studio.studio_begin_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,1,10)->>'attempt_id')::uuid;
  perform studio.studio_finish_transcription_attempt(w,up,j.id,'review-worker',j.lease_token,a2,'last','[]');
  if (select sum(cost_micros) from studio.studio_ai_usage where location_id=w) <> 62800 then raise exception 'Original and replacement charges not retained'; end if;
  if (studio.studio_finish_upload_transcript(w,up,j.id,'review-worker',j.lease_token,'whisper-1','en',610)).text <> 'first last' then raise exception 'Recovery failed to produce transcript'; end if;
  if (select count(*) from studio.studio_transcription_reviews where location_id=w) <> 4 then raise exception 'Missing audit history'; end if;
end;
$$;
select 'Studio transcription reconciliation assertions passed' as result;
