-- This uses the real extraction admission with a fixture Mac. No model or YouTube requests.
DO $$
DECLARE
  loc text:='ac000000-0000-4000-8000-000000000028';
  actor text:='import-knowledge-owner';
  src uuid:=gen_random_uuid();
  description_only uuid:=gen_random_uuid();
  empty_source uuid:=gen_random_uuid();
  device uuid;
  transcription uuid:=gen_random_uuid();
  job_id uuid;
  lease uuid:=gen_random_uuid();
  result jsonb;
  outline uuid;
BEGIN
  PERFORM studio.studio_create_substo_location(loc,'Imported knowledge',actor);
  device:=pg_temp.pair_text_device(loc,actor,'KNPWGEDF',encode(sha256(convert_to(actor,'UTF8')),'hex'));
  UPDATE studio.studio_devices SET report=report||'{"knowledgeOutlineVersion":2,"knowledgeCurationVersion":1}' WHERE id=device;
  INSERT INTO studio.studio_records(location_id,id,kind,title,payload) VALUES
    (loc,src,'reference','Video','{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","description":"The original video description."}'),
    (loc,description_only,'reference','Article','{"url":"https://example.test/article","description":"A useful article passage."}'),
    (loc,empty_source,'reference','Empty article','{"url":"https://example.test/no-text"}');
  INSERT INTO studio.studio_video_transcriptions(location_id,id,record_id,video_id,origin,actor_app,actor_id,request_key,status)
    VALUES(loc,transcription,src,'dQw4w9WgXcQ','paste','substo',actor,'import-knowledge-fixture','queued');

  job_id:=studio.studio_queue_import_knowledge(loc,'substo',actor,src,transcription);
  IF job_id IS NULL OR job_id IS DISTINCT FROM studio.studio_queue_import_knowledge(loc,'substo',actor,src,NULL) THEN
    RAISE EXCEPTION 'Import extraction was not queued once';
  END IF;
  UPDATE studio.studio_jobs SET status='running',attempts=1,lease_owner='fixture',lease_token=lease,lease_expires_at=clock_timestamp()+interval '2 minutes' WHERE id=job_id;
  IF studio.studio_start_import_knowledge(job_id,'fixture',gen_random_uuid())->>'state' IS DISTINCT FROM 'lease_lost'
    OR studio.studio_start_import_knowledge(job_id,'fixture',lease)->>'state' IS DISTINCT FROM 'waiting_transcript'
  THEN RAISE EXCEPTION 'Import ignored its lease or started before transcription finished'; END IF;

  UPDATE studio.studio_video_transcriptions SET status='ready' WHERE id=transcription AND location_id=loc;
  UPDATE studio.studio_records SET payload=payload||'{"transcript":"The saved video transcript."}' WHERE id=src AND location_id=loc;
  UPDATE studio.studio_devices SET report=report-'knowledgeCurationVersion' WHERE id=device;
  BEGIN
    PERFORM studio.studio_start_import_knowledge(job_id,'fixture',lease);
    RAISE EXCEPTION 'Incompatible Mac was accepted';
  EXCEPTION WHEN SQLSTATE 'P2011' THEN NULL; END;
  UPDATE studio.studio_devices SET report=report||'{"knowledgeCurationVersion":1}' WHERE id=device;
  result:=studio.studio_start_import_knowledge(job_id,'fixture',lease);
  outline:=(result->>'outlineId')::uuid;
  IF NOT EXISTS (SELECT 1 FROM studio.studio_knowledge_outlines o WHERE o.id=outline AND o.input_id='transcript' AND o.request->>'provider'='subscription')
    OR studio.studio_start_import_knowledge(job_id,'fixture',lease) IS DISTINCT FROM result
    OR NOT EXISTS (SELECT 1 FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON j.id=r.job_id
      WHERE r.location_id=loc AND r.snapshot->>'inputId'=outline::text AND j.execution_target='device' AND r.execution_provider='subscription')
    OR EXISTS (SELECT 1 FROM studio.studio_ai_usage WHERE location_id=loc)
  THEN RAISE EXCEPTION 'Automatic transcription extraction was not an idempotent subscription run: %',result; END IF;

  job_id:=studio.studio_queue_import_knowledge(loc,'substo',actor,description_only,NULL);
  UPDATE studio.studio_jobs SET status='running',attempts=1,lease_owner='fixture',lease_token=lease,lease_expires_at=clock_timestamp()+interval '2 minutes' WHERE id=job_id;
  result:=studio.studio_start_import_knowledge(job_id,'fixture',lease);
  outline:=(result->>'outlineId')::uuid;
  IF NOT EXISTS (SELECT 1 FROM studio.studio_knowledge_outlines o WHERE o.id=outline AND o.input_id='description')
    OR studio.studio_outline_input(loc,description_only,NULL,'record_text','description')#>>'{units,0,evidenceType}' IS DISTINCT FROM 'text'
    OR studio.studio_knowledge_extraction_inputs(loc,'substo',actor,description_only)#>>'{inputs,0,inputId}' IS DISTINCT FROM 'description'
  THEN RAISE EXCEPTION 'Saved description was not available as text evidence: %',result; END IF;

  job_id:=studio.studio_queue_import_knowledge(loc,'substo',actor,empty_source,NULL);
  UPDATE studio.studio_jobs SET status='running',attempts=1,lease_owner='fixture',lease_token=lease,lease_expires_at=clock_timestamp()+interval '2 minutes' WHERE id=job_id;
  IF studio.studio_start_import_knowledge(job_id,'fixture',lease)->>'state' IS DISTINCT FROM 'no_evidence' THEN
    RAISE EXCEPTION 'An empty source was treated as extraction evidence';
  END IF;
END $$;
