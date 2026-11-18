BEGIN;

ALTER TABLE studio.studio_script_template_versions
  ADD COLUMN source_review_id uuid UNIQUE REFERENCES studio.studio_idea_reviews(id) ON DELETE SET NULL;

-- Read the released transcript/OCR evidence and keep a single model request bounded.
CREATE FUNCTION studio.studio_build_video_template_snapshot(p_location text, p_source uuid, p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  evidence jsonb; speech jsonb; ocr jsonb; chosen jsonb; snapshot jsonb;
  speech_count integer; ocr_count integer; use_speech integer; use_ocr integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM studio.studio_records WHERE location_id = p_location AND id = p_source
    AND kind = 'reference' AND NOT archived AND nullif(btrim(source_url), '') IS NOT NULL
    AND nullif(btrim(payload->>'transcript'), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'Save a video transcript before extracting a template' USING ERRCODE = 'P2013';
  END IF;
  evidence := studio.studio_outline_input(p_location, p_source, p_version, 'record_text', 'transcript');
  SELECT coalesce(jsonb_agg(u - 'context' - 'originalUnitId' ORDER BY n)
    FILTER (WHERE u->>'evidenceType' = 'speech' AND jsonb_typeof(u->'startSeconds') = 'number' AND jsonb_typeof(u->'endSeconds') = 'number'), '[]'::jsonb),
    coalesce(jsonb_agg(u - 'context' - 'originalUnitId' ORDER BY n)
    FILTER (WHERE u->>'evidenceType' = 'ocr'), '[]'::jsonb)
    INTO speech, ocr FROM jsonb_array_elements(evidence->'units') WITH ORDINALITY a(u, n);
  speech_count := jsonb_array_length(speech);
  ocr_count := jsonb_array_length(ocr);
  IF speech_count = 0 THEN
    RAISE EXCEPTION 'A timestamped transcript is required' USING ERRCODE = 'P2013';
  END IF;
  use_speech := least(speech_count, 120);
  use_ocr := least(ocr_count, 30);
  LOOP
    -- When sampling, span the saved timeline and retain the first and last speech passages.
    SELECT jsonb_agg(u ORDER BY (u->>'unitIndex')::integer) INTO chosen FROM (
      SELECT speech->(i * (speech_count - 1) / greatest(use_speech - 1, 1)) AS u FROM generate_series(0, use_speech - 1) i
      UNION ALL
      SELECT ocr->(i * (ocr_count - 1) / greatest(use_ocr - 1, 1)) FROM generate_series(0, use_ocr - 1) i
    ) sampled;
    snapshot := jsonb_build_object('source', evidence->'source', 'mode', 'script_template', 'inputId', 'transcript',
      'startUnit', 0, 'unitCount', jsonb_array_length(chosen), 'focus', '', 'fingerprint', evidence->>'fingerprint', 'units', chosen,
      'coverage', jsonb_build_object('totalUnits', speech_count + ocr_count, 'selectedUnits', jsonb_array_length(chosen),
        'totalCharacters', evidence->'characters', 'speechUnits', speech_count, 'selectedSpeech', use_speech, 'ocrUnits', ocr_count, 'selectedOcr', use_ocr));
    IF octet_length(snapshot::text) <= 23000 THEN RETURN snapshot; END IF;
    IF use_speech <= least(speech_count, 2) AND use_ocr <= 1 THEN
      RAISE EXCEPTION 'Video evidence exceeds the template extraction limit' USING ERRCODE = 'P2010';
    END IF;
    use_speech := greatest(least(speech_count, 2), use_speech / 2);
    IF use_ocr > 1 THEN use_ocr := greatest(1, use_ocr / 2); END IF;
  END LOOP;
END;
$$;

ALTER FUNCTION studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text)
  RENAME TO studio_build_knowledge_outline_or_range_snapshot;
CREATE FUNCTION studio.studio_build_knowledge_snapshot(p_location_id text,p_source_id uuid,p_expected_version bigint,p_mode text,
  p_input_id text,p_start_unit integer,p_unit_count integer,p_focus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_mode = 'script_template' THEN
    IF p_input_id IS DISTINCT FROM 'transcript' OR p_start_unit IS DISTINCT FROM 0 OR p_focus IS DISTINCT FROM '' THEN
      RAISE EXCEPTION 'Invalid template evidence selection' USING ERRCODE = '22023';
    END IF;
    RETURN studio.studio_build_video_template_snapshot(p_location_id, p_source_id, p_expected_version);
  END IF;
  RETURN studio.studio_build_knowledge_outline_or_range_snapshot(p_location_id,p_source_id,p_expected_version,
    p_mode,p_input_id,p_start_unit,p_unit_count,p_focus);
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_knowledge_snapshot_current(p_location_id text,p_snapshot jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN studio.studio_build_knowledge_snapshot(p_location_id,(p_snapshot#>>'{source,id}')::uuid,(p_snapshot#>>'{source,version}')::bigint,
    p_snapshot->>'mode',p_snapshot->>'inputId',(p_snapshot->>'startUnit')::integer,(p_snapshot->>'unitCount')::integer,p_snapshot->>'focus')=p_snapshot;
EXCEPTION WHEN serialization_failure OR invalid_parameter_value OR invalid_text_representation OR SQLSTATE 'P2010' OR SQLSTATE 'P2013' THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_text_prompt_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF new.workflow='idea_review' THEN new.prompt_version:='studio.idea-review.v2';
  ELSIF new.workflow='script_brief' THEN new.prompt_version:='studio.script-brief.v2';
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='outline' THEN new.prompt_version:='studio.knowledge-extract.v2';
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='script_template' THEN new.prompt_version:='studio.video-template.v1';
  END IF;
  RETURN new;
END;
$$;

ALTER FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb) RENAME TO studio_validate_knowledge_and_text_run_result;
CREATE FUNCTION studio.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE beat jsonb; citation jsonb; field text;
BEGIN
  IF p_workflow <> 'knowledge_extract' OR snapshot->>'mode' IS DISTINCT FROM 'script_template' THEN
    PERFORM studio.studio_validate_knowledge_and_text_run_result(p_workflow,p_result,snapshot);
    RETURN;
  END IF;
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>23000
    OR p_result - ARRAY['name','purpose','beats','limitations'] <> '{}'::jsonb
    OR jsonb_typeof(p_result->'name') IS DISTINCT FROM 'string' OR char_length(btrim(p_result->>'name')) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(p_result->'purpose') IS DISTINCT FROM 'string' OR char_length(btrim(p_result->>'purpose')) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_result->'beats') IS DISTINCT FROM 'array' OR jsonb_typeof(p_result->'limitations') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid video template proposal' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_result->'beats')>12 OR jsonb_array_length(p_result->'limitations')>5
    OR jsonb_array_length(p_result->'beats')+jsonb_array_length(p_result->'limitations')=0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_result->'limitations') item
      WHERE jsonb_typeof(item)<>'string' OR char_length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 300
    ) THEN RAISE EXCEPTION 'Invalid video template bounds' USING ERRCODE = '22023'; END IF;
  FOR beat IN SELECT * FROM jsonb_array_elements(p_result->'beats') LOOP
    IF jsonb_typeof(beat) IS DISTINCT FROM 'object' OR beat - ARRAY['name','guidance','rationale','citations'] <> '{}'::jsonb
      OR jsonb_typeof(beat->'citations') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid video template beat' USING ERRCODE = '22023';
    END IF;
    FOREACH field IN ARRAY ARRAY['name','guidance','rationale'] LOOP
      IF jsonb_typeof(beat->field) IS DISTINCT FROM 'string' OR char_length(btrim(beat->>field)) NOT BETWEEN 1 AND
        (CASE WHEN field='name' THEN 80 ELSE 500 END) THEN
        RAISE EXCEPTION 'Invalid video template beat text' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF jsonb_array_length(beat->'citations') NOT BETWEEN 1 AND 2 THEN
      RAISE EXCEPTION 'A beat needs one or two citations' USING ERRCODE = '22023';
    END IF;
    FOR citation IN SELECT * FROM jsonb_array_elements(beat->'citations') LOOP
      IF jsonb_typeof(citation) IS DISTINCT FROM 'object' OR citation - ARRAY['unitId','quote'] <> '{}'::jsonb
        OR jsonb_typeof(citation->'unitId') IS DISTINCT FROM 'string' OR jsonb_typeof(citation->'quote') IS DISTINCT FROM 'string'
        OR char_length(btrim(citation->>'quote')) NOT BETWEEN 1 AND 300 OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(snapshot->'units') u WHERE u->>'id'=citation->>'unitId'
            AND jsonb_typeof(u->'startSeconds')='number' AND strpos(u->>'text',citation->>'quote')>0
        ) THEN RAISE EXCEPTION 'Template citation must match its saved passage exactly' USING ERRCODE = '22023'; END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_apply_knowledge_extraction(p_location_id text,p_actor_app text,p_clerk_user_id text,p_review_id uuid,
  p_request_id uuid,p_expected_version bigint,p_finding_indexes jsonb,p_confirm_pending boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  IF EXISTS(SELECT 1 FROM studio.studio_idea_reviews WHERE location_id=p_location_id AND id=p_review_id
    AND snapshot->>'mode' IN ('outline','script_template')) THEN
    RAISE EXCEPTION 'Use the original review workflow to apply this result' USING ERRCODE='22023';
  END IF;
  RETURN studio.studio_apply_knowledge_extraction_findings(p_location_id,p_actor_app,p_clerk_user_id,
    p_review_id,p_request_id,p_expected_version,p_finding_indexes,p_confirm_pending);
END;
$$;

-- Reuse existing routing and funding. Admit this prompt only on a companion that advertises support.
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

CREATE FUNCTION studio.studio_enqueue_video_template(p_location text, p_app text, p_actor text, p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM studio.studio_lock_script_template_actor(p_location, p_app, p_actor, false);
  IF p_command->>'provider' IS NULL OR jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Explicit video template command required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location,0));
  IF EXISTS (SELECT 1 FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
    WHERE r.location_id=p_location AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='script_template'
      AND r.snapshot#>>'{source,id}'=p_command->>'sourceId' AND r.request_id IS DISTINCT FROM (p_command->>'requestId')::uuid
      AND j.status IN ('queued','running')) THEN
    RAISE EXCEPTION 'A template extraction is already active for this video' USING ERRCODE = 'P2015';
  END IF;
  RETURN studio.studio_enqueue_routed_text_run(p_location,p_app,p_actor,'knowledge_extract',p_command ||
    jsonb_build_object('mode','script_template','inputId','transcript','startUnit',0,'unitCount',1,'focus',''));
END;
$$;

CREATE FUNCTION studio.studio_save_video_template_draft(p_location text, p_app text, p_actor text, p_review uuid,
  p_template_id uuid, p_id uuid, p_name text, p_purpose text, p_beats jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE review studio.studio_idea_reviews%ROWTYPE; existing uuid;
BEGIN
  PERFORM studio.studio_lock_script_template_actor(p_location, p_app, p_actor, false);
  SELECT * INTO review FROM studio.studio_idea_reviews WHERE location_id=p_location AND id=p_review
    AND actor_app=p_app AND workflow='knowledge_extract' AND snapshot->>'mode'='script_template' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template extraction unavailable' USING ERRCODE = '42501'; END IF;
  SELECT template_id INTO existing FROM studio.studio_script_template_versions WHERE location_id=p_location AND source_review_id=p_review;
  IF FOUND THEN
    IF existing<>p_template_id THEN RAISE EXCEPTION 'This extraction already has a template draft' USING ERRCODE='23505'; END IF;
    RETURN studio.studio_propose_script_template(p_location,p_app,p_actor,p_template_id,p_id,0,p_name,p_purpose,p_beats);
  END IF;
  IF review.result IS NULL OR review.stale_at_completion IS DISTINCT FROM false
    OR NOT studio.studio_knowledge_snapshot_current(p_location, review.snapshot) THEN
    RAISE EXCEPTION 'Run a current template extraction before saving its draft' USING ERRCODE = '40001';
  END IF;
  IF jsonb_array_length(review.result->'beats')<1 THEN
    RAISE EXCEPTION 'The extraction has insufficient evidence for a template' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_beats) IS DISTINCT FROM 'array' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_beats) b WHERE b - ARRAY['name','guidance'] <> '{}'::jsonb
  ) THEN RAISE EXCEPTION 'Save reusable beat guidance only' USING ERRCODE='22023'; END IF;
  -- Persist the editor's reusable text; the cited model proposal stays in the review.
  PERFORM studio.studio_propose_script_template(p_location,p_app,p_actor,p_template_id,p_id,0,p_name,p_purpose,p_beats);
  UPDATE studio.studio_script_template_versions SET source_review_id=p_review WHERE location_id=p_location AND id=p_id
    AND (source_review_id IS NULL OR source_review_id=p_review);
  IF NOT FOUND THEN RAISE EXCEPTION 'Template draft source changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('id',p_id);
END;
$$;

REVOKE ALL ON FUNCTION studio.studio_build_video_template_snapshot(text,uuid,bigint),
  studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text),
  studio.studio_validate_text_run_result(text,jsonb,jsonb),
  studio.studio_knowledge_snapshot_current(text,jsonb),
  studio.studio_enqueue_video_template(text,text,text,jsonb),
  studio.studio_save_video_template_draft(text,text,text,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION studio.studio_enqueue_video_template(text,text,text,jsonb),
  studio.studio_save_video_template_draft(text,text,text,uuid,uuid,uuid,text,text,jsonb) TO service_role;

COMMIT;
