BEGIN;

-- One bounded length correction may now follow up to two evidence reads (a correction round 4 must reply), and the correction can fall
-- back to the valid first reply. Server-side only: no prompt or companion change. Rounds stay capped at four per owner message.

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
    IF jsonb_typeof(p_observation)<>'object' OR octet_length(p_observation::text)>5000 OR p_round>3 THEN
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

-- Finish a turn with the reply of the round that was sent back for length (the correction failed, could not be queued, or was no closer).
-- Only the revision's own review can be kept, and only once.
CREATE FUNCTION studio.studio_agent_keep_original(p_location text,p_app text,p_actor text,p_turn uuid,p_round integer,p_review uuid,p_summary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t studio.studio_agent_turns%rowtype; run studio.studio_idea_reviews%rowtype; last_round jsonb;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  SELECT * INTO t FROM studio.studio_agent_turns WHERE id=p_turn AND location_id=p_location AND actor_app=p_app AND created_by_clerk_user_id=p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='40001'; END IF;
  IF t.status<>'running' THEN RETURN to_jsonb(t); END IF;
  IF p_round NOT BETWEEN 2 AND 4 OR jsonb_array_length(t.rounds)<>p_round-1 THEN RAISE EXCEPTION 'Round out of order' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.rounds) r WHERE r->'observation'->>'lengthRevision'='true' AND r->>'reviewId'=p_review::text) THEN
    RAISE EXCEPTION 'No length revision to fall back from' USING ERRCODE='40001';
  END IF;
  SELECT * INTO run FROM studio.studio_idea_reviews WHERE id=p_review AND location_id=p_location AND actor_app=p_app AND created_by_clerk_user_id=p_actor
    AND workflow='script_brief' AND prompt_version IN ('studio.agent.v1','studio.agent.v2','studio.agent.v3') AND snapshot#>>'{operation,turnId}'=p_turn::text
    AND result IS NOT NULL AND result->>'step'='reply';
  IF NOT FOUND THEN RAISE EXCEPTION 'Original reply unavailable' USING ERRCODE='40001'; END IF;
  UPDATE studio.studio_agent_turns SET status='done',updated_at=clock_timestamp(),
    rounds=rounds||jsonb_build_array(jsonb_build_object('round',p_round,'reviewId',p_review,'tool',NULL,'observation',jsonb_build_object('untrusted',true,'items','[]'::jsonb,'summary',left(p_summary,200)))),
    result=run.result-'step'-'tool' WHERE id=t.id RETURNING * INTO t;
  RETURN to_jsonb(t);
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_agent_keep_original(text,text,text,uuid,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_agent_keep_original(text,text,text,uuid,integer,uuid,text) TO service_role;

COMMIT;
