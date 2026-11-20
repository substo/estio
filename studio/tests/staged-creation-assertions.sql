-- Exercise the production SQL entry points with fake providers in disposable PostgreSQL.
ALTER TABLE public.settings_documents ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
DO $$
DECLARE loc text:='studio-creation'; actor text:='creation-owner'; outsider text:='creation-other';
  source uuid:='291af992-3d9a-4178-b730-8b33fb04c596'; draft uuid:=gen_random_uuid(); blank uuid:=gen_random_uuid(); old_a uuid:=gen_random_uuid(); old_b uuid:=gen_random_uuid();
  template uuid:=gen_random_uuid(); template_version uuid:=gen_random_uuid(); finding uuid:=gen_random_uuid(); citation uuid:=gen_random_uuid(); device uuid; job uuid; review uuid;
  claim jsonb; snapshot jsonb; cmd jsonb; saved jsonb; queued jsonb; output jsonb; fenced jsonb;
  patch jsonb:='{"title":"Two openings","stage":"idea","approved":false,"creation":{"schema":1,"brief":"Show two openings, then Studio.","direction":{"choice":"promote","publisher":"Substo","viewer":"First-time creators","goal":"Teach creators how to improve their videos and briefly show Studio","angle":"Compare openings"},"stages":{"Title":{"text":"Two openings","approved":true,"shortlist":[]},"Hook":{"text":"Improve your video","approved":true,"shortlist":[]}},"history":[]}}';
BEGIN
  PERFORM studio.studio_create_substo_location(loc,'Substo',actor);
  PERFORM studio.studio_create_substo_location('studio-creation-other','Other',outsider);
  INSERT INTO studio.studio_records(location_id,id,kind,title,payload) VALUES (loc,source,'reference','MrBeast on improving videos',
    '{"transcript":"Start with the audience. The title and opening set the promise. Deliver the payoff and practice making videos.","notes":"Old fictional local-service quote enquiry."}');
  INSERT INTO studio.studio_knowledge_sources VALUES (loc,source,'{}',1,1);
  INSERT INTO studio.studio_knowledge_insights(location_id,id,source_id,status,statement,payload)
    VALUES (loc,finding,source,'approved','Open with the audience promise','{}');
  INSERT INTO studio.studio_knowledge_evidence(location_id,id,insight_id,source_id,payload) VALUES
    (loc,citation,finding,source,'{"origin":"hosted_extraction","source_version":1,"quote":"The title and opening set the promise.","evidence_type":"speech","start_sec":42}');
  INSERT INTO public.settings_documents(scope_type,scope_id,domain,payload,version) VALUES
    ('LOCATION',loc,'location.business','{"audienceMarket":{"audience":{"status":"known","value":"Local service owners"}},"brandVoice":{"tone":{"status":"known","value":"Plain"}}}',4);
  PERFORM studio.studio_propose_script_template(loc,'substo',actor,template,template_version,0,'Promise then payoff','Test purpose',
    '[{"name":"Promise","guidance":"Show the outcome"},{"name":"Payoff","guidance":"Deliver it"}]');
  PERFORM studio.studio_approve_script_template(loc,'substo',actor,template,template_version);
  saved:=studio.studio_save_creation(loc,'substo',actor,draft,0,'Two openings',patch,true,template_version,source,1,NULL);
  IF (saved->>'version')::int<>2 OR saved->>'script_template_version_id'<>template_version::text OR
    saved#>>'{payload,linkedIds,0}'<>source::text THEN RAISE EXCEPTION 'Create and source link were not atomic'; END IF;
  IF studio.studio_save_creation(loc,'substo',actor,draft,0,'Two openings',patch,true,template_version,source,1,NULL)<>saved
    THEN RAISE EXCEPTION 'Creation admission did not deduplicate'; END IF;
  BEGIN
    PERFORM studio.studio_save_creation(loc,'substo',outsider,draft,2,'Changed',patch,false,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'Cross-Location save succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- A confirmed, source-free piece uses the same staged execution without forcing a fictional source.
  PERFORM studio.studio_save_creation(loc,'substo',actor,blank,0,'Two openings',patch,true,NULL,NULL,NULL,NULL);
  snapshot:=studio.studio_build_selected_text_snapshot(loc,jsonb_build_array(jsonb_build_object('id',blank,'version',1,
    'creation','{"kind":"suggest","stage":"Concept","feedback":""}'::jsonb)),'','script_brief');
  IF snapshot->'evidence'<>'[]' OR snapshot#>>'{direction,publisher}'<>'Substo' THEN RAISE EXCEPTION 'Invalid source-free snapshot'; END IF;

  INSERT INTO studio.studio_records(location_id,id,kind,title,payload) VALUES
    (loc,old_a,'content','Early draft A',jsonb_build_object('script',repeat('Early text A. ',400),'notes','Private source note for A')),
    (loc,old_b,'content','Early draft B','{"script":"Distinct old script B","notes":"Private source note for B"}');
  PERFORM studio.studio_change_record_link(loc,draft,old_a,'add',2,'substo',actor);
  PERFORM studio.studio_change_record_link(loc,draft,old_b,'add',3,'substo',actor);
  snapshot:=studio.studio_build_selected_text_snapshot(loc,jsonb_build_array(jsonb_build_object('id',draft,'version',4,
    'creation','{"kind":"draft","stage":"Script","feedback":"","includeReferences":false}'::jsonb)),'','script_brief');
  IF snapshot->'evidence'<>'[]'::jsonb OR snapshot->'priorDraft'<>'null'::jsonb
    OR snapshot::text LIKE '%Early text A%' OR snapshot::text LIKE '%Distinct old script B%' THEN
    RAISE EXCEPTION 'Default prior drafts or excluded reference leaked';
  END IF;
  snapshot:=studio.studio_build_selected_text_snapshot(loc,jsonb_build_array(jsonb_build_object('id',draft,'version',4,
    'creation',jsonb_build_object('kind','draft','stage','Script','feedback','A deliberate comparison','linkedDraft',jsonb_build_object('id',old_a,'version',1,'purpose','compare')))),'','script_brief');
  IF snapshot#>>'{priorDraft,id}'<>old_a::text OR snapshot#>>'{priorDraft,version}'<>'1'
    OR snapshot#>>'{priorDraft,purpose}'<>'compare' OR snapshot#>>'{priorDraft,truncated}'<>'true'
    OR char_length(snapshot#>>'{priorDraft,text}')<>3000
    OR snapshot::text LIKE '%Distinct old script B%' OR snapshot::text LIKE '%Private source note%' THEN
    RAISE EXCEPTION 'Explicit comparison input mixed with other drafts or saved notes';
  END IF;
  device:=pg_temp.pair_text_device(loc,actor,'CREATEAA',repeat('7',64));
  cmd:=jsonb_build_object('requestId',gen_random_uuid(),'provider','subscription','confirmSubscription',true,'focus','',
    'ideas',jsonb_build_array(jsonb_build_object('id',draft,'version',4,'creation','{"kind":"draft","stage":"Script","feedback":"Use a practical exercise"}'::jsonb)));
  BEGIN
    PERFORM studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',cmd);
    RAISE EXCEPTION 'Outdated companion received a staged prompt';
  EXCEPTION WHEN SQLSTATE 'SC001' THEN NULL; END;
  UPDATE studio.studio_devices SET report=report||'{"stagedCreationVersion":1}' WHERE id=device;
  queued:=studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',cmd);
  IF studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',cmd)<>queued THEN RAISE EXCEPTION 'Duplicate staged enqueue'; END IF;
  job:=(queued->>'jobId')::uuid; review:=(queued->>'reviewId')::uuid;
  SELECT r.snapshot INTO snapshot FROM studio.studio_idea_reviews r WHERE id=review;
  IF (SELECT prompt_version FROM studio.studio_idea_reviews WHERE id=review)<>'studio.creation.v1'
    OR snapshot#>>'{direction,viewer}'<>'First-time creators' OR snapshot#>>'{accepted,Title}'<>'Two openings'
    OR snapshot#>>'{profile,version}'<>'4' OR NOT (snapshot#>'{profile,unconfirmedFields}' ? 'audience') OR snapshot#>>'{template,versionId}'<>template_version::text
    OR snapshot#>>'{evidence,0,id}'<>citation::text OR snapshot#>>'{evidence,0,start}'<>'42'
    OR snapshot#>>'{evidence,0,quote}'<>'The title and opening set the promise.' OR snapshot::text LIKE '%fictional%' THEN
    RAISE EXCEPTION 'Staged snapshot mixed evidence, profile or objective: %',snapshot;
  END IF;
  claim:=studio.studio_text_device_command(repeat('7',64),'substo','claim','{"workerId":"creation-mac","limit":1,"leaseSeconds":60,"textReady":true}');
  fenced:=jsonb_build_object('workerId','creation-mac','jobId',job,'leaseToken',claim->0->>'lease_token');
  output:=jsonb_build_object('options','[]'::jsonb,'text','Show opening A, then opening B. Explain the promise. Briefly show Studio.',
    'rationale','Compares the same promise in two openings.', 'evidenceIds',jsonb_build_array(snapshot#>>'{evidence,0,id}'),'verification','[]'::jsonb);
  BEGIN
    PERFORM studio.studio_text_device_command(repeat('7',64),'substo','complete',fenced||jsonb_build_object('result',
      jsonb_build_object('output',output||'{"evidenceIds":["invented"]}','provider','codex','model','native-default')));
    RAISE EXCEPTION 'Invented evidence accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM studio.studio_text_device_command(repeat('7',64),'substo','complete',fenced||jsonb_build_object('result',
    jsonb_build_object('output',output,'provider','codex','model','native-default')));
  IF (SELECT payload->>'script' FROM studio.studio_records WHERE id=draft) IS NOT NULL OR
    EXISTS(SELECT 1 FROM studio.studio_ai_attempts WHERE job_id=job) THEN RAISE EXCEPTION 'Auto-applied or billed a subscription'; END IF;
  BEGIN
    PERFORM studio.studio_apply_script_brief(loc,'substo',actor,review,gen_random_uuid(),4,true);
    RAISE EXCEPTION 'Historical apply accepted staged run';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  UPDATE public.settings_documents SET version=5 WHERE scope_id=loc;
  BEGIN
    PERFORM studio.studio_save_creation(loc,'substo',actor,draft,4,'Two openings',patch,false,NULL,NULL,NULL,review);
    RAISE EXCEPTION 'Changed Business profile did not fence apply';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  UPDATE public.settings_documents SET version=4 WHERE scope_id=loc;
  saved:=studio.studio_save_creation(loc,'substo',actor,draft,4,'Two openings',
    patch||jsonb_build_object('script',output->>'text','stage','script'),false,NULL,NULL,NULL,review);
  IF saved#>>'{payload,script}'<>output->>'text' OR (saved->>'version')::int<>5 THEN RAISE EXCEPTION 'Reviewed draft did not apply'; END IF;
  BEGIN
    PERFORM studio.studio_save_creation(loc,'substo',actor,draft,4,'Two openings',patch,false,NULL,NULL,NULL,review);
    RAISE EXCEPTION 'Concurrent edit was overwritten';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  PERFORM studio.studio_change_record_link(loc,draft,old_a,'remove',5,'substo',actor);
  BEGIN
    PERFORM studio.studio_build_selected_text_snapshot(loc,jsonb_build_array(jsonb_build_object('id',draft,'version',6,
      'creation',jsonb_build_object('kind','draft','stage','Script','feedback','',
      'linkedDraft',jsonb_build_object('id',old_a,'version',1,'purpose','revise')))),'','script_brief');
    RAISE EXCEPTION 'An unlinked draft entered context';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  IF NOT EXISTS(SELECT 1 FROM studio.studio_records WHERE id=old_a AND location_id=loc AND NOT archived)
    OR NOT EXISTS(SELECT 1 FROM studio.studio_idea_reviews r WHERE r.id=review AND r.result=output AND r.snapshot->'priorDraft'='null'::jsonb)
    THEN RAISE EXCEPTION 'Unlinking removed a record or earlier proposal'; END IF;
END $$;
