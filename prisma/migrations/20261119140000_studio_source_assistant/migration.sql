BEGIN;

-- Single-source assistant: one bounded text operation (discuss / rewrite a note / propose an idea) over ONE saved source.
-- It reuses the knowledge_extract text-run pipeline, explicit funding choice, device admission, leases, replay fence and
-- stale checks. The model proposes only; saving notes and creating ideas stay separate, explicit user commands.

CREATE FUNCTION studio.studio_build_source_assist_snapshot(p_location text, p_source uuid, p_version bigint, p_intent text, p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r studio.studio_records%rowtype; evidence jsonb; speech jsonb; ocr jsonb; chosen jsonb; snapshot jsonb;
  speech_count integer := 0; ocr_count integer := 0; use_speech integer := 0; use_ocr integer := 0; notes text; has_transcript boolean;
BEGIN
  IF p_intent NOT IN ('discuss','rewrite_note','propose_idea') OR p_message IS NULL OR char_length(btrim(p_message)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Invalid assistant request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM studio.studio_records WHERE location_id = p_location AND id = p_source AND kind = 'reference' AND NOT archived FOR SHARE;
  IF NOT FOUND OR r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Source changed or unavailable' USING ERRCODE = '40001'; END IF;
  notes := left(coalesce(r.payload->>'notes', ''), 2000);
  has_transcript := nullif(btrim(coalesce(r.payload->>'transcript', '')), '') IS NOT NULL;
  IF has_transcript THEN
    evidence := studio.studio_outline_input(p_location, p_source, p_version, 'record_text', 'transcript');
    SELECT coalesce(jsonb_agg(u - 'context' - 'originalUnitId' ORDER BY n) FILTER (WHERE u->>'evidenceType' IN ('speech','text')), '[]'::jsonb),
      coalesce(jsonb_agg(u - 'context' - 'originalUnitId' ORDER BY n) FILTER (WHERE u->>'evidenceType' = 'ocr'), '[]'::jsonb)
      INTO speech, ocr FROM jsonb_array_elements(evidence->'units') WITH ORDINALITY a(u, n);
    speech_count := jsonb_array_length(speech); ocr_count := jsonb_array_length(ocr);
  ELSIF nullif(btrim(coalesce(r.payload->>'description', '')), '') IS NOT NULL THEN
    speech := jsonb_build_array(jsonb_build_object('id','description:0','text',left(r.payload->>'description', 3000),'evidenceType','text',
      'startChar',0,'endChar',least(char_length(r.payload->>'description'),3000),'startSeconds',NULL,'endSeconds',NULL,'unitIndex',0));
    ocr := '[]'::jsonb; speech_count := 1;
    evidence := jsonb_build_object('source', jsonb_build_object('id',r.id,'version',r.version,'title',left(r.title,180),'url',r.source_url),
      'characters', least(char_length(r.payload->>'description'),3000), 'fingerprint', encode(sha256(convert_to(r.payload->>'description','UTF8')),'hex'));
  ELSE
    RAISE EXCEPTION 'Save a transcript or description on this source first' USING ERRCODE = 'P2013';
  END IF;
  use_speech := least(speech_count, 60); use_ocr := least(ocr_count, 12);
  LOOP
    SELECT coalesce(jsonb_agg(u ORDER BY (u->>'unitIndex')::integer), '[]'::jsonb) INTO chosen FROM (
      SELECT speech->(i * (speech_count - 1) / greatest(use_speech - 1, 1)) AS u FROM generate_series(0, use_speech - 1) i WHERE speech_count > 0
      UNION ALL
      SELECT ocr->(i * (ocr_count - 1) / greatest(use_ocr - 1, 1)) FROM generate_series(0, use_ocr - 1) i WHERE ocr_count > 0
    ) sampled;
    snapshot := jsonb_build_object('source', evidence->'source', 'mode', 'source_assist', 'inputId', p_intent,
      'startUnit', 0, 'unitCount', jsonb_array_length(chosen), 'focus', p_message, 'fingerprint', evidence->>'fingerprint',
      'notes', notes, 'units', chosen,
      'coverage', jsonb_build_object('totalUnits', speech_count + ocr_count, 'selectedUnits', jsonb_array_length(chosen),
        'totalCharacters', evidence->'characters', 'speechUnits', speech_count, 'selectedSpeech', use_speech, 'ocrUnits', ocr_count, 'selectedOcr', use_ocr));
    IF octet_length(snapshot::text) <= 20000 THEN RETURN snapshot; END IF;
    IF use_speech <= least(speech_count, 2) AND use_ocr <= 1 THEN
      RAISE EXCEPTION 'Source evidence exceeds the assistant limit' USING ERRCODE = 'P2010';
    END IF;
    use_speech := greatest(least(speech_count, 2), use_speech / 2);
    IF use_ocr > 1 THEN use_ocr := greatest(1, use_ocr / 2); END IF;
  END LOOP;
END;
$$;

ALTER FUNCTION studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text)
  RENAME TO studio_build_knowledge_or_template_snapshot;
CREATE FUNCTION studio.studio_build_knowledge_snapshot(p_location_id text,p_source_id uuid,p_expected_version bigint,p_mode text,
  p_input_id text,p_start_unit integer,p_unit_count integer,p_focus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_mode = 'source_assist' THEN
    IF p_start_unit IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Invalid assistant evidence selection' USING ERRCODE = '22023'; END IF;
    RETURN studio.studio_build_source_assist_snapshot(p_location_id, p_source_id, p_expected_version, p_input_id, p_focus);
  END IF;
  RETURN studio.studio_build_knowledge_or_template_snapshot(p_location_id,p_source_id,p_expected_version,p_mode,p_input_id,p_start_unit,p_unit_count,p_focus);
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_text_prompt_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF new.workflow='idea_review' THEN new.prompt_version:='studio.idea-review.v2';
  ELSIF new.workflow='script_brief' THEN new.prompt_version:='studio.script-brief.v2';
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='outline' THEN new.prompt_version:='studio.knowledge-extract.v2';
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='script_template' THEN new.prompt_version:='studio.video-template.v1';
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='source_assist' THEN new.prompt_version:='studio.source-assist.v1';
  END IF;
  RETURN new;
END;
$$;

ALTER FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb) RENAME TO studio_validate_text_run_result_before_assist;
CREATE FUNCTION studio.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE citation jsonb; intent text; field text;
BEGIN
  IF p_workflow <> 'knowledge_extract' OR snapshot->>'mode' IS DISTINCT FROM 'source_assist' THEN
    PERFORM studio.studio_validate_text_run_result_before_assist(p_workflow,p_result,snapshot);
    RETURN;
  END IF;
  intent := snapshot->>'inputId';
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text) > 12000
    OR p_result - ARRAY['reply','note','ideaTitle','ideaConcept','relatedQuery','citations','limitations'] <> '{}'::jsonb
    OR NOT (p_result ?& ARRAY['reply','note','ideaTitle','ideaConcept','relatedQuery','citations','limitations'])
    OR jsonb_typeof(p_result->'reply') IS DISTINCT FROM 'string' OR char_length(btrim(p_result->>'reply')) NOT BETWEEN 1 AND 1500
    OR jsonb_typeof(p_result->'citations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'citations') > 3
    OR jsonb_typeof(p_result->'limitations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'limitations') > 3 THEN
    RAISE EXCEPTION 'Invalid assistant reply' USING ERRCODE = '22023';
  END IF;
  FOREACH field IN ARRAY ARRAY['note','ideaTitle','ideaConcept','relatedQuery'] LOOP
    IF jsonb_typeof(p_result->field) NOT IN ('string','null') OR (jsonb_typeof(p_result->field)='string' AND char_length(btrim(p_result->>field))
      NOT BETWEEN 1 AND (CASE field WHEN 'note' THEN 1500 WHEN 'ideaTitle' THEN 120 WHEN 'ideaConcept' THEN 2000 ELSE 160 END)) THEN
      RAISE EXCEPTION 'Invalid assistant proposal field' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (intent = 'rewrite_note') <> (jsonb_typeof(p_result->'note') = 'string')
    OR (intent = 'propose_idea') <> (jsonb_typeof(p_result->'ideaTitle') = 'string' AND jsonb_typeof(p_result->'ideaConcept') = 'string')
    OR (intent <> 'propose_idea' AND (jsonb_typeof(p_result->'ideaTitle') <> 'null' OR jsonb_typeof(p_result->'ideaConcept') <> 'null')) THEN
    RAISE EXCEPTION 'Assistant proposal does not match the requested action' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_result->'limitations') item WHERE jsonb_typeof(item) <> 'string' OR char_length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 300)
    OR (jsonb_array_length(p_result->'citations') = 0 AND jsonb_array_length(p_result->'limitations') = 0) THEN
    RAISE EXCEPTION 'Assistant limitations are required without citations' USING ERRCODE = '22023';
  END IF;
  FOR citation IN SELECT * FROM jsonb_array_elements(p_result->'citations') LOOP
    IF jsonb_typeof(citation) IS DISTINCT FROM 'object' OR citation - ARRAY['unitId','quote'] <> '{}'::jsonb
      OR jsonb_typeof(citation->'unitId') IS DISTINCT FROM 'string' OR jsonb_typeof(citation->'quote') IS DISTINCT FROM 'string'
      OR char_length(btrim(citation->>'quote')) NOT BETWEEN 1 AND 300 OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(snapshot->'units') u WHERE u->>'id'=citation->>'unitId' AND strpos(u->>'text',citation->>'quote')>0
      ) THEN RAISE EXCEPTION 'Assistant citation must match its saved passage exactly' USING ERRCODE = '22023'; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_apply_knowledge_extraction(p_location_id text,p_actor_app text,p_clerk_user_id text,p_review_id uuid,
  p_request_id uuid,p_expected_version bigint,p_finding_indexes jsonb,p_confirm_pending boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  IF EXISTS(SELECT 1 FROM studio.studio_idea_reviews WHERE location_id=p_location_id AND id=p_review_id
    AND snapshot->>'mode' IN ('outline','script_template','source_assist')) THEN
    RAISE EXCEPTION 'Use the original review workflow to apply this result' USING ERRCODE='22023';
  END IF;
  RETURN studio.studio_apply_knowledge_extraction_findings(p_location_id,p_actor_app,p_clerk_user_id,
    p_review_id,p_request_id,p_expected_version,p_finding_indexes,p_confirm_pending);
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_enqueue_routed_text_run(p_location_id text,p_actor_app text,p_clerk_user_id text,p_workflow text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare route text:=coalesce(p_command->>'provider','openai'); r jsonb; run studio.studio_idea_reviews%rowtype; d studio.studio_devices%rowtype; prior uuid;
begin
 if p_workflow='knowledge_extract' and p_command->>'mode'='script_template' then
  perform studio.studio_lock_script_template_actor(p_location_id,p_actor_app,p_clerk_user_id,false);
 else
  perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 end if;
 if route not in ('openai','subscription') or p_workflow not in ('idea_review','script_brief','knowledge_extract')
 or (route='openai' and p_command->>'confirmPaid' is distinct from 'true')
 or (route='subscription' and p_command->>'confirmSubscription' is distinct from 'true') then raise exception 'Explicit provider authorization required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location_id,0));
 select id into prior from studio.studio_idea_reviews where location_id=p_location_id and request_id=(p_command->>'requestId')::uuid;
 if prior is null and route='openai' and not exists(select 1 from public.settings_secrets where scope_type::text='LOCATION' and scope_id=p_location_id and domain='location.ai' and secret_key='openai_api_key') then
  raise exception 'Add a Location OpenAI API key before queuing this workflow' using errcode='22023';
 end if;
 if p_workflow='knowledge_extract' then
  r:=studio.studio_enqueue_knowledge_extraction(p_location_id,p_actor_app,p_clerk_user_id,(p_command->>'requestId')::uuid,(p_command->>'sourceId')::uuid,(p_command->>'expectedVersion')::bigint,p_command->>'mode',p_command->>'inputId',(p_command->>'startUnit')::integer,(p_command->>'unitCount')::integer,p_command->>'focus',true);
 else
  r:=studio.studio_enqueue_text_run(p_location_id,p_actor_app,p_clerk_user_id,(p_command->>'requestId')::uuid,p_command->'ideas',p_command->>'focus',true,p_workflow);
 end if;
 select * into run from studio.studio_idea_reviews where id=(r->>'reviewId')::uuid for update;
 if prior is not null then
  if run.execution_provider<>route then raise exception 'Request provider changed' using errcode='23505'; end if;
  return r;
 end if;
 if route='subscription' then
  -- Account-scoped: a teammate's subscription is never borrowed. AI-manager consent is required for Mac work.
  perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
  select * into d from studio.studio_devices where location_id=p_location_id and app=p_actor_app and created_by=p_clerk_user_id
   and revoked_at is null and not paused and processing_enabled and 'studio.text_run'=any(allowed_kinds)
   and seen_at<=clock_timestamp() and seen_at>clock_timestamp()-interval '90 seconds' and coalesce(report->>'draining','false')='false'
   and report->'handlers' ? 'studio.text_run'
   and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'outline' or report->>'knowledgeOutlineVersion'='2')
   and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'script_template' or report->>'videoTemplateVersion'='1')
   and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'source_assist' or report->>'sourceAssistVersion'='1')
   and desired_config#>>'{features,text}'='true'
   and desired_config->>'textProvider' in ('codex','claude') and config_version=applied_config_version and config_status='applied'
   and report#>>ARRAY[desired_config->>'textProvider','ready']='true'
   and report#>>ARRAY[desired_config->>'textProvider','authenticated']='true'
   and report#>>ARRAY[desired_config->>'textProvider','loginMethod']=case desired_config->>'textProvider' when 'codex' then 'chatgpt' else 'claudeai' end
   and report#>>ARRAY['capacity',desired_config->>'textProvider']='true'
   and coalesce(report->'processingBlocked','[]'::jsonb)='[]'::jsonb
   order by seen_at desc limit 1 for update;
  if not found then
   if p_workflow='knowledge_extract' and p_command->>'mode'='script_template' then
    raise exception 'The template-capable paired Mac is not ready' using errcode='P2014';
   end if;
   if p_workflow='knowledge_extract' and p_command->>'mode'='source_assist' then
    raise exception 'The assistant-capable paired Mac is not ready' using errcode='P2016';
   end if;
   if p_workflow='knowledge_extract' and p_command->>'mode'='outline' then
    raise exception 'The updated paired Mac is not ready' using errcode='P2011';
   end if;
   raise exception 'Your paired Mac must be ready with Text work and a subscription provider selected and applied' using errcode='22023';
  end if;
  update studio.studio_idea_reviews set execution_provider=route,model='mac_'||(d.desired_config->>'textProvider')||':'||coalesce(d.desired_config->>'textModel','native-default') where id=run.id;
  update studio.studio_jobs set kind='studio.text_run',execution_target='device',device_id=d.id,max_attempts=1,
   payload=payload||jsonb_build_object('workflow',run.workflow,'snapshot',run.snapshot,'promptVersion',run.prompt_version,'provider',d.desired_config->>'textProvider','model',d.desired_config->'textModel','configVersion',d.config_version)
   where id=run.job_id;
 end if;
 return r;
end $$;

CREATE FUNCTION studio.studio_enqueue_source_assist(p_location text, p_app text, p_actor text, p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM studio.studio_lock_location_member(p_location, p_app, p_actor);
  IF p_command->>'provider' IS NULL OR jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number'
    OR p_command->>'intent' NOT IN ('discuss','rewrite_note','propose_idea') OR jsonb_typeof(p_command->'message') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Explicit assistant command required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location,0));
  IF EXISTS (SELECT 1 FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
    WHERE r.location_id=p_location AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='source_assist'
      AND r.created_by_clerk_user_id=p_actor AND r.actor_app=p_app AND r.snapshot#>>'{source,id}'=p_command->>'sourceId'
      AND r.request_id IS DISTINCT FROM (p_command->>'requestId')::uuid AND j.status IN ('queued','running')) THEN
    RAISE EXCEPTION 'An assistant request is already active for this source' USING ERRCODE = 'P2015';
  END IF;
  RETURN studio.studio_enqueue_routed_text_run(p_location,p_app,p_actor,'knowledge_extract',p_command ||
    jsonb_build_object('mode','source_assist','inputId',p_command->>'intent','startUnit',0,'unitCount',1,'focus',p_command->>'message'));
END;
$$;

REVOKE ALL ON FUNCTION studio.studio_build_source_assist_snapshot(text,uuid,bigint,text,text),
  studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text),
  studio.studio_build_knowledge_or_template_snapshot(text,uuid,bigint,text,text,integer,integer,text),
  studio.studio_validate_text_run_result(text,jsonb,jsonb), studio.studio_validate_text_run_result_before_assist(text,jsonb,jsonb),
  studio.studio_enqueue_source_assist(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_source_assist(text,text,text,jsonb) TO service_role;

COMMIT;
