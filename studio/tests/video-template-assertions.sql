-- Uses the real saved Mac transcript/chunks and verified frame fixture from the released suite.
BEGIN;
DO $$
DECLARE
  mac_location text := 'ad000000-0000-4000-8000-000000000001';
  loc text := 'vt-template-location'; actor text := 'vt-template-owner';
  source uuid := gen_random_uuid(); plain uuid := gen_random_uuid(); mac_source uuid; mac_transcription uuid;
  transcript text; segments jsonb; snapshot jsonb; cmd jsonb; run jsonb; paid jsonb; claimed jsonb; completion jsonb;
  device uuid; review uuid; job uuid; lease uuid; attempt uuid; usage uuid;
  digest text := repeat('e',64); template uuid := gen_random_uuid(); draft uuid := gen_random_uuid();
  proposal jsonb; edited_beats jsonb := '[{"name":"Edited opening","guidance":"State the viewer outcome."}]';
BEGIN
  SELECT v.record_id,v.id INTO STRICT mac_source,mac_transcription FROM studio.studio_video_transcriptions v
    WHERE v.location_id=mac_location AND v.transcript_applied AND v.status='ready' AND v.frame_count=2;
  -- The Gap 1 suite previously edited the fixture transcript to test invalidation. Restore the synthetic saved text.
  SELECT string_agg('['||to_char(make_interval(secs=>floor((seg->>'start')::numeric)::double precision),'HH24:MI:SS')||'] '||btrim(seg->>'text'),
    E'\n' ORDER BY c.chunk_index,n) INTO transcript FROM studio.studio_video_transcript_chunks c
    CROSS JOIN LATERAL jsonb_array_elements(c.segments) WITH ORDINALITY a(seg,n)
    WHERE c.location_id=mac_location AND c.transcription_id=mac_transcription;
  UPDATE studio.studio_records SET payload=jsonb_set(payload,'{transcript}',to_jsonb(transcript)) WHERE location_id=mac_location AND id=mac_source;
  snapshot:=studio.studio_build_video_template_snapshot(mac_location,mac_source,NULL);
  IF snapshot#>>'{coverage,selectedSpeech}'<>'5' OR snapshot#>>'{coverage,selectedOcr}'<>'1'
    OR snapshot::text LIKE '%as shown here%' OR snapshot::text LIKE '%objectKey%'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'units') u WHERE u->>'evidenceType'='ocr'
      AND u->>'text'='Slide one: Pricing tiers' AND u->>'startSeconds'='12.5')
    THEN RAISE EXCEPTION 'Released Mac evidence missing or private context leaked: %', snapshot; END IF;

  PERFORM studio.studio_create_substo_location(loc,'Video template tests',actor);
  PERFORM public.test_member(loc,'vt-template-member','member');
  device:=pg_temp.pair_text_device(loc,actor,'TEXTDDEE',digest);
  SELECT string_agg('Saved passage number '||i||'.',' ' ORDER BY i),
    jsonb_agg(jsonb_build_object('start',i*3,'end',i*3+2,'text','Saved passage number '||i||'.') ORDER BY i)
    INTO transcript,segments FROM generate_series(1,300) i;
  INSERT INTO studio.studio_records(location_id,id,kind,title,payload) VALUES
    (loc,source,'reference','Timed example',jsonb_build_object('url','https://www.youtube.com/watch?v=Kd012345678',
      'transcript',transcript,'transcriptEvidence',jsonb_build_object('textSha256',encode(sha256(convert_to(transcript,'UTF8')),'hex'),
        'segments',segments,'frames','[{"time":10,"ocr":"Finished checklist","audioContext":"Private nearby context","file":"private.jpg"}]'::jsonb))),
    (loc,plain,'reference','Untimed example','{"url":"https://www.youtube.com/watch?v=Kd012345678","transcript":"No saved timing."}');
  cmd:=jsonb_build_object('requestId',gen_random_uuid(),'sourceId',source,'expectedVersion',1,'provider','subscription','confirmSubscription',true);
  BEGIN
    PERFORM studio.studio_enqueue_video_template(loc,'substo',actor,cmd||jsonb_build_object('sourceId',plain));
    RAISE EXCEPTION 'Untimed transcript accepted';
  EXCEPTION WHEN SQLSTATE 'P2013' THEN NULL; END;
  BEGIN
    PERFORM studio.studio_enqueue_video_template(loc,'substo',actor,cmd);
    RAISE EXCEPTION 'Old companion accepted template prompt';
  EXCEPTION WHEN SQLSTATE 'P2014' THEN NULL; END;
  BEGIN
    PERFORM studio.studio_enqueue_video_template(loc,'substo','text-other',cmd);
    RAISE EXCEPTION 'Nonmember queued an extraction';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE studio.studio_devices SET report=report||'{"videoTemplateVersion":1}' WHERE id=device;
  run:=studio.studio_enqueue_video_template(loc,'substo',actor,cmd);
  IF studio.studio_enqueue_video_template(loc,'substo',actor,cmd) IS DISTINCT FROM run THEN RAISE EXCEPTION 'Enqueue replay changed'; END IF;
  BEGIN
    PERFORM studio.studio_enqueue_video_template(loc,'substo',actor,cmd||jsonb_build_object('requestId',gen_random_uuid()));
    RAISE EXCEPTION 'Duplicate active extraction accepted';
  EXCEPTION WHEN SQLSTATE 'P2015' THEN NULL; END;
  BEGIN
    PERFORM studio.studio_enqueue_video_template(loc,'substo',actor,cmd||'{"provider":"openai","confirmPaid":true}');
    RAISE EXCEPTION 'Replay changed funding';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  review:=(run->>'reviewId')::uuid;
  job:=(run->>'jobId')::uuid;
  claimed:=studio.studio_text_device_command(digest,'substo','claim','{"workerId":"template-mac","limit":1,"leaseSeconds":60,"textReady":true}')->0;
  snapshot:=claimed#>'{payload,snapshot}';
  IF claimed#>>'{payload,promptVersion}' IS DISTINCT FROM 'studio.video-template.v1'
    OR snapshot#>>'{coverage,speechUnits}' IS DISTINCT FROM '300'
    OR (snapshot#>>'{coverage,selectedSpeech}')::integer>=300
    OR octet_length(snapshot::text)>23000 OR snapshot::text LIKE '%private.jpg%' OR snapshot::text LIKE '%Private nearby context%'
    OR snapshot#>>'{units,0,text}' IS DISTINCT FROM 'Saved passage number 1.'
    OR snapshot#>>'{units,-1,text}' IS DISTINCT FROM 'Saved passage number 300.'
    THEN RAISE EXCEPTION 'Unexpected template coverage or provider payload'; END IF;
  proposal:=jsonb_build_object('name','Finish then explain','purpose','Lead with an outcome','limitations','["Sampled transcript"]'::jsonb,
    'beats',jsonb_build_array(jsonb_build_object('name','Opening proof','guidance','State the desired outcome.','rationale','The example opens with a saved passage.',
      'citations',jsonb_build_array(jsonb_build_object('unitId',snapshot#>>'{units,0,id}','quote','Saved passage number 1.')))));
  completion:=jsonb_build_object('workerId','template-mac','jobId',job,'leaseToken',claimed->>'lease_token');
  BEGIN
    PERFORM studio.studio_text_device_command(digest,'substo','complete',completion||jsonb_build_object('result',
      jsonb_build_object('provider','codex','model','native-default','output',jsonb_set(proposal,'{beats,0,citations,0,quote}','"Invented text"'))));
    RAISE EXCEPTION 'Invented quote accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM studio.studio_text_device_command(digest,'substo','complete',completion||jsonb_build_object('result',
    jsonb_build_object('provider','codex','model','native-default','output',proposal)));
  IF EXISTS(SELECT 1 FROM studio.studio_script_template_versions WHERE location_id=loc)
    OR EXISTS(SELECT 1 FROM studio.studio_ai_usage WHERE location_id=loc) THEN RAISE EXCEPTION 'Proposal was auto-saved or subscription billed'; END IF;
  BEGIN
    PERFORM studio.studio_apply_knowledge_extraction(loc,'substo',actor,review,gen_random_uuid(),1,'[0]',true);
    RAISE EXCEPTION 'Template was applicable as Knowledge';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM studio.studio_save_video_template_draft(loc,'substo','vt-template-member',review,template,draft,'Edited example','General purpose',edited_beats);
  PERFORM studio.studio_save_video_template_draft(loc,'substo','vt-template-member',review,template,draft,'Edited example','General purpose',edited_beats);
  IF NOT EXISTS(SELECT 1 FROM studio.studio_script_template_versions WHERE location_id=loc AND id=draft AND source_review_id=review
    AND beats=edited_beats AND approved_at IS NULL) THEN RAISE EXCEPTION 'Draft lost its provenance or copied evidence'; END IF;
  BEGIN
    PERFORM studio.studio_save_video_template_draft(loc,'substo',actor,review,gen_random_uuid(),gen_random_uuid(),'Duplicate','General purpose',edited_beats);
    RAISE EXCEPTION 'One extraction saved twice';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM studio.studio_approve_script_template(loc,'substo','vt-template-member',template,draft);
    RAISE EXCEPTION 'Member approved template';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM studio.studio_approve_script_template(loc,'substo',actor,template,draft);

  cmd:=cmd||jsonb_build_object('requestId',gen_random_uuid(),'provider','openai','confirmSubscription',false);
  BEGIN
    PERFORM studio.studio_enqueue_video_template(loc,'substo',actor,cmd);
    RAISE EXCEPTION 'Paid route accepted without explicit consent';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO public.settings_secrets VALUES('LOCATION',loc,'location.ai','openai_api_key');
  PERFORM studio.studio_set_ai_budget(loc,'substo',actor,1000000);
  paid:=studio.studio_enqueue_video_template(loc,'substo',actor,cmd||'{"confirmPaid":true}');
  job:=(paid->>'jobId')::uuid; review:=(paid->>'reviewId')::uuid;
  PERFORM studio.studio_claim_jobs('template-hosted',50,60);
  SELECT lease_token INTO lease FROM studio.studio_jobs WHERE id=job AND execution_target='hosted';
  attempt:=(studio.studio_begin_text_run_attempt(loc,review,job,'template-hosted',lease)->>'attempt_id')::uuid;
  SELECT usage_id INTO usage FROM studio.studio_ai_attempts WHERE id=attempt;
  IF (SELECT status FROM studio.studio_ai_usage WHERE id=usage) IS DISTINCT FROM 'reserved' THEN RAISE EXCEPTION 'Missing paid hold'; END IF;
  UPDATE studio.studio_records SET version=version+1 WHERE location_id=loc AND id=source;
  PERFORM studio.studio_finish_text_run_attempt(loc,review,job,'template-hosted',lease,attempt,proposal,100,100,'fixture-response','gpt-6-luna-standard-2026-10-23');
  IF (SELECT status FROM studio.studio_ai_usage WHERE id=usage) IS DISTINCT FROM 'settled'
    OR (SELECT stale_at_completion FROM studio.studio_idea_reviews WHERE id=review) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Paid result did not settle or stale evidence was admitted';
  END IF;
  BEGIN
    PERFORM studio.studio_save_video_template_draft(loc,'substo',actor,review,gen_random_uuid(),gen_random_uuid(),'Stale','General purpose',edited_beats);
    RAISE EXCEPTION 'Stale proposal saved';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
ROLLBACK;
