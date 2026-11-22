BEGIN;

-- Creative-priority contract for the conversation agent (additive to 20261122120000): prompt studio.agent.v3 needs a companion
-- reporting studioAgentVersion 3. Rounds stored or queued under v1/v2 keep their frozen prompt and validator; an account whose
-- only agent-capable Mac is still on version 2 keeps getting v2 rounds until it is restarted. The model-facing length band is
-- now +/-7% around the middle of the request (acceptance and display stay at +/-15%).

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
    AND workflow='script_brief' AND prompt_version IN ('studio.agent.v1','studio.agent.v2','studio.agent.v3') AND snapshot#>>'{operation,turnId}'=p_turn::text
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
  -- Contract 3 (creative-priority prompt) needs a companion reporting 3; v2 rounds (scriptLimits only) run on 2 or 3; v1 rounds on 1, 2 or 3.
  -- Every companion runs a round with the exact prompt and validator it was stamped with.
  and (p_snapshot->>'mode' is distinct from 'studio_agent' or case
    when p_snapshot->>'contract'='3' then report->>'studioAgentVersion'='3'
    when p_snapshot ? 'scriptLimits' then report->>'studioAgentVersion' in ('2','3')
    else report->>'studioAgentVersion' in ('1','2','3') end)
  and (p_snapshot->>'selectedOutline' is null or report->>'knowledgeCurationVersion'='1')
  and desired_config#>>'{features,text}'='true' and config_version=applied_config_version and config_status='applied'
  and (desired_config->>'textProvider'=p_provider or report->>'textRouteVersion'='1')
  and report#>>ARRAY[p_provider,'ready']='true' and report#>>ARRAY[p_provider,'authenticated']='true'
  and report#>>ARRAY[p_provider,'loginMethod']=case p_provider when 'codex' then 'chatgpt' else 'claudeai' end
  and report#>>ARRAY['capacity',p_provider]='true'
  and coalesce(report->'processingBlocked','[]'::jsonb)='[]'::jsonb
  order by seen_at desc limit 1 for update;
$$;


CREATE OR REPLACE FUNCTION studio.studio_stamp_agent_prompt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF new.workflow='script_brief' AND new.snapshot->>'mode'='studio_agent' THEN
    new.prompt_version:=CASE WHEN new.snapshot->>'contract'='3' THEN 'studio.agent.v3' WHEN new.snapshot ? 'scriptLimits' THEN 'studio.agent.v2' ELSE 'studio.agent.v1' END;
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
    IF d.id IS NOT NULL AND NOT coalesce(CASE WHEN run.snapshot->>'contract'='3' THEN d.report->>'studioAgentVersion'='3'
        WHEN run.snapshot ? 'scriptLimits' THEN d.report->>'studioAgentVersion' IN ('2','3') ELSE d.report->>'studioAgentVersion' IN ('1','2','3') END,false) THEN
      RAISE EXCEPTION 'The assistant-capable paired Mac is not ready' USING ERRCODE='P2017';
    END IF;
  END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_build_selected_text_snapshot(p_location_id text,p_selection jsonb,p_focus text,p_workflow text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snap jsonb; item jsonb:=p_selection->0; op jsonb:=item->'agent'; turn studio.studio_agent_turns%rowtype; rec studio.studio_records%rowtype;
  script text; words integer; t integer; has2 boolean; has3 boolean;
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
  -- The creative-priority contract (3) is stamped unless this account's only agent-capable Mac is still on 2, so a web deploy
  -- never strands an existing companion: it keeps running v2 rounds until it is restarted and reports 3.
  SELECT coalesce(bool_or(d.report->>'studioAgentVersion'='3'),false),coalesce(bool_or(d.report->>'studioAgentVersion'='2'),false) INTO has3,has2
    FROM studio.studio_devices d WHERE d.location_id=p_location_id AND d.app=turn.actor_app AND d.created_by=turn.created_by_clerk_user_id AND d.revoked_at IS NULL;
  IF NOT (has2 AND NOT has3) THEN snap:=snap||'{"contract":3}'::jsonb; END IF;
  t:=turn.target_seconds;
  snap:=snap||jsonb_build_object('length',CASE WHEN t IS NULL THEN NULL ELSE jsonb_build_object('targetSeconds',t,'targetWords',round(t*150/60.0),
      'minWords',round(t*150/60.0*0.93),'maxWords',round(t*150/60.0*1.07),'beyondSupported',t>480) END,
    'scriptLimits',jsonb_build_object('maxWords',1200,'maxChars',9000,'maxSeconds',480,'wordsPerMinute',150));
  IF octet_length(snap::text)>23000 THEN RAISE EXCEPTION 'Assistant inputs exceed the bounded size' USING ERRCODE='22023'; END IF;
  RETURN snap;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text) FROM PUBLIC;

COMMIT;
