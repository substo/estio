BEGIN;

ALTER FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text)
  RENAME TO studio_build_selected_snapshot_before_creation;

CREATE FUNCTION studio.studio_build_selected_text_snapshot(p_location_id text,p_selection jsonb,p_focus text,p_workflow text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb:=p_selection->0; operation jsonb:=item->'creation'; record studio.studio_records%rowtype;
  state jsonb; accepted jsonb; sources jsonb; evidence jsonb; profile jsonb; snapshot jsonb;
  prior_choice jsonb:=operation->'linkedDraft'; prior_draft jsonb;
BEGIN
  IF p_workflow IS DISTINCT FROM 'script_brief' OR operation IS NULL THEN
    RETURN studio.studio_build_selected_snapshot_before_creation(p_location_id,p_selection,p_focus,p_workflow);
  END IF;
  IF jsonb_typeof(operation) IS DISTINCT FROM 'object'
    OR coalesce(operation->>'kind','') NOT IN ('draft','suggest','rewrite')
    OR coalesce(operation->>'stage','') NOT IN ('Concept','Angle','Title','Hook','Payoff','Script','Shoot plan')
    OR (operation->>'kind'='draft' AND operation->>'stage'<>'Script') OR octet_length(operation::text)>11000 THEN
    RAISE EXCEPTION 'Invalid staged creation operation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO record FROM studio.studio_records
    WHERE location_id=p_location_id AND id=(item->>'id')::uuid AND version=(item->>'version')::bigint
      AND kind='content' AND NOT archived AND payload#>>'{creation,schema}'='1' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Creation draft changed' USING ERRCODE='40001'; END IF;
  state:=record.payload->'creation';
  IF jsonb_typeof(state->'direction') IS DISTINCT FROM 'object' OR nullif(state#>>'{direction,goal}','') IS NULL THEN
    RAISE EXCEPTION 'Confirm the video direction first' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_object_agg(key,CASE WHEN key='Script' THEN left(value->>'text',5000) ELSE value->>'text' END),'{}'::jsonb)
    INTO accepted FROM jsonb_each(state->'stages')
    WHERE value->>'approved'='true'
      AND array_position(ARRAY['Concept','Angle','Title','Hook','Payoff','Script','Shoot plan'],key)
        < array_position(ARRAY['Concept','Angle','Title','Hook','Payoff','Script','Shoot plan'],operation->>'stage');

  WITH linked AS (
    SELECT s.* FROM studio.studio_record_links l JOIN studio.studio_records s
      ON s.location_id=l.location_id AND s.id=l.target_id
    WHERE l.location_id=p_location_id AND l.source_id=record.id AND s.kind='reference' AND NOT s.archived
      AND operation->>'includeReferences' IS DISTINCT FROM 'false'
    ORDER BY (s.id::text IS NOT DISTINCT FROM state#>>'{source,id}') DESC, s.id LIMIT 3
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'title',s.title,
    'url',left(s.source_url,1000),'excerpt','','excerpted',true) ORDER BY s.id),'[]'::jsonb)
    INTO sources FROM linked s;

  -- Use exact saved quotes with current source versions. Fill remaining slots with bounded transcript excerpts.
  WITH linked AS (
    SELECT s.* FROM studio.studio_records s WHERE s.location_id=p_location_id
      AND s.id IN (SELECT (link->>'id')::uuid FROM jsonb_array_elements(sources) link)
  ), citations AS (
    SELECT e.id::text AS id,i.version,s.id AS source_id,s.title,left(i.statement,300) AS statement,
      e.payload->>'quote' AS quote,e.payload->>'evidence_type' AS type,e.payload->>'start_sec' AS start
    FROM linked s JOIN studio.studio_knowledge_insights i
      ON i.location_id=s.location_id AND i.source_id=s.id
    JOIN studio.studio_knowledge_evidence e ON e.location_id=i.location_id AND e.insight_id=i.id AND e.source_id=s.id
    WHERE i.status='approved' AND e.payload->>'origin'='hosted_extraction'
      AND e.payload->>'source_version'=s.version::text
      AND e.payload->>'evidence_type' IN ('speech','ocr','text')
      AND char_length(btrim(e.payload->>'quote')) BETWEEN 1 AND 450
    ORDER BY i.id,e.id LIMIT 8
  ), excerpts AS (
    SELECT s.id::text||':transcript:'||sample AS id,s.version,s.id AS source_id,s.title,NULL::text AS statement,
      substring(btrim(s.payload->>'transcript') FROM 1+greatest(0,(char_length(btrim(s.payload->>'transcript'))-420)*sample/2) FOR 420) AS quote,
      'transcript excerpt' AS type,NULL::text AS start
    FROM linked s CROSS JOIN generate_series(0,2) sample
    WHERE char_length(btrim(s.payload->>'transcript'))>0 AND (sample=0 OR char_length(btrim(s.payload->>'transcript'))>840)
      AND NOT EXISTS (SELECT 1 FROM citations c WHERE c.source_id=s.id)
  ), selected AS (
    SELECT * FROM (SELECT 0 AS priority,* FROM citations UNION ALL SELECT 1,* FROM excerpts) e
    WHERE nullif(btrim(quote),'') IS NOT NULL ORDER BY priority,id LIMIT 8
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'sourceId',source_id,'title',title,
    'statement',statement,'quote',quote,'type',type,'start',start) ORDER BY priority,id),'[]'::jsonb) INTO evidence FROM selected;

  SELECT jsonb_build_object('version',d.version,'context',f.context,'truncatedFields',f.truncated,'unconfirmedFields',f.unconfirmed)
  INTO profile FROM public.settings_documents d CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_object_agg(fields.key,left(fields.value,400)),'{}'::jsonb) AS context,
      coalesce(jsonb_agg(fields.key ORDER BY fields.key) FILTER (WHERE char_length(fields.value)>400),'[]'::jsonb) AS truncated,
      coalesce(jsonb_agg(fields.key ORDER BY fields.key) FILTER (WHERE fields.confirmed_at IS NULL),'[]'::jsonb) AS unconfirmed
    FROM (
      SELECT k.key,d.payload#>>k.path AS value,d.payload#>>(k.path[1:2]||ARRAY['confirmedAt']) AS confirmed_at
      FROM (VALUES ('summary',ARRAY['identity','summary','value']),('offer',ARRAY['offer','description','value']),
        ('audience',ARRAY['audienceMarket','audience','value']),('tone',ARRAY['brandVoice','tone','value']),
        ('voiceInstructions',ARRAY['brandVoice','instructions','value']),('preferredWords',ARRAY['brandVoice','preferredWords','value']),
        ('avoidedWords',ARRAY['brandVoice','avoidedWords','value']),('contentPillars',ARRAY['brandVoice','contentPillars','value'])) k(key,path)
      WHERE d.payload#>>(k.path[1:2]||ARRAY['status'])='known' AND d.payload#>k.path IS NOT NULL
    ) fields
  ) f WHERE d.scope_type::text='LOCATION' AND d.scope_id=p_location_id AND d.domain='location.business';

  IF prior_choice IS NOT NULL AND prior_choice<>'null'::jsonb THEN
    IF jsonb_typeof(prior_choice) IS DISTINCT FROM 'object'
      OR coalesce(prior_choice->>'purpose','') NOT IN ('compare','revise') THEN
      RAISE EXCEPTION 'Choose an explicit use for the prior draft' USING ERRCODE='22023';
    END IF;
    SELECT jsonb_build_object('id',d.id,'version',d.version,'title',d.title,'purpose',prior_choice->>'purpose',
        'text',left(d.payload->>'script',3000),'truncated',char_length(d.payload->>'script')>3000)
    INTO prior_draft FROM studio.studio_records d JOIN studio.studio_record_links l ON l.location_id=d.location_id AND l.target_id=d.id
    WHERE d.location_id=p_location_id AND l.source_id=record.id AND d.id=(prior_choice->>'id')::uuid
      AND d.version=(prior_choice->>'version')::bigint AND d.kind='content' AND NOT d.archived
      AND nullif(btrim(d.payload->>'script'),'') IS NOT NULL FOR SHARE OF d;
    IF NOT FOUND THEN RAISE EXCEPTION 'Linked draft changed or unavailable' USING ERRCODE='40001'; END IF;
  END IF;

  snapshot:=jsonb_build_object('focus','','mode','staged_creation','operation',operation,
    'ideas',jsonb_build_array(jsonb_build_object('id',record.id,'version',record.version,'title',record.title,
      'summary','','notes','','excerpted',false,'sources',sources)),
    'brief',state->>'brief','direction',state->'direction','accepted',accepted,
    'profile',profile,'template',studio.studio_script_template_snapshot(p_location_id,record.id),'evidence',evidence,'priorDraft',prior_draft,
    'inputLimits',to_jsonb(array_remove(ARRAY['Saved source and historical draft notes omitted.',
      CASE WHEN operation->>'includeReferences'='false' THEN 'Linked reference evidence excluded by the author.'
        ELSE 'Linked reference evidence limited to three active references and up to eight current approved quotes or sampled transcript excerpts.' END,
      CASE WHEN prior_draft IS NULL THEN 'Historic linked scripts excluded.' WHEN prior_draft->>'truncated'='true' THEN 'Selected linked script truncated to 3,000 characters.' END,
      CASE WHEN profile IS NULL THEN 'No saved Business profile.' ELSE 'Unknown and inapplicable Business profile fields omitted.' END,
      CASE WHEN char_length(state#>>'{stages,Script,text}')>5000 AND accepted ? 'Script' THEN 'Accepted Script stage truncated to 5,000 characters.' END
    ],NULL)),
    'sourceConcept',CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(sources) link WHERE link->>'id'=state#>>'{source,id}')
      THEN (state->'source')-'version'::text ELSE NULL END);
  -- The original brief appears once even when the author confirmed it verbatim.
  IF state#>>'{direction,choice}'='brief' THEN snapshot:=snapshot#-'{direction,goal}'; END IF;
  IF octet_length(snapshot::text)>23000 THEN RAISE EXCEPTION 'Creation inputs exceed the bounded review size' USING ERRCODE='22023'; END IF;
  RETURN snapshot;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text) FROM PUBLIC;

ALTER FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb)
  RENAME TO studio_validate_text_result_before_creation;
CREATE FUNCTION studio.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text:=snapshot#>>'{operation,kind}'; item jsonb;
BEGIN
  IF p_workflow IS DISTINCT FROM 'script_brief' OR snapshot->>'mode' IS DISTINCT FROM 'staged_creation' THEN
    PERFORM studio.studio_validate_text_result_before_creation(p_workflow,p_result,snapshot);
    RETURN;
  END IF;
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR NOT (p_result ?& ARRAY['options','text','rationale','evidenceIds','verification'])
    OR p_result-ARRAY['options','text','rationale','evidenceIds','verification']<>'{}'::jsonb OR octet_length(p_result::text)>22000
    OR jsonb_typeof(p_result->'options') IS DISTINCT FROM 'array' OR jsonb_typeof(p_result->'evidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_result->'verification') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_result->'rationale') IS DISTINCT FROM 'string' OR char_length(btrim(p_result->>'rationale'))<1 OR char_length(p_result->>'rationale')>500 THEN
    RAISE EXCEPTION 'Invalid staged creation result' USING ERRCODE='22023';
  END IF;
  IF (kind='suggest' AND (jsonb_array_length(p_result->'options') NOT BETWEEN 1 AND 8 OR p_result->'text'<>'null'::jsonb))
    OR (kind<>'suggest' AND (jsonb_array_length(p_result->'options')<>0 OR jsonb_typeof(p_result->'text') IS DISTINCT FROM 'string'
      OR char_length(btrim(p_result->>'text'))<1 OR char_length(p_result->>'text')>CASE WHEN kind='rewrite' THEN 1800 ELSE 16000 END))
    OR jsonb_array_length(p_result->'evidenceIds')>8 OR jsonb_array_length(p_result->'verification')>8
    OR (SELECT count(DISTINCT btrim(o->>'text')) FROM jsonb_array_elements(p_result->'options') o)<>jsonb_array_length(p_result->'options')
    OR (SELECT count(DISTINCT e) FROM jsonb_array_elements(p_result->'evidenceIds') e)<>jsonb_array_length(p_result->'evidenceIds') THEN
    RAISE EXCEPTION 'Invalid staged creation output bounds' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'options') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT (item ?& ARRAY['text','rationale'])
      OR item-ARRAY['text','rationale']<>'{}'::jsonb OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'rationale') IS DISTINCT FROM 'string' OR char_length(btrim(item->>'text'))<1
      OR char_length(item->>'text')>(CASE snapshot#>>'{operation,stage}' WHEN 'Title' THEN 180 WHEN 'Script' THEN 1800 ELSE 1200 END) OR char_length(btrim(item->>'rationale'))<1 OR char_length(item->>'rationale')>500 THEN
      RAISE EXCEPTION 'Invalid staged creation option' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'evidenceIds') c WHERE jsonb_typeof(c)<>'string'
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'evidence') e WHERE e->'id'=c))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'verification') v WHERE jsonb_typeof(v)<>'string'
      OR char_length(btrim(v#>>'{}'))<1 OR char_length(v#>>'{}')>500) THEN
    RAISE EXCEPTION 'Invalid staged creation citations or verification item' USING ERRCODE='22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb) FROM PUBLIC;

-- Runs admitted for an older script prompt continue to use that prompt.
CREATE FUNCTION studio.studio_stamp_creation_prompt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF new.workflow='script_brief' AND new.snapshot->>'mode'='staged_creation' THEN
    new.prompt_version:='studio.creation.v1';
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_stamp_creation_prompt() FROM PUBLIC;
-- PostgreSQL fires triggers for the same event in name order, after studio_text_prompt_version.
CREATE TRIGGER studio_text_prompt_version_creation BEFORE INSERT ON studio.studio_idea_reviews
  FOR EACH ROW EXECUTE FUNCTION studio.studio_stamp_creation_prompt();

-- Only the final save uses this command. It shares the canonical optimistic record version with
-- the ordinary content editor and can fence a reviewed generation against its immutable inputs.
CREATE FUNCTION studio.studio_save_creation(p_location text,p_app text,p_actor text,p_id uuid,p_version bigint,
  p_title text,p_patch jsonb,p_template_selected boolean,p_template_id uuid,p_source_id uuid,p_source_version bigint,p_review_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_record studio.studio_records%rowtype; prior studio.studio_idea_reviews%rowtype; saved jsonb;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('creation:'||p_location||':'||p_id::text,0));
  IF p_version>0 THEN
    SELECT * INTO current_record FROM studio.studio_records WHERE location_id=p_location AND id=p_id
      AND version=p_version AND kind='content' AND NOT archived AND payload#>>'{creation,schema}'='1' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Creation draft changed' USING ERRCODE='40001'; END IF;
  ELSE
    SELECT * INTO current_record FROM studio.studio_records WHERE location_id=p_location AND id=p_id FOR UPDATE;
    IF FOUND THEN
      IF current_record.created_by_clerk_user_id=p_actor AND current_record.kind='content'
        AND current_record.version=(CASE WHEN p_source_id IS NULL THEN 1 ELSE 2 END)
        AND current_record.title=btrim(p_title) AND current_record.payload-'linkedIds'=p_patch
        AND current_record.script_template_version_id IS NOT DISTINCT FROM p_template_id
        AND (p_source_id IS NULL OR current_record.payload->'linkedIds'=jsonb_build_array(p_source_id::text)) THEN
        RETURN to_jsonb(current_record);
      END IF;
      RAISE EXCEPTION 'Creation request already used' USING ERRCODE='23505';
    END IF;
    IF p_source_id IS NOT NULL THEN
      PERFORM 1 FROM studio.studio_records WHERE location_id=p_location AND id=p_source_id AND version=p_source_version
        AND kind='reference' AND NOT archived FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Reference changed' USING ERRCODE='40001'; END IF;
    END IF;
  END IF;
  IF p_review_id IS NOT NULL THEN
    SELECT * INTO prior FROM studio.studio_idea_reviews WHERE location_id=p_location AND id=p_review_id
      AND actor_app=p_app AND created_by_clerk_user_id=p_actor AND workflow='script_brief' AND prompt_version='studio.creation.v1'
      AND result IS NOT NULL AND stale_at_completion=false AND snapshot#>>'{ideas,0,id}'=p_id::text
      AND snapshot#>>'{ideas,0,version}'=p_version::text;
    IF NOT FOUND THEN RAISE EXCEPTION 'Review inputs changed' USING ERRCODE='40001'; END IF;
    PERFORM 1 FROM studio.studio_records s WHERE location_id=p_location
      AND id IN (SELECT (link->>'id')::uuid FROM jsonb_array_elements(prior.snapshot#>'{ideas,0,sources}') link)
      ORDER BY id FOR SHARE;
    PERFORM 1 FROM public.settings_documents d WHERE d.scope_type::text='LOCATION'
      AND d.scope_id=p_location AND d.domain='location.business' FOR SHARE;
    PERFORM 1 FROM studio.studio_knowledge_insights i JOIN studio.studio_knowledge_evidence e
      ON e.location_id=i.location_id AND e.insight_id=i.id
      WHERE e.location_id=p_location AND e.id::text IN (SELECT c->>'id' FROM jsonb_array_elements(prior.snapshot->'evidence') c)
      ORDER BY i.id,e.id FOR SHARE OF i,e;
    IF studio.studio_build_selected_text_snapshot(p_location,prior.request->'selection','','script_brief') IS DISTINCT FROM prior.snapshot THEN
      RAISE EXCEPTION 'Review inputs changed' USING ERRCODE='40001';
    END IF;
  END IF;
  IF p_template_selected THEN
    saved:=studio.studio_save_content_template_selection(p_location,p_app,p_actor,p_id,p_title,p_patch,p_version,p_template_id);
  ELSE
    saved:=studio.studio_save_record(p_location,p_id,'content',p_title,p_patch,p_version,p_actor);
  END IF;
  IF p_version=0 AND p_source_id IS NOT NULL THEN
    PERFORM studio.studio_change_record_link(p_location,p_id,p_source_id,'add',1,p_app,p_actor);
    SELECT to_jsonb(r) INTO saved FROM studio.studio_records r WHERE location_id=p_location AND id=p_id;
  END IF;
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_save_creation(text,text,text,uuid,bigint,text,jsonb,boolean,uuid,uuid,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_save_creation(text,text,text,uuid,bigint,text,jsonb,boolean,uuid,uuid,bigint,uuid) TO service_role;

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
   and (run.prompt_version<>'studio.creation.v1' or report->>'stagedCreationVersion'='1')
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
   if run.prompt_version='studio.creation.v1' then
    raise exception 'The staged creation-capable paired Mac is not ready' using errcode='SC001';
   end if;
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

COMMIT;
