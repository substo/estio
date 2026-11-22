BEGIN;

-- Approximate duration target and measured script fit for the creation assistant (additive to 20261121120000).
-- target_seconds is the effective target after each owner message, set only from the owner's own words by the server.
-- Older stored turns and snapshots stay valid: no target, no length block.
ALTER TABLE studio.studio_agent_turns ADD COLUMN target_seconds integer CHECK (target_seconds IS NULL OR target_seconds BETWEEN 10 AND 3600);

-- The 7-argument form (older app code) keeps working through the new default.
DROP FUNCTION studio.studio_agent_begin_turn(text,text,text,uuid,uuid,text,text);
CREATE FUNCTION studio.studio_agent_begin_turn(p_location text,p_app text,p_actor text,p_record uuid,p_turn uuid,p_message text,p_provider text,p_target integer DEFAULT -1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior studio.studio_agent_turns%rowtype; n integer; effective integer;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  IF p_turn IS NULL OR p_message IS NULL OR char_length(btrim(p_message)) NOT BETWEEN 1 AND 2000 OR p_provider NOT IN ('location_order','subscription','openai') THEN
    RAISE EXCEPTION 'Invalid assistant message' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agent:'||p_location||':'||p_record::text,0));
  SELECT * INTO prior FROM studio.studio_agent_turns WHERE id=p_turn;
  IF FOUND THEN
    IF prior.location_id<>p_location OR prior.record_id<>p_record OR prior.created_by_clerk_user_id<>p_actor OR prior.message<>btrim(p_message) THEN
      RAISE EXCEPTION 'Message request already used' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('turnId',prior.id,'seq',prior.seq);
  END IF;
  PERFORM 1 FROM studio.studio_records WHERE location_id=p_location AND id=p_record AND kind='content' AND NOT archived
    AND payload#>>'{creation,schema}'='1' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Creation draft unavailable' USING ERRCODE='40001'; END IF;
  -- A turn that has not finished within the run budget is closed, never resumed or replayed.
  UPDATE studio.studio_agent_turns SET status='failed',error='This message timed out. Send it again if you still want it.',updated_at=clock_timestamp()
    WHERE location_id=p_location AND record_id=p_record AND status='running' AND created_at<clock_timestamp()-interval '20 minutes';
  IF EXISTS(SELECT 1 FROM studio.studio_agent_turns WHERE location_id=p_location AND record_id=p_record AND status='running') THEN
    RAISE EXCEPTION 'The assistant is already working on this draft' USING ERRCODE='P2015';
  END IF;
  SELECT coalesce(max(seq),0)+1 INTO n FROM studio.studio_agent_turns WHERE location_id=p_location AND record_id=p_record;
  IF n>300 THEN RAISE EXCEPTION 'This conversation is full. Start a new draft.' USING ERRCODE='22023'; END IF;
  IF p_target IS NOT NULL AND p_target<>-1 AND p_target<>0 AND p_target NOT BETWEEN 10 AND 3600 THEN
    RAISE EXCEPTION 'Invalid length target' USING ERRCODE='22023';
  END IF;
  -- The effective target: -1/NULL keeps the previous one, 0 clears it, anything else is the owner's new request.
  SELECT target_seconds INTO effective FROM studio.studio_agent_turns WHERE location_id=p_location AND record_id=p_record
    AND actor_app=p_app AND created_by_clerk_user_id=p_actor ORDER BY seq DESC LIMIT 1;
  effective:=CASE WHEN p_target IS NULL OR p_target=-1 THEN effective WHEN p_target=0 THEN NULL ELSE p_target END;
  INSERT INTO studio.studio_agent_turns(id,location_id,record_id,actor_app,created_by_clerk_user_id,seq,message,provider,target_seconds)
    VALUES(p_turn,p_location,p_record,p_app,p_actor,n,btrim(p_message),p_provider,effective);
  RETURN jsonb_build_object('turnId',p_turn,'seq',n);
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_agent_begin_turn(text,text,text,uuid,uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_agent_begin_turn(text,text,text,uuid,uuid,text,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION studio.studio_agent_record_step(p_location text,p_app text,p_actor text,p_turn uuid,p_round integer,p_review uuid,p_observation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t studio.studio_agent_turns%rowtype; run studio.studio_idea_reviews%rowtype;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  SELECT * INTO t FROM studio.studio_agent_turns WHERE id=p_turn AND location_id=p_location AND actor_app=p_app AND created_by_clerk_user_id=p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='40001'; END IF;
  IF t.status<>'running' OR jsonb_array_length(t.rounds)>=p_round THEN RETURN to_jsonb(t); END IF;
  IF p_round NOT BETWEEN 1 AND 4 OR jsonb_array_length(t.rounds)<>p_round-1 THEN RAISE EXCEPTION 'Round out of order' USING ERRCODE='40001'; END IF;
  SELECT * INTO run FROM studio.studio_idea_reviews WHERE id=p_review AND location_id=p_location AND actor_app=p_app AND created_by_clerk_user_id=p_actor
    AND workflow='script_brief' AND prompt_version IN ('studio.agent.v1','studio.agent.v2') AND snapshot#>>'{operation,turnId}'=p_turn::text
    AND snapshot#>>'{operation,round}'=p_round::text AND result IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round result unavailable' USING ERRCODE='40001'; END IF;
  IF run.result->>'step'='tool' THEN
    IF p_observation IS NULL OR jsonb_typeof(p_observation)<>'object' OR octet_length(p_observation::text)>5000 OR p_round>=4 THEN
      RAISE EXCEPTION 'Invalid tool observation' USING ERRCODE='22023';
    END IF;
    UPDATE studio.studio_agent_turns SET updated_at=clock_timestamp(),
      rounds=rounds||jsonb_build_array(jsonb_build_object('round',p_round,'reviewId',p_review,'tool',run.result->'tool','observation',p_observation))
      WHERE id=t.id RETURNING * INTO t;
  ELSIF p_observation->>'lengthRevision'='true' THEN
    -- The reply missed the requested length by a meaningful margin: keep the turn running and ask once more with the measured gap.
    IF jsonb_typeof(p_observation)<>'object' OR octet_length(p_observation::text)>5000 OR p_round>2 THEN
      RAISE EXCEPTION 'Invalid length revision' USING ERRCODE='22023';
    END IF;
    UPDATE studio.studio_agent_turns SET updated_at=clock_timestamp(),
      rounds=rounds||jsonb_build_array(jsonb_build_object('round',p_round,'reviewId',p_review,'tool',NULL,'observation',p_observation))
      WHERE id=t.id RETURNING * INTO t;
  ELSE
    UPDATE studio.studio_agent_turns SET status='done',updated_at=clock_timestamp(),
      rounds=rounds||jsonb_build_array(jsonb_build_object('round',p_round,'reviewId',p_review,'tool',NULL,'observation',NULL)),
      result=run.result-'step'-'tool' WHERE id=t.id RETURNING * INTO t;
  END IF;
  RETURN to_jsonb(t);
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_agent_record_step(text,text,text,uuid,integer,uuid,jsonb) FROM PUBLIC;

-- Scripts up to 9,000 characters (1,200 spoken words, 8 minutes) per proposal, at most one Script proposal per reply.
CREATE OR REPLACE FUNCTION studio.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE step text; tool jsonb; item jsonb; ids text[]; stages text[]:=ARRAY['Concept','Angle','Title','Hook','Payoff','Script','Shoot plan'];
BEGIN
  IF p_workflow IS DISTINCT FROM 'script_brief' OR snapshot->>'mode' IS DISTINCT FROM 'studio_agent' THEN
    PERFORM studio.studio_validate_text_result_before_agent(p_workflow,p_result,snapshot);
    RETURN;
  END IF;
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR NOT (p_result ?& ARRAY['step','tool','reply','choices','proposals','decisions','plan'])
    OR p_result-ARRAY['step','tool','reply','choices','proposals','decisions','plan']<>'{}'::jsonb OR octet_length(p_result::text)>22000
    OR jsonb_typeof(p_result->'choices') IS DISTINCT FROM 'array' OR jsonb_typeof(p_result->'proposals') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_result->'decisions') IS DISTINCT FROM 'array' OR jsonb_typeof(p_result->'plan') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid assistant result' USING ERRCODE='22023';
  END IF;
  step:=p_result->>'step';
  IF step='tool' THEN
    tool:=p_result->'tool';
    IF snapshot#>>'{operation,mustReply}'='true' OR p_result->'reply'<>'null'::jsonb OR jsonb_array_length(p_result->'choices')<>0
      OR jsonb_array_length(p_result->'proposals')<>0 OR jsonb_array_length(p_result->'decisions')<>0 OR jsonb_array_length(p_result->'plan')<>0
      OR jsonb_typeof(tool) IS DISTINCT FROM 'object' OR NOT (tool ?& ARRAY['name','query','sourceId','offset','stage','skill'])
      OR tool-ARRAY['name','query','sourceId','offset','stage','skill']<>'{}'::jsonb
      OR coalesce(tool->>'name','') NOT IN ('search_source','read_source','list_findings','read_stage','search_library','load_skill')
      OR (tool->'skill'<>'null'::jsonb AND coalesce(tool->>'skill','') NOT IN ('check_claims','develop_hook_script','plan_shoot'))
      OR (tool->'query'<>'null'::jsonb AND (jsonb_typeof(tool->'query')<>'string' OR char_length(tool->>'query')>120))
      OR (tool->'sourceId'<>'null'::jsonb AND coalesce(tool->>'sourceId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      OR (tool->'offset'<>'null'::jsonb AND (jsonb_typeof(tool->'offset')<>'number' OR coalesce(tool->>'offset','') !~ '^[0-9]{1,7}$'))
      OR (tool->'stage'<>'null'::jsonb AND coalesce(tool->>'stage','')<>ALL(stages)) THEN
      RAISE EXCEPTION 'Invalid assistant tool step' USING ERRCODE='22023';
    END IF;
    RETURN;
  END IF;
  IF step IS DISTINCT FROM 'reply' OR p_result->'tool'<>'null'::jsonb OR jsonb_typeof(p_result->'reply') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_result->>'reply'))<1 OR char_length(p_result->>'reply')>1800
    OR jsonb_array_length(p_result->'choices')>3 OR jsonb_array_length(p_result->'proposals')>3 OR jsonb_array_length(p_result->'decisions')>4
    OR jsonb_array_length(p_result->'plan')>4
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'plan') x WHERE jsonb_typeof(x)<>'string' OR char_length(btrim(x#>>'{}')) NOT BETWEEN 1 AND 120) THEN
    RAISE EXCEPTION 'Invalid assistant reply' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'choices') c WHERE jsonb_typeof(c)<>'string' OR char_length(btrim(c#>>'{}')) NOT BETWEEN 1 AND 90) THEN
    RAISE EXCEPTION 'Invalid assistant choices' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(i->>'id'),ARRAY[]::text[]) INTO ids FROM jsonb_array_elements(snapshot->'observations') o,
    jsonb_array_elements(coalesce(o->'result'->'items','[]'::jsonb)) i WHERE i->>'cite'='true';
  IF snapshot ? 'scriptLimits' AND (SELECT count(*) FROM jsonb_array_elements(p_result->'proposals') p WHERE p->>'stage'='Script')>1 THEN
    RAISE EXCEPTION 'Only one Script proposal fits a reply' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'proposals') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT (item ?& ARRAY['stage','text','rationale','evidenceIds','verify'])
      OR item-ARRAY['stage','text','rationale','evidenceIds','verify']<>'{}'::jsonb OR coalesce(item->>'stage','')<>ALL(stages)
      OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string' OR char_length(btrim(item->>'text'))<1
      OR char_length(item->>'text')>(CASE item->>'stage' WHEN 'Title' THEN 180 WHEN 'Script' THEN (CASE WHEN snapshot ? 'scriptLimits' THEN 9000 ELSE 4000 END) ELSE 1200 END)
      OR jsonb_typeof(item->'rationale') IS DISTINCT FROM 'string' OR char_length(btrim(item->>'rationale')) NOT BETWEEN 1 AND 300
      OR jsonb_typeof(item->'evidenceIds') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'evidenceIds')>4
      OR jsonb_typeof(item->'verify') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'verify')>3
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'evidenceIds') e WHERE jsonb_typeof(e)<>'string' OR NOT (e#>>'{}')=ANY(ids))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'verify') v WHERE jsonb_typeof(v)<>'string' OR char_length(btrim(v#>>'{}')) NOT BETWEEN 1 AND 200) THEN
      RAISE EXCEPTION 'Invalid assistant proposal' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'decisions') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT (item ?& ARRAY['key','value','basis']) OR item-ARRAY['key','value','basis']<>'{}'::jsonb
      OR coalesce(item->>'key','') NOT IN ('publisher','viewer','goal','angle','style','avoid','format','length')
      OR jsonb_typeof(item->'value') IS DISTINCT FROM 'string' OR char_length(btrim(item->>'value')) NOT BETWEEN 1 AND 300
      OR jsonb_typeof(item->'basis') IS DISTINCT FROM 'string' OR char_length(btrim(item->>'basis')) NOT BETWEEN 1 AND 120
      OR position(lower(btrim(item->>'basis')) IN lower(snapshot->>'message'))=0 THEN
      RAISE EXCEPTION 'Invalid assistant decision' USING ERRCODE='22023';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION studio.studio_pick_text_device(p_location text,p_app text,p_user text,p_workflow text,p_command jsonb,p_snapshot jsonb,p_provider text,p_device uuid)
RETURNS studio.studio_devices LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 select * from studio.studio_devices where location_id=p_location and app=p_app and created_by=p_user and (p_device is null or id=p_device)
  and revoked_at is null and not paused and processing_enabled and 'studio.text_run'=any(allowed_kinds)
  and seen_at<=clock_timestamp() and seen_at>clock_timestamp()-interval '90 seconds' and coalesce(report->>'draining','false')='false'
  and report->'handlers' ? 'studio.text_run'
  and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'outline' or report->>'knowledgeOutlineVersion'='2')
  and (p_snapshot->>'curationVersion' is distinct from '1' or report->>'knowledgeCurationVersion'='1')
  and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'script_template' or report->>'videoTemplateVersion'='1')
  and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'source_assist' or report->>'sourceAssistVersion'='1')
  and (p_snapshot->>'mode' is distinct from 'staged_creation' or report->>'stagedCreationVersion'='1')
  -- A v2 round (its snapshot carries scriptLimits) needs a companion reporting studioAgentVersion 2. A round stored under the v1
  -- contract (no scriptLimits) runs on a companion reporting 1 or 2, each executing it with the v1 prompt and validator it was stamped with.
  and (p_snapshot->>'mode' is distinct from 'studio_agent' or case when p_snapshot ? 'scriptLimits' then report->>'studioAgentVersion'='2' else report->>'studioAgentVersion' in ('1','2') end)
  and (p_snapshot->>'selectedOutline' is null or report->>'knowledgeCurationVersion'='1')
  and desired_config#>>'{features,text}'='true' and config_version=applied_config_version and config_status='applied'
  and (desired_config->>'textProvider'=p_provider or report->>'textRouteVersion'='1')
  and report#>>ARRAY[p_provider,'ready']='true' and report#>>ARRAY[p_provider,'authenticated']='true'
  and report#>>ARRAY[p_provider,'loginMethod']=case p_provider when 'codex' then 'chatgpt' else 'claudeai' end
  and report#>>ARRAY['capacity',p_provider]='true'
  and coalesce(report->'processingBlocked','[]'::jsonb)='[]'::jsonb
  order by seen_at desc limit 1 for update;
$$;


-- Every new agent round is stamped with the duration-enabled contract.
CREATE OR REPLACE FUNCTION studio.studio_stamp_agent_prompt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF new.workflow='script_brief' AND new.snapshot->>'mode'='studio_agent' THEN
    new.prompt_version:=CASE WHEN new.snapshot ? 'scriptLimits' THEN 'studio.agent.v2' ELSE 'studio.agent.v1' END;
  END IF;
  RETURN new;
END;
$$;

-- The explicit single-provider path selects its Mac inline: refuse a companion that lacks the contract the round needs.
CREATE OR REPLACE FUNCTION studio.studio_enqueue_routed_text_run(p_location_id text,p_actor_app text,p_clerk_user_id text,p_workflow text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; run studio.studio_idea_reviews%rowtype; d studio.studio_devices%rowtype;
BEGIN
  r:=studio.studio_enqueue_routed_text_run_before_agent(p_location_id,p_actor_app,p_clerk_user_id,p_workflow,p_command);
  SELECT * INTO run FROM studio.studio_idea_reviews WHERE id=(r->>'reviewId')::uuid;
  IF run.snapshot->>'mode'='studio_agent' THEN
    SELECT dv.* INTO d FROM studio.studio_jobs j JOIN studio.studio_devices dv ON dv.id=j.device_id WHERE j.id=run.job_id;
    IF d.id IS NOT NULL AND NOT coalesce(CASE WHEN run.snapshot ? 'scriptLimits' THEN d.report->>'studioAgentVersion'='2' ELSE d.report->>'studioAgentVersion' IN ('1','2') END,false) THEN
      RAISE EXCEPTION 'The assistant-capable paired Mac is not ready' USING ERRCODE='P2017';
    END IF;
  END IF;
  RETURN r;
END;
$$;

-- Active context: the current canonical script (not the possibly truncated stage copy), its measured length and the target.
ALTER FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text) RENAME TO studio_build_selected_snapshot_before_agent_length;
CREATE FUNCTION studio.studio_build_selected_text_snapshot(p_location_id text,p_selection jsonb,p_focus text,p_workflow text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snap jsonb; item jsonb:=p_selection->0; op jsonb:=item->'agent'; turn studio.studio_agent_turns%rowtype; rec studio.studio_records%rowtype;
  script text; words integer; t integer;
BEGIN
  snap:=studio.studio_build_selected_snapshot_before_agent_length(p_location_id,p_selection,p_focus,p_workflow);
  IF p_workflow IS DISTINCT FROM 'script_brief' OR op IS NULL THEN RETURN snap; END IF;
  SELECT * INTO turn FROM studio.studio_agent_turns WHERE id=(op->>'turnId')::uuid AND location_id=p_location_id;
  SELECT * INTO rec FROM studio.studio_records WHERE location_id=p_location_id AND id=(item->>'id')::uuid;
  script:=coalesce(nullif(btrim(rec.payload->>'script'),''),nullif(btrim(rec.payload#>>'{creation,stages,Script,text}'),''));
  snap:=snap #- '{draft,stages,Script}';
  IF script IS NOT NULL THEN
    SELECT count(*)::integer INTO words FROM regexp_matches(regexp_replace(script,'\[[^\]]*\]',' ','g'),'\S+','g');
    snap:=jsonb_set(snap,'{draft,stages,Script}',jsonb_build_object('text',left(script,3500),'approved',coalesce(rec.payload#>>'{creation,stages,Script,approved}','false')='true',
      'truncated',char_length(script)>3500,'chars',char_length(script),'spokenWords',words,'estimatedSeconds',round(words*60.0/150)),true);
  END IF;
  t:=turn.target_seconds;
  snap:=snap||jsonb_build_object('length',CASE WHEN t IS NULL THEN NULL ELSE jsonb_build_object('targetSeconds',t,'targetWords',round(t*150/60.0),
      'minWords',round(t*150/60.0*0.85),'maxWords',round(t*150/60.0*1.15),'beyondSupported',t>480) END,
    'scriptLimits',jsonb_build_object('maxWords',1200,'maxChars',9000,'maxSeconds',480,'wordsPerMinute',150));
  IF octet_length(snap::text)>23000 THEN RAISE EXCEPTION 'Assistant inputs exceed the bounded size' USING ERRCODE='22023'; END IF;
  RETURN snap;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text) FROM PUBLIC;

COMMIT;
