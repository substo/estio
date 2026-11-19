BEGIN;

ALTER FUNCTION studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text)
  RENAME TO studio_build_snapshot_before_curation;

-- Selected finding references are resolved from immutable, Location-owned outline results.
CREATE FUNCTION studio.studio_findings_for_idea(p_location text,p_source uuid,p_outline uuid,p_refs jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE outline studio.studio_knowledge_outlines%rowtype; batch studio.studio_idea_reviews%rowtype;
  item jsonb; finding jsonb; unit jsonb; gathered jsonb:='[]'; at_index integer;
BEGIN
  SELECT * INTO outline FROM studio.studio_knowledge_outlines o
    WHERE o.location_id=p_location AND o.source_id=p_source AND o.id=p_outline;
  IF NOT FOUND OR jsonb_typeof(p_refs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_refs) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Select findings from this source' USING ERRCODE='22023';
  END IF;
  IF studio.studio_outline_input(p_location,p_source,NULL,outline.input_mode,outline.input_id)->>'fingerprint'
    IS DISTINCT FROM outline.fingerprint THEN RAISE EXCEPTION 'Source evidence changed' USING ERRCODE='40001'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
    IF jsonb_typeof(item->'index') IS DISTINCT FROM 'number' OR item->>'index' !~ '^[0-9]$' THEN
      RAISE EXCEPTION 'Invalid finding reference' USING ERRCODE='22023';
    END IF;
    at_index:=(item->>'index')::integer;
    SELECT * INTO batch FROM studio.studio_idea_reviews r
      WHERE r.location_id=p_location AND r.id=(item->>'reviewId')::uuid AND r.workflow='knowledge_extract'
        AND r.snapshot->>'mode'='outline' AND r.snapshot->>'inputId'=p_outline::text AND r.stale_at_completion=false;
    IF NOT FOUND THEN RAISE EXCEPTION 'Finding is unavailable for this source' USING ERRCODE='22023'; END IF;
    finding:=batch.result->'findings'->at_index;
    SELECT u INTO unit FROM jsonb_array_elements(batch.snapshot->'units') u WHERE u->>'id'=finding->>'unitId';
    IF unit IS NULL OR nullif(btrim(finding->>'quote'),'') IS NULL OR strpos(unit->>'text',finding->>'quote')=0 THEN
      RAISE EXCEPTION 'The selected quote does not match its saved passage' USING ERRCODE='22023';
    END IF;
    gathered:=gathered||jsonb_build_array(jsonb_build_object(
      'id',batch.id::text||':'||at_index,'reviewId',batch.id,'findingIndex',at_index,'statement',finding->>'statement',
      'unverified',finding->>'kind'='claim' OR coalesce(finding#>>'{curation,basis}'='speaker_claim',false),
      'text',finding->>'quote','evidenceType',unit->'evidenceType','unitIndex',unit->'unitIndex',
      'startSeconds',unit->'startSeconds','endSeconds',unit->'endSeconds'));
  END LOOP;
  IF (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(gathered) v)<>jsonb_array_length(gathered) THEN
    RAISE EXCEPTION 'Choose distinct finding references' USING ERRCODE='22023';
  END IF;
  RETURN gathered;
END;
$$;

CREATE FUNCTION studio.studio_build_knowledge_snapshot(p_location_id text,p_source_id uuid,p_expected_version bigint,p_mode text,
  p_input_id text,p_start_unit integer,p_unit_count integer,p_focus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; choice jsonb; selected jsonb; source studio.studio_records%rowtype;
BEGIN
  IF p_mode='source_assist' AND left(p_focus,9)='@outline:' THEN
    IF p_input_id IS DISTINCT FROM 'propose_idea' OR p_start_unit IS DISTINCT FROM 0 OR octet_length(p_focus)>13000 THEN
      RAISE EXCEPTION 'Invalid selected idea request' USING ERRCODE='22023';
    END IF;
    choice:=substring(p_focus FROM 10)::jsonb;
    IF jsonb_typeof(choice->'reaction') IS DISTINCT FROM 'string' OR char_length(choice->>'reaction')>2000 THEN
      RAISE EXCEPTION 'Invalid reaction' USING ERRCODE='22023';
    END IF;
    SELECT * INTO source FROM studio.studio_records WHERE location_id=p_location_id AND id=p_source_id
      AND version=p_expected_version AND kind='reference' AND NOT archived FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source changed or unavailable' USING ERRCODE='40001'; END IF;
    selected:=studio.studio_findings_for_idea(p_location_id,p_source_id,(choice->>'outlineId')::uuid,choice->'selections');
    snapshot:=jsonb_build_object('source',jsonb_build_object('id',source.id,'version',source.version,'title',left(source.title,180),'url',source.source_url),
      'mode',p_mode,'inputId',p_input_id,'startUnit',0,'unitCount',jsonb_array_length(selected),'focus',p_focus,'notes','',
      'selectedOutline',choice->>'outlineId','reaction',choice->>'reaction',
      'units',selected,'coverage',jsonb_build_object('totalUnits',jsonb_array_length(selected),'selectedUnits',jsonb_array_length(selected),'totalCharacters',NULL));
    IF octet_length(snapshot::text)>20000 THEN RAISE EXCEPTION 'Select fewer citations for this idea' USING ERRCODE='P2010'; END IF;
    RETURN snapshot;
  END IF;
  snapshot:=studio.studio_build_snapshot_before_curation(p_location_id,p_source_id,p_expected_version,p_mode,p_input_id,p_start_unit,p_unit_count,p_focus);
  IF p_mode='outline' AND EXISTS(SELECT 1 FROM studio.studio_knowledge_outlines
    WHERE location_id=p_location_id AND id=p_input_id::uuid AND request->>'curationVersion'='1') THEN
    RETURN snapshot||'{"curationVersion":1}'::jsonb;
  END IF;
  RETURN snapshot;
END;
$$;

ALTER FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb)
  RENAME TO studio_validate_text_result_before_curation;
CREATE FUNCTION studio.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cur jsonb;
BEGIN
  PERFORM studio.studio_validate_text_result_before_curation(p_workflow,p_result,snapshot);
  IF p_workflow='knowledge_extract' AND snapshot->>'mode'='source_assist' AND snapshot ? 'selectedOutline'
    AND jsonb_array_length(p_result->'citations')=0 THEN
    RAISE EXCEPTION 'The selected idea must cite original evidence' USING ERRCODE='22023';
  END IF;
  IF p_workflow='knowledge_extract' AND snapshot->>'mode'='outline' AND snapshot->>'curationVersion'='1' THEN
    FOR cur IN SELECT f->'curation' FROM jsonb_array_elements(p_result->'findings') f LOOP
      IF jsonb_typeof(cur) IS DISTINCT FROM 'object' OR NOT (cur ?& ARRAY['featured','use','equivalentPoint','basis'])
        OR cur - ARRAY['featured','use','equivalentPoint','basis'] <> '{}'::jsonb
        OR jsonb_typeof(cur->'featured') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(cur->'use') IS DISTINCT FROM 'string' OR char_length(cur->>'use') NOT BETWEEN 1 AND 100
        OR cur->>'use' ~ '[[:cntrl:]]|^[[:space:]]|[[:space:]]$'
        OR coalesce(cur->>'basis','') NOT IN ('advice','speaker_claim','example')
        OR (cur->'equivalentPoint'<>'null'::jsonb AND
           (jsonb_typeof(cur->'equivalentPoint')<>'string' OR cur->>'equivalentPoint' !~ '^[a-z0-9-]{1,100}$')) THEN
        RAISE EXCEPTION 'Invalid editorial curation' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_text_prompt_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF new.workflow='idea_review' THEN new.prompt_version:='studio.idea-review.v2';
  ELSIF new.workflow='script_brief' THEN new.prompt_version:='studio.script-brief.v2';
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='outline' THEN new.prompt_version:=CASE WHEN new.snapshot->>'curationVersion'='1' THEN 'studio.knowledge-extract.v3' ELSE 'studio.knowledge-extract.v2' END;
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='script_template' THEN new.prompt_version:='studio.video-template.v1';
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='source_assist' THEN new.prompt_version:=CASE WHEN new.snapshot ? 'selectedOutline' THEN 'studio.source-assist.selected-idea.v1' ELSE 'studio.source-assist.v1' END;
  END IF;
  RETURN new;
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
   and (run.snapshot->>'curationVersion' is distinct from '1' or report->>'knowledgeCurationVersion'='1')
   and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'script_template' or report->>'videoTemplateVersion'='1')
   and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'source_assist' or report->>'sourceAssistVersion'='1')
   and (run.snapshot->>'selectedOutline' is null or report->>'knowledgeCurationVersion'='1')
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

CREATE OR REPLACE FUNCTION studio.studio_enqueue_source_assist(p_location text, p_app text, p_actor text, p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM studio.studio_lock_location_member(p_location, p_app, p_actor);
  IF p_command->>'provider' IS NULL OR jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number'
    OR p_command->>'intent' NOT IN ('discuss','rewrite_note','propose_idea') OR jsonb_typeof(p_command->'message') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Explicit assistant command required' USING ERRCODE = '22023';
  END IF;
  IF (p_command ? 'selection' AND p_command->>'intent' IS DISTINCT FROM 'propose_idea')
    OR left(p_command->>'message',9)='@outline:' THEN RAISE EXCEPTION 'Invalid assistant context' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location,0));
  IF EXISTS (SELECT 1 FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
    WHERE r.location_id=p_location AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='source_assist'
      AND r.created_by_clerk_user_id=p_actor AND r.actor_app=p_app AND r.snapshot#>>'{source,id}'=p_command->>'sourceId'
      AND r.request_id IS DISTINCT FROM (p_command->>'requestId')::uuid AND j.status IN ('queued','running')) THEN
    RAISE EXCEPTION 'An assistant request is already active for this source' USING ERRCODE = 'P2015';
  END IF;
  RETURN studio.studio_enqueue_routed_text_run(p_location,p_app,p_actor,'knowledge_extract',p_command ||
    jsonb_build_object('mode','source_assist','inputId',p_command->>'intent','startUnit',0,'unitCount',1,'focus',CASE WHEN p_command ? 'selection' THEN '@outline:'||((p_command->'selection')||
      jsonb_build_object('reaction',p_command->>'message'))::text ELSE p_command->>'message' END));
END;
$$;

CREATE TABLE studio.studio_knowledge_private_triage (
  location_id text NOT NULL,
  outline_id uuid NOT NULL,
  actor_app text NOT NULL,
  actor_id text NOT NULL,
  finding_key text NOT NULL,
  state text NOT NULL CHECK(state IN ('kept','hidden')),
  PRIMARY KEY(location_id,outline_id,actor_app,actor_id,finding_key),
  FOREIGN KEY(location_id,outline_id) REFERENCES studio.studio_knowledge_outlines(location_id,id) ON DELETE CASCADE
);
ALTER TABLE studio.studio_knowledge_private_triage ENABLE ROW LEVEL SECURITY;

ALTER FUNCTION studio.studio_get_knowledge_outline(text,text,text,uuid) RENAME TO studio_get_outline_before_triage;
CREATE FUNCTION studio.studio_get_knowledge_outline(p_location text,p_app text,p_actor text,p_outline uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT studio.studio_get_outline_before_triage(p_location,p_app,p_actor,p_outline) ||
    jsonb_build_object('triage',coalesce((SELECT jsonb_object_agg(finding_key,state)
      FROM studio.studio_knowledge_private_triage
      WHERE location_id=p_location AND outline_id=p_outline AND actor_app=p_app AND actor_id=p_actor),'{}'::jsonb));
$$;

ALTER FUNCTION studio.studio_change_knowledge_outline(text,text,text,jsonb) RENAME TO studio_change_outline_before_triage;
CREATE FUNCTION studio.studio_change_knowledge_outline(p_location text,p_app text,p_actor text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_outline uuid; k text; new_state text; v_id uuid; request jsonb; prior studio.studio_knowledge_outline_commands%rowtype;
BEGIN
  IF p_command->>'action' IS DISTINCT FROM 'triage' THEN
    RETURN studio.studio_change_outline_before_triage(p_location,p_app,p_actor,p_command);
  END IF;
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  v_outline:=(p_command->>'outlineId')::uuid;
  v_id:=(p_command->>'requestId')::uuid;
  k:=p_command->>'nodeKey';
  new_state:=p_command->>'state';
  IF v_id IS NULL OR v_outline IS NULL OR k IS NULL OR k !~ '^finding:[a-f0-9-]{36}:[0-9]$'
    OR coalesce(new_state,'') NOT IN ('kept','hidden','clear') OR NOT EXISTS(
      SELECT 1 FROM studio.studio_knowledge_outlines o WHERE o.location_id=p_location AND o.actor_app=p_app AND o.id=v_outline)
    OR NOT studio.studio_outline_node_exists(p_location,v_outline,k) THEN
    RAISE EXCEPTION 'Invalid private triage target' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge-outline-request:'||p_location||':'||v_id,0));
  request:=p_command||jsonb_build_object('app',p_app,'actor',p_actor);
  SELECT * INTO prior FROM studio.studio_knowledge_outline_commands WHERE location_id=p_location AND request_id=v_id;
  IF FOUND THEN
    IF prior.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'Review request reused' USING ERRCODE='23505'; END IF;
    RETURN prior.result;
  END IF;
  IF new_state='clear' THEN
    DELETE FROM studio.studio_knowledge_private_triage
      WHERE location_id=p_location AND outline_id=v_outline AND actor_app=p_app AND actor_id=p_actor AND finding_key=k;
  ELSE
    INSERT INTO studio.studio_knowledge_private_triage(location_id,outline_id,actor_app,actor_id,finding_key,state)
    VALUES(p_location,v_outline,p_app,p_actor,k,new_state)
    ON CONFLICT ON CONSTRAINT studio_knowledge_private_triage_pkey DO UPDATE SET state=excluded.state;
  END IF;
  INSERT INTO studio.studio_knowledge_outline_commands(location_id,request_id,outline_id,request,result)
    VALUES(p_location,v_id,v_outline,request,jsonb_build_object('state',new_state));
  RETURN jsonb_build_object('state',new_state);
END;
$$;

-- Idea creation retrieves only the signed-in author's completed draft and its server-resolved evidence.
CREATE FUNCTION studio.studio_selected_idea_evidence(p_location text,p_app text,p_actor text,p_source uuid,p_draft uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snap jsonb; proposal jsonb;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  SELECT snapshot,result INTO snap,proposal FROM studio.studio_idea_reviews r WHERE r.location_id=p_location AND r.actor_app=p_app
    AND r.created_by_clerk_user_id=p_actor AND r.id=p_draft AND r.workflow='knowledge_extract'
    AND r.snapshot->>'mode'='source_assist' AND r.snapshot->>'inputId'='propose_idea'
    AND r.snapshot ? 'selectedOutline' AND r.snapshot#>>'{source,id}'=p_source::text
    AND r.result IS NOT NULL AND r.stale_at_completion=false;
  IF NOT FOUND OR NOT studio.studio_knowledge_snapshot_current(p_location,snap) THEN
    RAISE EXCEPTION 'The draft evidence changed or is unavailable' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object('draftReviewId',p_draft,'outlineId',snap->>'selectedOutline','sourceId',p_source,'findings',snap->'units','limitations',proposal->'limitations');
END;
$$;

REVOKE ALL ON FUNCTION studio.studio_findings_for_idea(text,uuid,uuid,jsonb),
  studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text),
  studio.studio_validate_text_run_result(text,jsonb,jsonb),
  studio.studio_get_knowledge_outline(text,text,text,uuid),
  studio.studio_change_knowledge_outline(text,text,text,jsonb),
  studio.studio_selected_idea_evidence(text,text,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION studio.studio_get_outline_before_triage(text,text,text,uuid),
  studio.studio_change_outline_before_triage(text,text,text,jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION studio.studio_get_knowledge_outline(text,text,text,uuid),
  studio.studio_change_knowledge_outline(text,text,text,jsonb),
  studio.studio_selected_idea_evidence(text,text,text,uuid,uuid) TO service_role;
COMMIT;
