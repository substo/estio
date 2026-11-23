BEGIN;

-- NULL is the existing automatic mode. An empty list deliberately supplies no source evidence.
ALTER TABLE studio.studio_agent_turns ADD COLUMN evidence_choice jsonb
  CHECK (evidence_choice IS NULL OR (jsonb_typeof(evidence_choice)='array' AND jsonb_array_length(evidence_choice)<=4));

CREATE FUNCTION studio.studio_agent_evidence_options(p_location text,p_record uuid,p_source uuid,p_ids uuid[])
RETURNS TABLE(id uuid, statement text, quote text, source_id uuid, title text, at numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT e.id,left(i.statement,200),e.payload->>'quote',s.id,left(s.title,160),
    CASE WHEN e.payload->>'start_sec' ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' THEN (e.payload->>'start_sec')::numeric END
  FROM studio.studio_knowledge_insights i
  JOIN studio.studio_records s ON s.location_id=i.location_id AND s.id=i.source_id AND s.kind='reference' AND NOT s.archived
  JOIN studio.studio_knowledge_evidence e ON e.location_id=i.location_id AND e.insight_id=i.id AND e.source_id=s.id
  WHERE i.location_id=p_location AND i.status='approved'
    AND e.payload->>'source_version'=s.version::text AND e.payload->>'evidence_type' IN ('speech','ocr','text')
    AND char_length(btrim(e.payload->>'quote')) BETWEEN 1 AND 450
    AND (p_ids IS NULL OR e.id=ANY(p_ids))
    AND (CASE WHEN p_record IS NULL THEN s.id=p_source ELSE EXISTS(
      SELECT 1 FROM studio.studio_record_links l WHERE l.location_id=p_location AND l.source_id=p_record AND l.target_id=s.id
    ) END)
  ORDER BY s.title,i.id,e.id LIMIT 80;
$$;
REVOKE ALL ON FUNCTION studio.studio_agent_evidence_options(text,uuid,uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_agent_evidence_options(text,uuid,uuid,uuid[]) TO service_role;

CREATE FUNCTION studio.studio_agent_begin_evidence_turn(p_location text,p_app text,p_actor text,p_record uuid,p_turn uuid,p_message text,p_provider text,p_target integer,p_selection jsonb,p_evidence uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE begun jsonb; picked jsonb; prior studio.studio_agent_turns%rowtype;
BEGIN
  IF p_evidence IS NOT NULL AND (cardinality(p_evidence)>4 OR cardinality(p_evidence)<>(SELECT count(DISTINCT id) FROM unnest(p_evidence) AS u(id))) THEN
    RAISE EXCEPTION 'Invalid evidence selection' USING ERRCODE='22023';
  END IF;
  -- Reuse the existing membership, turn lease and retry gates in the same transaction.
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('agent:'||p_location||':'||p_record::text,0));
  SELECT * INTO prior FROM studio.studio_agent_turns WHERE id=p_turn;
  IF FOUND THEN
    IF prior.location_id<>p_location OR prior.record_id<>p_record OR prior.actor_app<>p_app OR prior.created_by_clerk_user_id<>p_actor THEN
      RAISE EXCEPTION 'Message request already used' USING ERRCODE='23505';
    END IF;
    IF prior.provider IS DISTINCT FROM p_provider OR prior.selection IS DISTINCT FROM p_selection
      OR ARRAY(SELECT (item->>'evidenceId')::uuid FROM jsonb_array_elements(prior.evidence_choice) item ORDER BY 1)
        IS DISTINCT FROM ARRAY(SELECT id FROM unnest(p_evidence) u(id) ORDER BY 1)
      OR (prior.evidence_choice IS NULL)<>(p_evidence IS NULL) THEN
      RAISE EXCEPTION 'Message evidence selection already used' USING ERRCODE='23505';
    END IF;
    RETURN studio.studio_agent_begin_turn(p_location,p_app,p_actor,p_record,p_turn,p_message,p_provider,p_target,p_selection);
  END IF;
  begun:=studio.studio_agent_begin_turn(p_location,p_app,p_actor,p_record,p_turn,p_message,p_provider,p_target,p_selection);
  IF p_evidence IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id','f:'||o.id::text,'evidenceId',o.id,'label',o.statement,
      'text','Exact saved quote: “'||o.quote||'”','sourceId',o.source_id,'sourceTitle',o.title,'at',o.at,'cite',true) ORDER BY array_position(p_evidence,o.id)),'[]'::jsonb)
    INTO picked FROM studio.studio_agent_evidence_options(p_location,p_record,NULL,p_evidence) o;
    IF jsonb_array_length(picked)<>cardinality(p_evidence) THEN
      RAISE EXCEPTION 'Selected evidence is no longer available' USING ERRCODE='P2018';
    END IF;
    UPDATE studio.studio_agent_turns SET evidence_choice=picked WHERE id=p_turn;
  END IF;
  RETURN begun;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_agent_begin_evidence_turn(text,text,text,uuid,uuid,text,text,integer,jsonb,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_agent_begin_evidence_turn(text,text,text,uuid,uuid,text,text,integer,jsonb,uuid[]) TO service_role;

ALTER FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text) RENAME TO studio_build_snapshot_before_agent_evidence;
CREATE FUNCTION studio.studio_build_selected_text_snapshot(p_location_id text,p_selection jsonb,p_focus text,p_workflow text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snap jsonb; chosen jsonb;
BEGIN
  snap:=studio.studio_build_snapshot_before_agent_evidence(p_location_id,p_selection,p_focus,p_workflow);
  IF snap->>'mode' IS DISTINCT FROM 'studio_agent' THEN RETURN snap; END IF;
  SELECT evidence_choice INTO chosen FROM studio.studio_agent_turns
    WHERE id=(snap#>>'{operation,turnId}')::uuid AND location_id=p_location_id;
  IF chosen IS NULL THEN RETURN snap; END IF;
  snap:=snap||jsonb_build_object('sources','[]'::jsonb,'conversation','[]'::jsonb,'decisions','[]'::jsonb,'plan','[]'::jsonb,
    'observations',jsonb_build_array(jsonb_build_object('round',0,'tool',NULL,'result',
      jsonb_build_object('untrusted',true,'items',chosen,'note',CASE WHEN chosen='[]'::jsonb THEN
        'The owner asked for no source evidence this turn. Work from their message and current draft.' ELSE
        'The owner chose these approved passages as the only source evidence for this turn. Cite these ids only; do not request other source reads.' END))) || (snap->'observations'));
  snap:=jsonb_set(snap,'{ideas,0,sources}','[]'::jsonb);
  IF octet_length(snap::text)>23000 THEN RAISE EXCEPTION 'Assistant inputs exceed the bounded size' USING ERRCODE='22023'; END IF;
  RETURN snap;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text) TO service_role;
COMMIT;
