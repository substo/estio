-- Synthetic source text, imported units and owned-upload transcript fixtures.
create function pg_temp.finish_extraction(run_id uuid, body jsonb) returns uuid language plpgsql as $$
declare r studio.studio_idea_reviews%rowtype; j studio.studio_jobs%rowtype; a uuid;
begin
 select * into r from studio.studio_idea_reviews where id=run_id;
 perform studio.studio_claim_jobs('extract-worker',50,60);select * into j from studio.studio_jobs where id=r.job_id;
 a:=(studio.studio_begin_text_run_attempt(r.location_id,r.id,j.id,'extract-worker',j.lease_token)->>'attempt_id')::uuid;
 perform studio.studio_finish_text_run_attempt(r.location_id,r.id,j.id,'extract-worker',j.lease_token,a,body,1000,1000,'resp_extract_fixture','gpt-6-luna-standard-2026-10-23');
 perform studio.studio_complete_job(j.id,'extract-worker',j.lease_token,'{}');return a;
end $$;
do $$
declare
 w text:='bc100000-0000-4000-8000-000000000001';other_w text:='bc100000-0000-4000-8000-000000000002';
 source uuid:='bc200000-0000-4000-8000-000000000001';other_source uuid:='bc200000-0000-4000-8000-000000000009';
 topic uuid:='bc600000-0000-4000-8000-000000000001';existing uuid:='bc610000-0000-4000-8000-000000000001';
 sidecar uuid:='bc620000-0000-4000-8000-000000000001';unit_id uuid:='bc630000-0000-4000-8000-000000000001';
 upload uuid:='bc640000-0000-4000-8000-000000000001';
 req uuid:='bc500000-0000-4000-8000-000000000001';apply_req uuid:='bc500000-0000-4000-8000-000000000002';
 out jsonb;out2 jsonb;run uuid;a uuid;j studio.studio_jobs%rowtype;body jsonb;applied jsonb;new_insight uuid;evidence jsonb;root_text text;op text;u studio.studio_uploads%rowtype;
begin
 foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
  if has_table_privilege('service_role','studio.studio_knowledge_extraction_applications',op) or has_table_privilege('service_role','studio.studio_knowledge_extraction_findings',op)
    or has_table_privilege('service_role','studio.studio_knowledge_evidence',op) or has_table_privilege('service_role','studio.studio_knowledge_sources',op)
    or has_table_privilege('service_role','studio.studio_knowledge_source_units',op) then raise exception 'Unsafe extraction direct write';end if;
 end loop;
 if has_function_privilege('authenticated','studio.studio_enqueue_knowledge_extraction(text,text,text,uuid,uuid,bigint,text,text,integer,integer,text,boolean)','EXECUTE')
  or has_function_privilege('service_role','studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text)','EXECUTE') then raise exception 'Unsafe extraction function grants';end if;
 perform studio.studio_create_substo_location(w,'Extraction fixture','extract-owner');perform studio.studio_create_substo_location(other_w,'Other extraction fixture','extract-other');
 insert into studio.studio_location_members(location_id,location_app,clerk_user_id,role) values(w,'substo','extract-member','member');
 root_text:=repeat('a',1999)||'🙂'||'B café e'||chr(769)||'. quote words';
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,source,'reference','Source',jsonb_build_object('transcript',root_text,'url','https://example.com/source','custom','preserved')),
  (w,other_source,'reference','Other source','{}');
 insert into studio.studio_knowledge_topics values(w,topic,'{"name":"Existing topic","custom":"preserved"}');
 insert into studio.studio_knowledge_sources values(w,source,'{"title":"Imported source metadata","custom":"preserved"}',99,17);
 insert into studio.studio_knowledge_insights(location_id,id,source_id,topic_id,status,statement,payload,version)
  values(w,existing,source,topic,'approved','Existing approved statement','{"kind":"claim","custom":"preserved"}',7);
 insert into studio.studio_knowledge_reviews values(w,gen_random_uuid(),existing,'{"action":"approve","at":"2026-01-01T00:00:00Z","custom":"preserved"}');
 insert into studio.studio_location_ai_credentials(location_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
  values(w,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','extract-owner');
 perform studio.studio_set_ai_budget(w,'substo','extract-owner',1000000);
 begin perform studio.studio_enqueue_knowledge_extraction(w,'substo','extract-other',req,source,1,'record_text','transcript',1,1,'Methods',true);
  raise exception 'Non-member extracted';exception when sqlstate '42501' then null;end;
 begin perform studio.studio_enqueue_knowledge_extraction(w,'estio','extract-owner',req,source,1,'record_text','transcript',1,1,'Methods',true);
  raise exception 'Wrong realm extracted';exception when sqlstate '42501' then null;end;
 begin perform studio.studio_enqueue_knowledge_extraction(other_w,'substo','extract-other',req,source,1,'record_text','transcript',1,1,'Methods',true);
  raise exception 'Foreign source extracted';exception when sqlstate '40001' then null;end;
 begin perform studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',req,source,2,'record_text','transcript',1,1,'Methods',true);
  raise exception 'Stale source extracted';exception when sqlstate '40001' then null;end;
 begin perform studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',req,source,1,'record_text','transcript',1,9,'Methods',true);
  raise exception 'Unbounded source extracted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',req,source,1,'record_text','transcript',1,1,'Methods',false);
  raise exception 'Unconfirmed spend';exception when sqlstate '22023' then null;end;
 out:=studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',req,source,1,'record_text','transcript',1,1,'Methods',true);run:=(out->>'reviewId')::uuid;
 if studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',req,source,1,'record_text','transcript',1,1,'Methods',true)<>out then raise exception 'Extraction enqueue replay';end if;
 if (select snapshot#>>'{units,0,startChar}' from studio.studio_idea_reviews where id=run)<>'2000'
  or (select snapshot#>>'{units,0,text}' from studio.studio_idea_reviews where id=run) not like 'B café%' then raise exception 'Unicode character chunk was split incorrectly';end if;
 body:=jsonb_build_object('findings',jsonb_build_array(
  jsonb_build_object('kind','claim','unitId','record_text:transcript:1','statement','Existing approved statement','suggestedTopic','Proposed topic','quote','café'),
  jsonb_build_object('kind','method','unitId','record_text:transcript:1','statement','A new pending method','suggestedTopic','Proposed topic','quote','café')));
 perform studio.studio_claim_jobs('extract-worker',50,60);select * into j from studio.studio_jobs where id=(out->>'jobId')::uuid;
 a:=(studio.studio_begin_text_run_attempt(w,run,j.id,'extract-worker',j.lease_token)->>'attempt_id')::uuid;
 begin perform studio.studio_finish_text_run_attempt(w,run,j.id,'extract-worker',j.lease_token,a,jsonb_set(body,'{findings,0,quote}','"invented quote"'),1000,1000,'resp_bad','gpt-6-luna-standard-2026-10-23');
  raise exception 'Invented quote saved';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_finish_text_run_attempt(w,run,j.id,'extract-worker',j.lease_token,a,jsonb_set(body,'{findings,0,unitId}','"foreign-unit"'),1000,1000,'resp_bad','gpt-6-luna-standard-2026-10-23');
  raise exception 'Foreign unit saved';exception when sqlstate '22023' then null;end;
 if (select usage_row.status from studio.studio_ai_usage usage_row join studio.studio_ai_attempts x on x.usage_id=usage_row.id where x.id=a)<>'reserved' then raise exception 'Failed output settled usage';end if;
 perform studio.studio_finish_text_run_attempt(w,run,j.id,'extract-worker',j.lease_token,a,body,1000,1000,'resp_extract','gpt-6-luna-standard-2026-10-23');
 perform studio.studio_complete_job(j.id,'extract-worker',j.lease_token,'{}');
 if (select count(*) from studio.studio_knowledge_insights where location_id=w)<>1 then raise exception 'Generation applied knowledge automatically';end if;
 begin perform studio.studio_apply_knowledge_extraction(w,'substo','extract-owner',run,apply_req,1,'[0]',false);
  raise exception 'Implicit pending application';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_apply_knowledge_extraction(other_w,'substo','extract-other',run,apply_req,1,'[0]',true);
  raise exception 'Foreign pending application';exception when sqlstate '22023' then null;end;
 applied:=studio.studio_apply_knowledge_extraction(w,'substo','extract-member',run,apply_req,1,'[0]',true);
 if applied#>>'{findings,0,insightId}'<>existing::text or applied#>>'{findings,0,reused}'<>'true'
  or (select status from studio.studio_knowledge_insights where location_id=w and id=existing)<>'approved'
  or (select version from studio.studio_knowledge_insights where location_id=w and id=existing)<>7
  or (select topic_id from studio.studio_knowledge_insights where location_id=w and id=existing)<>topic then raise exception 'Exact match changed existing knowledge';end if;
 if (select count(*) from studio.studio_knowledge_reviews where location_id=w and insight_id=existing)<>1 then raise exception 'Existing review history changed';end if;
 if studio.studio_apply_knowledge_extraction(w,'substo','extract-member',run,apply_req,1,'[0]',true)<>applied then raise exception 'Application replay changed';end if;
 out2:=studio.studio_apply_knowledge_extraction(w,'substo','extract-member',run,gen_random_uuid(),1,'[1]',true);new_insight:=(out2#>>'{findings,0,insightId}')::uuid;
 if (select status from studio.studio_knowledge_insights where location_id=w and id=new_insight)<>'pending'
  or (select topic_id from studio.studio_knowledge_insights where location_id=w and id=new_insight) is not null then raise exception 'New finding approved or assigned a topic';end if;
 select payload into evidence from studio.studio_knowledge_evidence where location_id=w and insight_id=new_insight;
 if evidence->>'quote'<>'café' or (evidence->>'char_start')::integer<>2002 or (evidence->>'char_end')::integer<>2006 then raise exception 'Inexact Unicode citation %',evidence;end if;
 perform studio.studio_review_knowledge_insight(w,new_insight,'approve',1,'substo','extract-owner','Human review');
 perform studio.studio_apply_knowledge_extraction(w,'substo','extract-member',run,gen_random_uuid(),1,'[1]',true);
 if (select status from studio.studio_knowledge_insights where location_id=w and id=new_insight)<>'approved' then raise exception 'Reapplication reset review';end if;
 if (select covered_units from studio.studio_knowledge_sources where location_id=w and id=source)<>17
  or (select payload->>'custom' from studio.studio_knowledge_sources where location_id=w and id=source)<>'preserved'
  -- Approval files the insight under its suggested topic (knowledge edit/topics), hence 2.
  or (select count(*) from studio.studio_knowledge_topics where location_id=w)<>2
  or (select payload->>'transcript' from studio.studio_records where location_id=w and id=source)<>root_text then raise exception 'Application changed source/topic metadata';end if;
 delete from studio.studio_location_members where location_id=w and clerk_user_id='extract-member';
 begin perform studio.studio_apply_knowledge_extraction(w,'substo','extract-member',run,apply_req,1,'[0]',true);
  raise exception 'Revoked member replayed application';exception when sqlstate '42501' then null;end;
 -- Direct underlying changes without a record version bump are still detected.
 begin
  update studio.studio_records set payload=payload||'{"transcript":"Different source text"}' where location_id=w and id=source;
  if not (studio.studio_knowledge_extraction_state(w,'substo','extract-owner',run)->>'stale')::boolean then raise exception 'Content fingerprint ignored';end if;
  perform studio.studio_apply_knowledge_extraction(w,'substo','extract-owner',run,gen_random_uuid(),1,'[1]',true);
  raise exception 'Changed source applied';
 exception when sqlstate '40001' then null;end;

 -- Imported units preserve IDs/times but never send frame/OCR payloads to the model.
 insert into studio.studio_knowledge_source_unit_sidecars values(w,sidecar,source,'speech-fixture','{}');
 insert into studio.studio_knowledge_source_units values(w,unit_id,sidecar,source,'speech-fixture',0,'{"unit":{"text":"Speaker source words","start":10,"end":12,"frameFile":"private-frame.png","ocr":"DO NOT PROCESS OCR"}}');
 out:=studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',gen_random_uuid(),source,1,'source_units','speech-fixture',0,1,'',true);run:=(out->>'reviewId')::uuid;
 if (select snapshot::text from studio.studio_idea_reviews where id=run) like '%private-frame%' or (select snapshot::text from studio.studio_idea_reviews where id=run) like '%DO NOT PROCESS%' then raise exception 'Visual payload sent to model';end if;
 body:=jsonb_build_object('findings',jsonb_build_array(jsonb_build_object('kind','claim','unitId',unit_id,'statement','The speaker asserts a source claim','suggestedTopic','Source topic','quote','Speaker source words')));
 a:=pg_temp.finish_extraction(run,body);
 begin
  update studio.studio_knowledge_source_units set payload=jsonb_set(payload,'{unit,text}','"Changed words"') where location_id=w and id=unit_id;
  perform studio.studio_apply_knowledge_extraction(w,'substo','extract-owner',run,gen_random_uuid(),1,'[0]',true);
  raise exception 'Changed imported unit applied';exception when sqlstate '40001' then null;end;
 out2:=studio.studio_apply_knowledge_extraction(w,'substo','extract-owner',run,gen_random_uuid(),1,'[0]',true);
 select payload into evidence from studio.studio_knowledge_evidence where location_id=w and insight_id=(out2#>>'{findings,0,insightId}')::uuid;
 if evidence->>'unit_id'<>unit_id::text or evidence->>'start_sec'<>'10' or evidence->>'timing_precision'<>'unit' then raise exception 'Imported unit citation lost';end if;

 -- Owned upload transcription intake remains compatible and supplies an input.
 perform studio.studio_create_upload(w,'substo','extract-owner',upload,source,'my.ogg','audio/ogg',100,'studio-media');
 u:=studio.studio_complete_upload(w,'substo','extract-owner',upload,100);perform studio.studio_claim_jobs('extract-worker',50,60);select * into j from studio.studio_jobs where id=u.transcription_job_id;
 a:=(studio.studio_begin_transcription_attempt(w,upload,j.id,'extract-worker',j.lease_token,0,4)->>'attempt_id')::uuid;
 perform studio.studio_finish_transcription_attempt(w,upload,j.id,'extract-worker',j.lease_token,a,'Own uploaded words','[]');
 perform studio.studio_finish_upload_transcript(w,upload,j.id,'extract-worker',j.lease_token,'whisper-1','en',4);
 perform studio.studio_complete_job(j.id,'extract-worker',j.lease_token,'{}');
 begin perform studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',gen_random_uuid(),other_source,1,'upload_transcript',upload::text,0,1,'',true);
  raise exception 'Upload transcript crossed source records';exception when sqlstate '22023' then null;end;
 out:=studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',gen_random_uuid(),source,1,'upload_transcript',upload::text,0,1,'',true);run:=(out->>'reviewId')::uuid;
 body:=jsonb_build_object('findings',jsonb_build_array(jsonb_build_object('kind','example','unitId','upload_transcript:'||upload::text||':0','statement','The upload contains an example','suggestedTopic','Examples','quote','Own uploaded words')));
 a:=pg_temp.finish_extraction(run,body);
 out2:=studio.studio_apply_knowledge_extraction(w,'substo','extract-owner',run,gen_random_uuid(),1,'[0]',true);
 if (select payload->>'input_id' from studio.studio_knowledge_evidence where location_id=w and insight_id=(out2#>>'{findings,0,insightId}')::uuid)<>upload::text then raise exception 'Upload citation identity lost';end if;
 -- Empty findings are a successful paid outcome, without pending inserts.
 out:=studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',gen_random_uuid(),source,1,'record_text','transcript',0,1,'',true);run:=(out->>'reviewId')::uuid;
 a:=pg_temp.finish_extraction(run,'{"findings":[]}');
 begin perform studio.studio_apply_knowledge_extraction(w,'substo','extract-owner',run,gen_random_uuid(),1,'[0]',true);
  raise exception 'Unknown empty result applied';exception when sqlstate '22023' then null;end;
 if jsonb_array_length(studio.studio_knowledge_extraction_inputs(w,'substo','extract-owner',source)->'inputs')<>3 then raise exception 'Missing extraction input choices';end if;

 -- Knowledge extraction shares terminal crash recovery and explicit replacement.
 out:=studio.studio_enqueue_knowledge_extraction(w,'substo','extract-owner',gen_random_uuid(),source,1,'source_units','speech-fixture',0,1,'recovery',true);run:=(out->>'reviewId')::uuid;
 perform studio.studio_claim_jobs('extract-worker',50,60);select * into j from studio.studio_jobs where id=(out->>'jobId')::uuid;
 a:=(studio.studio_begin_text_run_attempt(w,run,j.id,'extract-worker',j.lease_token)->>'attempt_id')::uuid;
 update studio.studio_jobs set attempts=max_attempts,lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
 perform studio.studio_claim_jobs('extract-worker',50,60);
 if (select status from studio.studio_ai_attempts where id=a)<>'uncertain' then raise exception 'Extraction crash not recovered';end if;
 perform studio.studio_review_ai_attempt(w,'substo','extract-owner',a,gen_random_uuid(),1,'billed','Synthetic provider billing evidence for the missing extraction outcome.',151,false);
 perform studio.studio_member_job_action(w,'substo','extract-owner',j.id,'retry');perform studio.studio_claim_jobs('extract-worker',50,60);select * into j from studio.studio_jobs where id=j.id;
 if studio.studio_begin_text_run_attempt(w,run,j.id,'extract-worker',j.lease_token)->>'outcome'<>'reconciled' then raise exception 'Knowledge billing implicitly allowed resend';end if;
 perform studio.studio_fail_job(j.id,'extract-worker',j.lease_token,'ai_replacement_required','Review required',false,null);
 perform studio.studio_review_ai_attempt(w,'substo','extract-owner',a,gen_random_uuid(),2,'authorize_replacement','Explicitly authorize a replacement extraction after confirmed billing.',null,true);
 a:=pg_temp.finish_extraction(run,'{"findings":[]}');

end $$;
select 'Studio knowledge extraction assertions passed' as result;
