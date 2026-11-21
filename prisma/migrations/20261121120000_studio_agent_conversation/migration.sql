BEGIN;

-- Conversational creation agent. Each model call ("round") is an ordinary script_brief text run (snapshot mode studio_agent,
-- prompt studio.agent.v1) that returns one typed step: a read-only tool call or the reply. The server executes the tool,
-- stores the observation here, and queues the next round on the same authorized route. This table is the durable history.
-- Additive: old script_brief and staged_creation runs, the hosted dispatcher and older companions are unchanged.

CREATE TABLE studio.studio_agent_turns (
  id uuid PRIMARY KEY,
  location_id text NOT NULL,
  record_id uuid NOT NULL,
  actor_app text NOT NULL CHECK (actor_app IN ('estio','substo')),
  created_by_clerk_user_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  provider text NOT NULL CHECK (provider IN ('location_order','subscription','openai')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  rounds jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rounds) = 'array' AND jsonb_array_length(rounds) <= 4 AND octet_length(rounds::text) <= 20000),
  result jsonb CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 22000)),
  error text CHECK (error IS NULL OR char_length(error) <= 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (location_id, record_id, seq),
  FOREIGN KEY (location_id, record_id) REFERENCES studio.studio_records(location_id, id) ON DELETE CASCADE,
  CHECK ((status = 'done') = (result IS NOT NULL))
);
ALTER TABLE studio.studio_agent_turns ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION studio.studio_agent_begin_turn(p_location text,p_app text,p_actor text,p_record uuid,p_turn uuid,p_message text,p_provider text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior studio.studio_agent_turns%rowtype; n integer;
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
  INSERT INTO studio.studio_agent_turns(id,location_id,record_id,actor_app,created_by_clerk_user_id,seq,message,provider)
    VALUES(p_turn,p_location,p_record,p_app,p_actor,n,btrim(p_message),p_provider);
  RETURN jsonb_build_object('turnId',p_turn,'seq',n);
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_agent_begin_turn(text,text,text,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_agent_begin_turn(text,text,text,uuid,uuid,text,text) TO service_role;

-- Idempotent per round. p_step must be exactly the stored result of that round's own completed review.
CREATE FUNCTION studio.studio_agent_record_step(p_location text,p_app text,p_actor text,p_turn uuid,p_round integer,p_review uuid,p_observation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t studio.studio_agent_turns%rowtype; run studio.studio_idea_reviews%rowtype;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  SELECT * INTO t FROM studio.studio_agent_turns WHERE id=p_turn AND location_id=p_location AND actor_app=p_app AND created_by_clerk_user_id=p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='40001'; END IF;
  IF t.status<>'running' OR jsonb_array_length(t.rounds)>=p_round THEN RETURN to_jsonb(t); END IF;
  IF p_round NOT BETWEEN 1 AND 4 OR jsonb_array_length(t.rounds)<>p_round-1 THEN RAISE EXCEPTION 'Round out of order' USING ERRCODE='40001'; END IF;
  SELECT * INTO run FROM studio.studio_idea_reviews WHERE id=p_review AND location_id=p_location AND actor_app=p_app AND created_by_clerk_user_id=p_actor
    AND workflow='script_brief' AND prompt_version='studio.agent.v1' AND snapshot#>>'{operation,turnId}'=p_turn::text
    AND snapshot#>>'{operation,round}'=p_round::text AND result IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round result unavailable' USING ERRCODE='40001'; END IF;
  IF run.result->>'step'='tool' THEN
    IF p_observation IS NULL OR jsonb_typeof(p_observation)<>'object' OR octet_length(p_observation::text)>5000 OR p_round>=4 THEN
      RAISE EXCEPTION 'Invalid tool observation' USING ERRCODE='22023';
    END IF;
    UPDATE studio.studio_agent_turns SET updated_at=clock_timestamp(),
      rounds=rounds||jsonb_build_array(jsonb_build_object('round',p_round,'reviewId',p_review,'tool',run.result->'tool','observation',p_observation))
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
GRANT EXECUTE ON FUNCTION studio.studio_agent_record_step(text,text,text,uuid,integer,uuid,jsonb) TO service_role;

CREATE FUNCTION studio.studio_agent_fail_turn(p_location text,p_app text,p_actor text,p_turn uuid,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t studio.studio_agent_turns%rowtype;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  UPDATE studio.studio_agent_turns SET status='failed',error=left(coalesce(p_error,'The assistant stopped.'),300),updated_at=clock_timestamp()
    WHERE id=p_turn AND location_id=p_location AND actor_app=p_app AND created_by_clerk_user_id=p_actor AND status='running' RETURNING * INTO t;
  IF NOT FOUND THEN SELECT * INTO t FROM studio.studio_agent_turns WHERE id=p_turn AND location_id=p_location AND created_by_clerk_user_id=p_actor; END IF;
  RETURN to_jsonb(t);
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_agent_fail_turn(text,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_agent_fail_turn(text,text,text,uuid,text) TO service_role;

-- Snapshot: only what this turn is entitled to. Source text, findings and library titles arrive through tools, not here.
ALTER FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text)
  RENAME TO studio_build_selected_snapshot_before_agent;
CREATE FUNCTION studio.studio_build_selected_text_snapshot(p_location_id text,p_selection jsonb,p_focus text,p_workflow text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb:=p_selection->0; op jsonb:=item->'agent'; record studio.studio_records%rowtype; turn studio.studio_agent_turns%rowtype;
  state jsonb; plan jsonb; sources jsonb; stages jsonb; conversation jsonb; decisions jsonb; profile jsonb; observations jsonb; snapshot jsonb; n integer;
BEGIN
  IF p_workflow IS DISTINCT FROM 'script_brief' OR op IS NULL THEN
    RETURN studio.studio_build_selected_snapshot_before_agent(p_location_id,p_selection,p_focus,p_workflow);
  END IF;
  IF jsonb_typeof(op) IS DISTINCT FROM 'object' OR octet_length(op::text)>300 OR coalesce(op->>'turnId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(op->>'round','') !~ '^[1-4]$' OR EXISTS(SELECT 1 FROM jsonb_object_keys(op) k WHERE k NOT IN ('turnId','round')) THEN
    RAISE EXCEPTION 'Invalid assistant round' USING ERRCODE='22023';
  END IF;
  n:=(op->>'round')::integer;
  SELECT * INTO record FROM studio.studio_records WHERE location_id=p_location_id AND id=(item->>'id')::uuid AND version=(item->>'version')::bigint
    AND kind='content' AND NOT archived AND payload#>>'{creation,schema}'='1' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Creation draft changed' USING ERRCODE='40001'; END IF;
  SELECT * INTO turn FROM studio.studio_agent_turns WHERE id=(op->>'turnId')::uuid AND location_id=p_location_id AND record_id=record.id FOR SHARE;
  IF NOT FOUND OR turn.status<>'running' OR jsonb_array_length(turn.rounds)<>n-1 THEN RAISE EXCEPTION 'Assistant turn changed' USING ERRCODE='40001'; END IF;
  state:=record.payload->'creation';

  WITH linked AS (
    SELECT s.* FROM studio.studio_record_links l JOIN studio.studio_records s ON s.location_id=l.location_id AND s.id=l.target_id
    WHERE l.location_id=p_location_id AND l.source_id=record.id AND s.kind='reference' AND NOT s.archived
    ORDER BY (s.id::text IS NOT DISTINCT FROM state#>>'{source,id}') DESC,s.id LIMIT 5)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'title',left(s.title,160),'url',left(coalesce(s.source_url,''),500),
    'transcriptChars',char_length(coalesce(btrim(s.payload->>'transcript'),'')),
    'descriptionChars',char_length(coalesce(btrim(coalesce(s.payload->>'description',s.payload->>'sourceDescription')),'')),
    'approvedFindings',(SELECT count(*) FROM studio.studio_knowledge_insights i WHERE i.location_id=s.location_id AND i.source_id=s.id AND i.status='approved'))
    ORDER BY s.id),'[]'::jsonb) INTO sources FROM linked s;

  SELECT coalesce(jsonb_object_agg(key,jsonb_build_object('text',left(value->>'text',CASE WHEN key='Script' THEN 2500 ELSE 700 END),
      'approved',value->>'approved'='true','truncated',char_length(value->>'text')>CASE WHEN key='Script' THEN 2500 ELSE 700 END)),'{}'::jsonb)
    INTO stages FROM jsonb_each(coalesce(state->'stages','{}'::jsonb))
    WHERE array_position(ARRAY['Concept','Angle','Title','Hook','Payoff','Script','Shoot plan'],key) IS NOT NULL AND nullif(btrim(value->>'text'),'') IS NOT NULL;
  IF nullif(btrim(record.payload->>'script'),'') IS NOT NULL AND NOT stages ? 'Script' THEN
    stages:=stages||jsonb_build_object('Script',jsonb_build_object('text',left(record.payload->>'script',2500),'approved',false,'truncated',char_length(record.payload->>'script')>2500));
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('owner',left(t.message,500),'assistant',left(t.result->>'reply',700),
      'proposed',(SELECT coalesce(jsonb_agg(DISTINCT p->>'stage'),'[]'::jsonb) FROM jsonb_array_elements(t.result->'proposals') p)) ORDER BY t.seq),'[]'::jsonb)
    INTO conversation FROM (SELECT * FROM studio.studio_agent_turns WHERE location_id=p_location_id AND record_id=record.id
      AND actor_app=turn.actor_app AND created_by_clerk_user_id=turn.created_by_clerk_user_id
      AND status='done' AND seq<turn.seq ORDER BY seq DESC LIMIT 6) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object('key',x.key,'value',x.value) ORDER BY x.key),'[]'::jsonb) INTO decisions FROM (
    SELECT DISTINCT ON (d->>'key') d->>'key' AS key,left(d->>'value',300) AS value FROM studio.studio_agent_turns t,jsonb_array_elements(t.result->'decisions') d
    WHERE t.location_id=p_location_id AND t.record_id=record.id AND t.actor_app=turn.actor_app AND t.created_by_clerk_user_id=turn.created_by_clerk_user_id
    AND t.status='done' AND t.seq<turn.seq ORDER BY d->>'key',t.seq DESC) x;

  SELECT coalesce((SELECT t.result->'plan' FROM studio.studio_agent_turns t WHERE t.location_id=p_location_id AND t.record_id=record.id
    AND t.actor_app=turn.actor_app AND t.created_by_clerk_user_id=turn.created_by_clerk_user_id
    AND t.status='done' AND t.seq<turn.seq ORDER BY t.seq DESC LIMIT 1),'[]'::jsonb) INTO plan;

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

  SELECT coalesce(jsonb_agg(jsonb_build_object('round',r->'round','tool',r->'tool','result',r->'observation') ORDER BY (r->>'round')::integer),'[]'::jsonb)
    INTO observations FROM jsonb_array_elements(turn.rounds) r;

  snapshot:=jsonb_build_object('focus','','mode','studio_agent',
    'operation',jsonb_build_object('turnId',turn.id,'round',n,'maxRounds',4,'mustReply',n>=4),
    'ideas',jsonb_build_array(jsonb_build_object('id',record.id,'version',record.version,'title',left(record.title,180),'summary','','notes','','excerpted',false,
      'sources',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s->>'id','version',s->'version','title',s->>'title','url',s->>'url','excerpt','','excerpted',true)),'[]'::jsonb)
        FROM jsonb_array_elements(sources) s))),
    'message',turn.message,'conversation',conversation,'decisions',decisions,'plan',plan,
    'draft',jsonb_build_object('stages',stages,'legacyDirection',CASE WHEN state#>>'{direction,choice}' IS DISTINCT FROM 'conversation' AND nullif(state#>>'{direction,goal}','') IS NOT NULL
      THEN (state->'direction')-'rationale'-'choice' END,'brief',left(coalesce(state->>'brief',''),600)),
    'sources',sources,'profile',profile,'observations',observations);
  IF octet_length(snapshot::text)>23000 THEN RAISE EXCEPTION 'Assistant inputs exceed the bounded size' USING ERRCODE='22023'; END IF;
  RETURN snapshot;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_build_selected_text_snapshot(text,jsonb,text,text) FROM PUBLIC;

ALTER FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb) RENAME TO studio_validate_text_result_before_agent;
CREATE FUNCTION studio.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb)
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
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'proposals') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT (item ?& ARRAY['stage','text','rationale','evidenceIds','verify'])
      OR item-ARRAY['stage','text','rationale','evidenceIds','verify']<>'{}'::jsonb OR coalesce(item->>'stage','')<>ALL(stages)
      OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string' OR char_length(btrim(item->>'text'))<1
      OR char_length(item->>'text')>(CASE item->>'stage' WHEN 'Title' THEN 180 WHEN 'Script' THEN 4000 ELSE 1200 END)
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

CREATE FUNCTION studio.studio_stamp_agent_prompt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF new.workflow='script_brief' AND new.snapshot->>'mode'='studio_agent' THEN new.prompt_version:='studio.agent.v1'; END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_stamp_agent_prompt() FROM PUBLIC;
-- Fires after studio_text_prompt_version (name order).
CREATE TRIGGER studio_text_prompt_version_agent BEFORE INSERT ON studio.studio_idea_reviews
  FOR EACH ROW EXECUTE FUNCTION studio.studio_stamp_agent_prompt();

-- Only a companion reporting studioAgentVersion 1 may take an agent round; unchanged otherwise.
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
  and (p_snapshot->>'mode' is distinct from 'studio_agent' or report->>'studioAgentVersion'='1')
  and (p_snapshot->>'selectedOutline' is null or report->>'knowledgeCurationVersion'='1')
  and desired_config#>>'{features,text}'='true' and config_version=applied_config_version and config_status='applied'
  and (desired_config->>'textProvider'=p_provider or report->>'textRouteVersion'='1')
  and report#>>ARRAY[p_provider,'ready']='true' and report#>>ARRAY[p_provider,'authenticated']='true'
  and report#>>ARRAY[p_provider,'loginMethod']=case p_provider when 'codex' then 'chatgpt' else 'claudeai' end
  and report#>>ARRAY['capacity',p_provider]='true'
  and coalesce(report->'processingBlocked','[]'::jsonb)='[]'::jsonb
  order by seen_at desc limit 1 for update;
$$;

-- The explicit single-provider path selects its Mac inline; refuse a companion without agent support instead of
-- queuing an unreadable job. The transaction rolls back (no review, job or reservation).
ALTER FUNCTION studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb) RENAME TO studio_enqueue_routed_text_run_before_agent;
CREATE FUNCTION studio.studio_enqueue_routed_text_run(p_location_id text,p_actor_app text,p_clerk_user_id text,p_workflow text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; run studio.studio_idea_reviews%rowtype; d studio.studio_devices%rowtype;
BEGIN
  r:=studio.studio_enqueue_routed_text_run_before_agent(p_location_id,p_actor_app,p_clerk_user_id,p_workflow,p_command);
  SELECT * INTO run FROM studio.studio_idea_reviews WHERE id=(r->>'reviewId')::uuid;
  IF run.snapshot->>'mode'='studio_agent' THEN
    SELECT dv.* INTO d FROM studio.studio_jobs j JOIN studio.studio_devices dv ON dv.id=j.device_id WHERE j.id=run.job_id;
    IF d.id IS NOT NULL AND d.report->>'studioAgentVersion' IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'The assistant-capable paired Mac is not ready' USING ERRCODE='P2017';
    END IF;
  END IF;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION studio.studio_enqueue_routed_text_run_before_agent(text,text,text,text,jsonb) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_routed_text_run(text,text,text,text,jsonb) TO service_role;

COMMIT;
