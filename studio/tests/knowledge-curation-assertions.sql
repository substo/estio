-- Full outline curation and selected ideas through the real database lifecycle, with model replies as fixtures.
DO $$
DECLARE loc text:='ac000000-0000-4000-8000-000000000041'; actor text:='curation-owner';
  source uuid:='ac000000-0000-4000-8000-000000000042'; device uuid; token text:=repeat('e',64);
  cmd jsonb; outline uuid; child uuid; draft uuid; claim jsonb; body jsonb; snap jsonb;
  proposal jsonb; response jsonb; refs jsonb; node text;
BEGIN
  PERFORM studio.studio_create_substo_location(loc,'Curation fixture',actor);
  PERFORM public.test_member(loc,'curation-teammate','admin');
  device:=pg_temp.pair_text_device(loc,actor,'CURATEAA',token);
  UPDATE studio.studio_devices SET report=report||'{"knowledgeOutlineVersion":2,"sourceAssistVersion":1}' WHERE id=device;
  INSERT INTO studio.studio_records(location_id,id,kind,title,payload) VALUES(loc,source,'reference','Interview',
    '{"transcript":"Build the opening around a recognizable mistake before explaining the fix."}');
  cmd:=jsonb_build_object('action','enqueueOutline','requestId',gen_random_uuid(),'sourceId',source,
    'expectedVersion',1,'inputId','transcript','mode','record_text','curationVersion',1,'provider','subscription','confirmSubscription',true);
  BEGIN PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd); RAISE EXCEPTION 'Old companion accepted curation';
  EXCEPTION WHEN SQLSTATE 'P2011' THEN NULL; END;
  UPDATE studio.studio_devices SET report=report||'{"knowledgeCurationVersion":1}' WHERE id=device;
  outline:=(studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd)->>'outlineId')::uuid;
  claim:=studio.studio_text_device_command(token,'substo','claim','{"workerId":"curation-mac","limit":1,"leaseSeconds":60,"textReady":true}')->0;
  snap:=claim#>'{payload,snapshot}';
  child:=(claim#>>'{payload,reviewId}')::uuid;
  IF claim#>>'{payload,promptVersion}' IS DISTINCT FROM 'studio.knowledge-extract.v3'
    OR snap->>'curationVersion' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Wrong curation version'; END IF;
  body:=jsonb_build_object('workerId','curation-mac','jobId',claim->>'id','leaseToken',claim->>'lease_token');
  proposal:=jsonb_build_object('findings',jsonb_build_array(jsonb_build_object(
    'kind','method','unitId',snap#>>'{units,0,id}','statement','Open with a recognizable mistake.','suggestedTopic','Opening',
    'quote','Build the opening around a recognizable mistake','topicPath','["Opening"]'::jsonb,
    'curation','{"featured":true,"use":"Write the opening","equivalentPoint":"open-with-mistake","basis":"advice"}'::jsonb)));
  BEGIN PERFORM studio.studio_validate_text_run_result('knowledge_extract',jsonb_set(proposal,'{findings,0,curation,basis}','"verified"'),snap);
    RAISE EXCEPTION 'Unverified basis accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM studio.studio_validate_text_run_result('knowledge_extract',jsonb_set(proposal,'{findings,0,quote}','"fabricated"'),snap);
    RAISE EXCEPTION 'Forged quote accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF studio.studio_text_device_command(token,'substo','complete',body||jsonb_build_object('result',
    jsonb_build_object('output',proposal,'provider','codex','model','native-default')))<>'true' THEN RAISE EXCEPTION 'Completion rejected'; END IF;

  node:='finding:'||child::text||':0';
  refs:=jsonb_build_array(jsonb_build_object('reviewId',child,'index',0));
  cmd:=jsonb_build_object('action','triage','requestId',gen_random_uuid(),'outlineId',outline,'nodeKey',node,'state','kept');
  IF studio.studio_change_knowledge_outline(loc,'substo',actor,cmd) IS DISTINCT FROM '{"state":"kept"}'::jsonb
    OR studio.studio_change_knowledge_outline(loc,'substo',actor,cmd) IS DISTINCT FROM '{"state":"kept"}'::jsonb
    OR studio.studio_get_knowledge_outline(loc,'substo',actor,outline)->'triage'->>node IS DISTINCT FROM 'kept'
    OR studio.studio_get_knowledge_outline(loc,'substo','curation-teammate',outline)->'triage'<>'{}'::jsonb THEN RAISE EXCEPTION 'Triage leaked or lost'; END IF;
  PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,cmd||jsonb_build_object('requestId',gen_random_uuid(),'state','hidden'));
  IF studio.studio_get_knowledge_outline(loc,'substo',actor,outline)->'triage'->>node IS DISTINCT FROM 'hidden' THEN RAISE EXCEPTION 'Skip did not persist'; END IF;
  PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,cmd||jsonb_build_object('requestId',gen_random_uuid(),'state','clear'));
  IF studio.studio_get_knowledge_outline(loc,'substo',actor,outline)->'triage'<>'{}'::jsonb THEN RAISE EXCEPTION 'Restore did not clear skip'; END IF;
  PERFORM studio.studio_change_knowledge_outline(loc,'substo',actor,jsonb_build_object('action','annotate','requestId',gen_random_uuid(),
    'outlineId',outline,'nodeKey',node,'note','My comment','expectedVersion',0,'title','','summary',''));
  IF studio.studio_get_knowledge_outline(loc,'substo',actor,outline)->'annotations'->node->>'note' IS DISTINCT FROM 'My comment' THEN
    RAISE EXCEPTION 'Comment did not use existing persistence';
  END IF;
  IF EXISTS(SELECT 1 FROM studio.studio_knowledge_insights WHERE location_id=loc) THEN RAISE EXCEPTION 'Triage approved knowledge'; END IF;

  cmd:=jsonb_build_object('requestId',gen_random_uuid(),'sourceId',source,'expectedVersion',1,
    'provider','subscription','confirmSubscription',true,'intent','propose_idea','message','Show an inbox before and after.',
    'selection',jsonb_build_object('outlineId',outline,'selections',refs));
  BEGIN
    PERFORM studio.studio_enqueue_source_assist(loc,'substo',actor,cmd||jsonb_build_object('selection',jsonb_build_object('outlineId',outline,
      'selections',jsonb_build_array(jsonb_build_object('reviewId',gen_random_uuid(),'index',0)))));
    RAISE EXCEPTION 'Foreign evidence accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  response:=studio.studio_enqueue_source_assist(loc,'substo',actor,cmd);
  draft:=(response->>'reviewId')::uuid;
  IF studio.studio_enqueue_source_assist(loc,'substo',actor,cmd) IS DISTINCT FROM response THEN RAISE EXCEPTION 'Draft replay changed'; END IF;
  claim:=studio.studio_text_device_command(token,'substo','claim','{"workerId":"curation-mac","limit":1,"leaseSeconds":60,"textReady":true}')->0;
  snap:=claim#>'{payload,snapshot}';
  IF claim#>>'{payload,promptVersion}' IS DISTINCT FROM 'studio.source-assist.selected-idea.v1'
    OR snap#>>'{units,0,text}' IS DISTINCT FROM 'Build the opening around a recognizable mistake'
    OR snap->>'reaction' IS DISTINCT FROM 'Show an inbox before and after.'
    OR jsonb_array_length(snap->'units')<>1 THEN RAISE EXCEPTION 'Wrong selected idea snapshot'; END IF;
  body:=jsonb_build_object('workerId','curation-mac','jobId',claim->>'id','leaseToken',claim->>'lease_token');
  proposal:=jsonb_build_object('reply','Proposed an idea','note',NULL,'ideaTitle','When the CRM guesses wrong',
    'ideaConcept','Compare two inbox replies in an original example.','relatedQuery',NULL,'limitations','[]'::jsonb,
    'citations',jsonb_build_array(jsonb_build_object('unitId',snap#>>'{units,0,id}','quote','recognizable mistake')));
  IF studio.studio_text_device_command(token,'substo','complete',body||jsonb_build_object('result',
    jsonb_build_object('output',proposal,'provider','codex','model','native-default')))<>'true' THEN RAISE EXCEPTION 'Idea completion rejected'; END IF;
  IF studio.studio_selected_idea_evidence(loc,'substo',actor,source,draft)#>>'{findings,0,reviewId}' IS DISTINCT FROM child::text THEN
    RAISE EXCEPTION 'Missing durable source provenance';
  END IF;
  BEGIN PERFORM studio.studio_selected_idea_evidence(loc,'substo','curation-teammate',source,draft); RAISE EXCEPTION 'Draft leaked';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  IF EXISTS(SELECT 1 FROM studio.studio_records WHERE location_id=loc AND kind='content')
    OR EXISTS(SELECT 1 FROM studio.studio_knowledge_insights WHERE location_id=loc)
    OR EXISTS(SELECT 1 FROM studio.studio_ai_usage WHERE location_id=loc) THEN RAISE EXCEPTION 'Draft auto-created, auto-approved or billed'; END IF;

END;
$$;
