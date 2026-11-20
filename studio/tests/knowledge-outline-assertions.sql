-- Same role, routing, and SQL lifecycle as production. Only model replies are fixtures.
DO $$
DECLARE loc text:='ac000000-0000-4000-8000-000000000021'; actor text:='outline-owner';
  src uuid:=gen_random_uuid(); raw_src uuid:=gen_random_uuid(); oversized_src uuid:=gen_random_uuid(); device uuid; digest text:=repeat('c',64);
  segments jsonb; transcript text; frames jsonb; cmd jsonb; approval jsonb; annotate jsonb; review jsonb; outline_data jsonb;
  outline_id uuid; child uuid; claimed jsonb; body jsonb; findings jsonb; output jsonb; batch_count integer;
  extra_src uuid:=gen_random_uuid(); sidecar uuid:=gen_random_uuid(); imported_unit uuid:=gen_random_uuid(); upload uuid:=gen_random_uuid();
  upload_row studio.studio_uploads%rowtype; upload_job studio.studio_jobs%rowtype; upload_attempt uuid;
  item jsonb; last_takeaway jsonb; first_takeaway jsonb; frame_takeaway jsonb; status_result jsonb; old_id uuid;
BEGIN
  PERFORM studio.studio_create_substo_location(loc,'Outline test',actor);
  device:=pg_temp.pair_text_device(loc,actor,'TEXTCCCC',digest);
  SELECT string_agg('Transcript passage '||i||' about recording useful video examples.',' ' ORDER BY i),
    jsonb_agg(jsonb_build_object('start',(i-1)*4,'end',i*4,'text','Transcript passage '||i||' about recording useful video examples.') ORDER BY i)
    INTO transcript,segments FROM generate_series(1,900) i;
  frames:='[{"time":94,"ocr":"Read the on-screen checklist","audioContext":"Speech context for the checklist","file":"private.jpg"}]';
  INSERT INTO studio.studio_records(location_id,id,kind,title,payload) VALUES
    (loc,src,'reference','Hour-long local video',jsonb_build_object('transcript',transcript,'transcriptEvidence',jsonb_build_object(
      'textSha256',encode(sha256(convert_to(transcript,'UTF8')),'hex'),'segments',segments,'frames',frames))),
    (loc,raw_src,'reference','Saved plain transcript',jsonb_build_object('transcript',repeat('Example text. ',1850))),
    (loc,oversized_src,'reference','Large input',jsonb_build_object('transcript',repeat('a',400001)));
  cmd:=jsonb_build_object('action','enqueueOutline','requestId',gen_random_uuid(),'sourceId',src,'expectedVersion',1,
    'mode','record_text','inputId','transcript','provider','subscription','confirmSubscription',true);
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd);
    RAISE EXCEPTION 'Old companion accepted outline';
  EXCEPTION WHEN SQLSTATE 'P2011' THEN NULL; END;
  UPDATE studio.studio_devices SET report=report||'{"knowledgeOutlineVersion":2}' WHERE id=device;
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'estio',actor,cmd);
    RAISE EXCEPTION 'Wrong realm accepted outline';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo','text-other',cmd);
    RAISE EXCEPTION 'Other Location accepted outline';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd||jsonb_build_object('sourceId',oversized_src));
    RAISE EXCEPTION 'Oversized input accepted outline';
  EXCEPTION WHEN SQLSTATE 'P2010' THEN NULL; END;
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd||'{"provider":"openai"}');
    RAISE EXCEPTION 'Subscription consent authorized paid work';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  review:=studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd);
  outline_id:=(review->>'outlineId')::uuid;
  IF studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd) IS DISTINCT FROM review THEN RAISE EXCEPTION 'Unstable enqueue replay'; END IF;
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd||jsonb_build_object('requestId',gen_random_uuid()));
    RAISE EXCEPTION 'Parallel generation for the same source';
  EXCEPTION WHEN SQLSTATE 'P2012' THEN NULL; END;
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd||jsonb_build_object('sourceId',raw_src));
    RAISE EXCEPTION 'Changed replay accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  outline_data:=studio.studio_get_knowledge_outline(loc,'substo',actor,outline_id);
  batch_count:=jsonb_array_length(outline_data->'batches');
  IF batch_count<15 OR outline_data->>'stale'<>'false'
      OR (SELECT sum(jsonb_array_length(b#>'{snapshot,units}')) FROM jsonb_array_elements(outline_data->'batches') b)<>901
      OR (SELECT count(DISTINCT u->>'unitIndex') FROM jsonb_array_elements(outline_data->'batches') b
        CROSS JOIN LATERAL jsonb_array_elements(b#>'{snapshot,units}') u)<>901 THEN RAISE EXCEPTION 'Full timed evidence is not covered'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(outline_data->'batches') b WHERE octet_length((b->'snapshot')::text)>24000
    OR b::text LIKE '%private.jpg%') THEN RAISE EXCEPTION 'Unbounded snapshot or private frame path sent'; END IF;
  BEGIN
    PERFORM studio.studio_get_knowledge_outline(loc,'substo','text-other',outline_id);
    RAISE EXCEPTION 'Other Location read outline';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,
      jsonb_build_object('action','approve','requestId',gen_random_uuid(),'outlineId',outline_id,
        'selections',jsonb_build_array(jsonb_build_object('reviewId',outline_data#>>'{batches,0,reviewId}','index',0)),'confirmApproval',true));
    RAISE EXCEPTION 'Approved an incomplete outline';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  FOR batch IN 1..batch_count LOOP
    claimed:=studio.studio_text_device_command(digest,'substo','claim','{"workerId":"outline-mac","limit":1,"leaseSeconds":60,"textReady":true}') -> 0;
    IF claimed#>>'{payload,promptVersion}' IS DISTINCT FROM 'studio.knowledge-extract.v2'
       OR claimed#>>'{payload,snapshot,inputId}' IS DISTINCT FROM outline_id::text THEN RAISE EXCEPTION 'Wrong subscription claim'; END IF;
    child:=(claimed#>>'{payload,reviewId}')::uuid;
    body:=jsonb_build_object('workerId','outline-mac','jobId',claimed->>'id','leaseToken',claimed->>'lease_token');
    findings:='[]';
    FOR item IN SELECT value FROM jsonb_array_elements(claimed#>'{payload,snapshot,units}') LOOP
      IF item->>'evidenceType'='ocr' THEN
        frame_takeaway:=jsonb_build_object('reviewId',child,'index',jsonb_array_length(findings));
        findings:=findings||jsonb_build_array(jsonb_build_object('kind','example','unitId',item->>'id','quote',item->>'text',
          'statement','A checklist appears on screen.','suggestedTopic','Recording','topicPath','["Recording","Examples","Checklists"]'::jsonb));
      ELSIF (item->>'unitIndex')::integer IN (0,900) THEN
        IF (item->>'unitIndex')::integer=0 THEN
          first_takeaway:=jsonb_build_object('reviewId',child,'index',jsonb_array_length(findings));
        ELSE
          last_takeaway:=jsonb_build_object('reviewId',child,'index',jsonb_array_length(findings));
        END IF;
        findings:=findings||jsonb_build_array(jsonb_build_object('kind','method','unitId',item->>'id','quote',item->>'text',
          'statement','The speaker discusses recording examples.','suggestedTopic','Recording','topicPath','["Recording","Examples","Practice","Demonstrations"]'::jsonb));
      END IF;
    END LOOP;
    IF jsonb_array_length(findings)>0 THEN
      BEGIN
        PERFORM studio.studio_text_device_command(digest,'substo','complete',body||jsonb_build_object('result',
          jsonb_build_object('provider','codex','model','native-default','output',
            jsonb_build_object('findings',jsonb_set(findings,'{0,quote}','"fabricated words"')))));
        RAISE EXCEPTION 'Invented quote accepted';
      EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN
        PERFORM studio.studio_text_device_command(digest,'substo','complete',body||jsonb_build_object('result',
          jsonb_build_object('provider','codex','model','native-default','output',
            jsonb_build_object('findings',jsonb_set(findings,'{0,topicPath}','[]')))));
        RAISE EXCEPTION 'Invalid topic path accepted';
      EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    END IF;
    output:=jsonb_build_object('provider','codex','model','native-default','output',jsonb_build_object('findings',findings));
    IF studio.studio_text_device_command(digest,'substo','complete',body||jsonb_build_object('result',output))<>'true' THEN
      RAISE EXCEPTION 'Batch completion failed';
    END IF;
  END LOOP;
  IF first_takeaway IS NULL OR last_takeaway IS NULL OR frame_takeaway IS NULL THEN RAISE EXCEPTION 'Fixture evidence missing'; END IF;
  IF EXISTS(SELECT 1 FROM studio.studio_knowledge_insights WHERE location_id=loc)
    OR EXISTS(SELECT 1 FROM studio.studio_ai_usage WHERE location_id=loc) THEN RAISE EXCEPTION 'Subscription charged or applied proposals'; END IF;

  annotate:=jsonb_build_object('action','annotate','requestId',gen_random_uuid(),'outlineId',outline_id,
    'nodeKey','topic:["Recording","Examples","Practice"]','note','Try this in our own video.','title','My practice routine','summary','Practice examples.','expectedVersion',0);
  status_result:=studio.studio_change_knowledge_outline(loc,'substo',actor,annotate);
  IF status_result->>'version'<>'1' OR studio.studio_change_knowledge_outline(loc,'substo',actor,annotate)<>status_result THEN
    RAISE EXCEPTION 'Note persistence or replay failed';
  END IF;
  BEGIN
    PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,annotate||jsonb_build_object('requestId',gen_random_uuid(),'note','Stale overwrite'));
    RAISE EXCEPTION 'Concurrent annotation overwrote note';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN
    PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,annotate||jsonb_build_object(
      'requestId',gen_random_uuid(),'nodeKey','topic:["Invented"]'));
    RAISE EXCEPTION 'Invented outline node accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,annotate||jsonb_build_object(
    'requestId',gen_random_uuid(),'nodeKey','unit:900','title','','summary',''));

  approval:=jsonb_build_object('action','approve','requestId',gen_random_uuid(),'outlineId',outline_id,
    'selections',jsonb_build_array(first_takeaway,frame_takeaway,last_takeaway),'confirmApproval',true);
  BEGIN
    PERFORM studio.studio_apply_knowledge_extraction(loc,'substo',actor,(first_takeaway->>'reviewId')::uuid,gen_random_uuid(),1,'[0]',true);
    RAISE EXCEPTION 'Historical pending path bypassed outline review';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,approval||'{"confirmApproval":false}');
    RAISE EXCEPTION 'Approved without explicit action';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,approval||jsonb_build_object(
      'requestId',gen_random_uuid(),'selections',jsonb_build_array(first_takeaway,jsonb_build_object('reviewId',gen_random_uuid(),'index',0))));
    RAISE EXCEPTION 'Approved selection containing a foreign finding';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF EXISTS(SELECT 1 FROM studio.studio_knowledge_insights WHERE location_id=loc) THEN RAISE EXCEPTION 'Partial approval committed'; END IF;

  status_result:=studio.studio_change_knowledge_outline(loc,'substo',actor,approval);
  IF jsonb_array_length(status_result->'findings')<>3 OR
    (SELECT count(*) FROM studio.studio_knowledge_insights WHERE location_id=loc AND status='approved' AND topic_id IS NOT NULL)<>2
    OR (SELECT count(*) FROM studio.studio_knowledge_reviews WHERE location_id=loc AND payload->>'action'='approve')<>2
    OR NOT EXISTS(SELECT 1 FROM studio.studio_knowledge_evidence WHERE location_id=loc
      AND payload @> jsonb_build_object('outline_id',outline_id,'evidence_type','ocr','quote','Read the on-screen checklist','start_sec',94))
    THEN RAISE EXCEPTION 'Approval, exact reuse, or citation audit failed %',status_result; END IF;
  SELECT id INTO old_id FROM studio.studio_knowledge_insights WHERE location_id=loc AND statement='A checklist appears on screen.';
  PERFORM studio.studio_mutate_knowledge_insight(loc,'substo',actor,old_id,gen_random_uuid(),2,'reopen',NULL,'{"mode":"keep"}','Reconsider');
  PERFORM studio.studio_mutate_knowledge_insight(loc,'substo',actor,old_id,gen_random_uuid(),3,'reject',NULL,'{"mode":"keep"}','Reviewed and rejected');
  PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,approval||jsonb_build_object('requestId',gen_random_uuid()));
  IF (SELECT status FROM studio.studio_knowledge_insights WHERE location_id=loc AND id=old_id)<>'rejected' THEN RAISE EXCEPTION 'Prior decision overwritten'; END IF;
  UPDATE studio.studio_records SET version=2,payload=payload||'{"aiSummary":"New metadata"}' WHERE location_id=loc AND id=src;
  IF studio.studio_get_knowledge_outline(loc,'substo',actor,outline_id)->>'stale'<>'false' THEN
    RAISE EXCEPTION 'Unrelated metadata change invalidated immutable transcript evidence';
  END IF;
  UPDATE studio.studio_records SET version=3,payload=jsonb_set(payload,'{transcript}',to_jsonb('Edited transcript.'::text)) WHERE location_id=loc AND id=src;
  IF studio.studio_change_knowledge_outline(loc,'substo',actor,approval)<>status_result THEN RAISE EXCEPTION 'Committed approval replay lost after edit'; END IF;
  IF studio.studio_get_knowledge_outline(loc,'substo',actor,outline_id)->>'stale'<>'true' THEN RAISE EXCEPTION 'Edited evidence marked current'; END IF;
  BEGIN
    PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,approval||jsonb_build_object('requestId',gen_random_uuid()));
    RAISE EXCEPTION 'Stale outline approved';
  EXCEPTION WHEN serialization_failure THEN NULL; END;

  -- Verify a paid whole transcript stays on the normal metered adapter even across batches.
  cmd:=cmd||jsonb_build_object('sourceId',raw_src,'requestId',gen_random_uuid(),'provider','openai','confirmPaid',true);
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd);
    RAISE EXCEPTION 'Missing paid key accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO public.settings_secrets VALUES('LOCATION',loc,'location.ai','openai_api_key');
  PERFORM studio.studio_set_ai_budget(loc,'substo',actor,1000000);
  review:=studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd);
  outline_id:=(review->>'outlineId')::uuid;
  outline_data:=studio.studio_get_knowledge_outline(loc,'substo',actor,outline_id);
  IF jsonb_array_length(outline_data->'batches')<2 OR
    (SELECT sum(char_length(u->>'text')) FROM jsonb_array_elements(outline_data->'batches') b
      CROSS JOIN LATERAL jsonb_array_elements(b#>'{snapshot,units}') u)<>char_length(repeat('Example text. ',1850))
      THEN RAISE EXCEPTION 'Saved plain transcript incomplete'; END IF;
  PERFORM studio.studio_claim_jobs('outline-hosted',50,60);
  FOR item IN SELECT jsonb_build_object('reviewId',r.id,'jobId',j.id,'leaseToken',j.lease_token)
    FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON j.id=r.job_id
    WHERE r.location_id=loc AND r.snapshot->>'inputId'=outline_id::text AND j.execution_target='hosted' LOOP
    old_id:=(studio.studio_begin_text_run_attempt(loc,(item->>'reviewId')::uuid,(item->>'jobId')::uuid,'outline-hosted',
      (item->>'leaseToken')::uuid)->>'attempt_id')::uuid;
    IF old_id IS NULL THEN RAISE EXCEPTION 'Paid batch has no reservation'; END IF;
    PERFORM studio.studio_finish_text_run_attempt(loc,(item->>'reviewId')::uuid,(item->>'jobId')::uuid,'outline-hosted',
      (item->>'leaseToken')::uuid,old_id,'{"findings":[]}',100,40,'mock-outline-response','gpt-6-luna-standard-2026-10-23');
    PERFORM studio.studio_complete_job((item->>'jobId')::uuid,'outline-hosted',(item->>'leaseToken')::uuid,'{}');
  END LOOP;
  IF (SELECT count(*) FROM studio.studio_ai_usage WHERE location_id=loc AND status='settled')<>jsonb_array_length(outline_data->'batches')
      THEN RAISE EXCEPTION 'Paid batch settlement mismatch'; END IF;
  INSERT INTO studio.studio_records(location_id,id,kind,title,payload)
    VALUES(loc,extra_src,'reference','Stored upload and imported evidence','{}');
  INSERT INTO studio.studio_knowledge_sources(location_id,id,payload,total_units,covered_units) VALUES(loc,extra_src,'{}',2,0);
  INSERT INTO studio.studio_knowledge_source_unit_sidecars VALUES(loc,sidecar,extra_src,'speech-fixture','{}');
  INSERT INTO studio.studio_knowledge_source_units VALUES(loc,imported_unit,sidecar,extra_src,'speech-fixture',0,
    '{"unit":{"text":"Imported speech","start":10,"end":12,"ocr":"Imported OCR","frameFile":"private-frame.jpg"}}');
  INSERT INTO studio.studio_knowledge_source_units VALUES(loc,gen_random_uuid(),sidecar,extra_src,'speech-fixture',3,
    '{"unit":{"text":"Imported final speech","start":"invalid legacy timestamp","end":15}}');
  cmd:=cmd||jsonb_build_object('sourceId',extra_src,'requestId',gen_random_uuid(),'provider','subscription',
    'mode','source_units','inputId','speech-fixture');
  review:=studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd);
  outline_data:=studio.studio_get_knowledge_outline(loc,'substo',actor,(review->>'outlineId')::uuid);
  IF jsonb_array_length(outline_data#>'{batches,0,snapshot,units}')<>3
    OR outline_data#>>'{batches,0,snapshot,units,0,originalUnitId}' IS DISTINCT FROM imported_unit::text
    OR outline_data#>>'{batches,0,snapshot,units,1,evidenceType}' IS DISTINCT FROM 'ocr'
    OR outline_data#>>'{batches,0,snapshot,units,2,startSeconds}' IS NOT NULL
    OR outline_data::text LIKE '%private-frame.jpg%' THEN RAISE EXCEPTION 'Imported transcript provenance mismatch'; END IF;

  claimed:=studio.studio_text_device_command(digest,'substo','claim','{"workerId":"outline-mac","limit":1,"leaseSeconds":60,"textReady":true}')->0;
  body:=jsonb_build_object('workerId','outline-mac','jobId',claimed->>'id','leaseToken',claimed->>'lease_token');
  PERFORM studio.studio_text_device_command(digest,'substo','fail',body||'{"failure":{"code":"timeout","message":"Fixture timeout","retryable":true}}');
  outline_data:=studio.studio_get_knowledge_outline(loc,'substo',actor,(review->>'outlineId')::uuid);
  IF outline_data#>>'{batches,0,status}'<>'failed' OR outline_data#>>'{batches,0,result}' IS NOT NULL THEN
    RAISE EXCEPTION 'Failed batch appears covered';
  END IF;

  PERFORM studio.studio_create_upload(loc,'substo',actor,upload,extra_src,'fixture.ogg','audio/ogg',100,'studio-media');
  upload_row:=studio.studio_complete_upload(loc,'substo',actor,upload,100);
  PERFORM studio.studio_claim_jobs('upload-fixture',50,60);
  SELECT * INTO upload_job FROM studio.studio_jobs WHERE id=upload_row.transcription_job_id;
  upload_attempt:=(studio.studio_begin_transcription_attempt(loc,upload,upload_job.id,'upload-fixture',upload_job.lease_token,0,4)->>'attempt_id')::uuid;
  PERFORM studio.studio_finish_transcription_attempt(loc,upload,upload_job.id,'upload-fixture',upload_job.lease_token,
    upload_attempt,'Own uploaded words','[{"text":"Own uploaded words","start":0,"end":4}]');
  PERFORM studio.studio_finish_upload_transcript(loc,upload,upload_job.id,'upload-fixture',upload_job.lease_token,'whisper-1','en',4);
  PERFORM studio.studio_complete_job(upload_job.id,'upload-fixture',upload_job.lease_token,'{}');
  cmd:=cmd||jsonb_build_object('mode','upload_transcript','inputId',upload,'requestId',gen_random_uuid());
  BEGIN
    PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd||jsonb_build_object('sourceId',raw_src));
    RAISE EXCEPTION 'Foreign-source upload processed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  review:=studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd);
  outline_data:=studio.studio_get_knowledge_outline(loc,'substo',actor,(review->>'outlineId')::uuid);
  IF outline_data#>>'{batches,0,snapshot,units,0,text}' IS DISTINCT FROM 'Own uploaded words'
    OR outline_data#>>'{batches,0,snapshot,units,0,endSeconds}' IS DISTINCT FROM '4'
    OR outline_data#>>'{batches,0,snapshot,evidenceInputId}' IS DISTINCT FROM upload::text THEN
    RAISE EXCEPTION 'Upload transcript timing or evidence identity missing %',outline_data#>'{batches,0,snapshot,units}';
  END IF;
  IF has_function_privilege('anon','studio.studio_enqueue_knowledge_outline(text,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','studio.studio_change_knowledge_outline(text,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('service_role','studio.studio_apply_knowledge_extraction_findings(text,text,text,uuid,uuid,bigint,jsonb,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Unsafe outline grants';
  END IF;
END;
$$;
