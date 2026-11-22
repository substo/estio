CREATE FUNCTION pg_temp.agent_reply(fenced jsonb,proposal jsonb,decisions jsonb,accept boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    PERFORM studio.studio_text_device_command(repeat('9',64),'substo','complete',fenced||jsonb_build_object('result',jsonb_build_object('output',jsonb_build_object(
      'step','reply','tool',NULL,'reply','Here is a sharper direction.','choices','[]'::jsonb,'proposals',jsonb_build_array(proposal),'decisions',decisions,
      'plan',jsonb_build_array('Compare two openings')),'provider','codex','model','native-default')));
    IF NOT accept THEN RAISE EXCEPTION 'Invalid agent reply accepted'; END IF;
  EXCEPTION WHEN invalid_parameter_value THEN IF accept THEN RAISE; END IF; END;
END $f$;
-- Conversational creation agent: round admission, model-chosen tool steps, bounded validation and Account-private history.
DO $$
DECLARE tpl uuid:=gen_random_uuid(); tpl_v uuid:=gen_random_uuid(); pinned uuid:=gen_random_uuid(); pinned_saved jsonb; loc text:='studio-agent'; actor text:='agent-owner'; mate text:='agent-teammate'; outsider text:='agent-other';
  source uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); device uuid; t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); t3 uuid:=gen_random_uuid(); mate_turn uuid:=gen_random_uuid();
  patch jsonb:='{"title":"Source","stage":"idea","approved":false,"creation":{"schema":1,"brief":"","direction":{"choice":"conversation","publisher":"","viewer":"","goal":"","angle":"","rationale":""},"source":null,"stages":{},"history":[]}}';
  saved jsonb; cmd jsonb; queued jsonb; snapshot jsonb; claim jsonb; fenced jsonb; job uuid; review uuid; turn jsonb; obs jsonb;
  tool jsonb:='{"step":"tool","tool":{"name":"search_source","query":"opening promise","sourceId":null,"offset":null,"stage":null,"skill":null},"reply":null,"choices":[],"proposals":[],"decisions":[],"plan":[]}';
BEGIN
  PERFORM studio.studio_create_substo_location(loc,'Substo',actor);
  PERFORM studio.studio_create_substo_location('studio-agent-other','Other',outsider);
  PERFORM public.test_member(loc,mate,'member');
  INSERT INTO studio.studio_records(location_id,id,kind,title,payload) VALUES (loc,source,'reference','MrBeast on openings',
    '{"transcript":"ZEBRA-TRANSCRIPT The opening sets the promise. Then deliver the payoff."}');
  saved:=studio.studio_save_creation(loc,'substo',actor,draft,0,'MrBeast on openings',patch,false,NULL,source,1,NULL);
  device:=pg_temp.pair_text_device(loc,actor,'AGENTAAA',repeat('9',64));
  -- Begin: idempotent, one running turn per draft, Location-bound.
  IF studio.studio_agent_begin_turn(loc,'substo',actor,draft,t1,'Make something inspired by this opening','subscription')->>'seq'<>'1'
    OR studio.studio_agent_begin_turn(loc,'substo',actor,draft,t1,'Make something inspired by this opening','subscription')->>'seq'<>'1' THEN RAISE EXCEPTION 'Turn not idempotent'; END IF;
  BEGIN PERFORM studio.studio_agent_begin_turn(loc,'substo',actor,draft,t2,'again','subscription'); RAISE EXCEPTION 'Concurrent turn accepted';
  EXCEPTION WHEN SQLSTATE 'P2015' THEN NULL; END;
  BEGIN PERFORM studio.studio_agent_begin_turn(loc,'substo',outsider,draft,t3,'x','subscription'); RAISE EXCEPTION 'Cross-Location turn accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  cmd:=jsonb_build_object('requestId',gen_random_uuid(),'provider','subscription','confirmSubscription',true,'focus','',
    'ideas',jsonb_build_array(jsonb_build_object('id',draft,'version',(saved->>'version')::bigint,'agent',jsonb_build_object('turnId',t1,'round',1))));
  BEGIN PERFORM studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',cmd); RAISE EXCEPTION 'Old companion received an agent round';
  EXCEPTION WHEN SQLSTATE 'P2017' THEN NULL; END;
  -- A companion that only reports the first agent contract (no duration targets, 4,000-character Scripts) never receives a new round.
  UPDATE studio.studio_devices SET report=report||'{"studioAgentVersion":1}' WHERE id=device;
  BEGIN PERFORM studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',cmd); RAISE EXCEPTION 'v1 companion received a v2 round';
  EXCEPTION WHEN SQLSTATE 'P2017' THEN NULL; END;
  -- Pinning: v2 snapshots (scriptLimits) need version 2; rounds stored under v1 (no scriptLimits) run on 1 or 2.
  IF studio.studio_pick_text_device(loc,'substo',actor,'script_brief','{}','{"mode":"studio_agent","scriptLimits":{}}'::jsonb,'codex',device) IS NOT NULL
    OR studio.studio_pick_text_device(loc,'substo',actor,'script_brief','{}','{"mode":"studio_agent"}'::jsonb,'codex',device) IS NULL THEN
    RAISE EXCEPTION 'Agent contract pinning is wrong for a version-1 companion';
  END IF;
  UPDATE studio.studio_devices SET report=report||'{"studioAgentVersion":2}' WHERE id=device;
  IF studio.studio_pick_text_device(loc,'substo',actor,'script_brief','{}','{"mode":"studio_agent","scriptLimits":{}}'::jsonb,'codex',device) IS NULL
    OR studio.studio_pick_text_device(loc,'substo',actor,'script_brief','{}','{"mode":"studio_agent"}'::jsonb,'codex',device) IS NULL THEN
    RAISE EXCEPTION 'Agent contract pinning is wrong for a version-2 companion';
  END IF;
  -- The validator follows the contract a round was stamped with: 4,000 characters under v1, 9,000 under v2.
  DECLARE long_reply jsonb:=jsonb_build_object('step','reply','tool',NULL,'reply','ok','choices','[]'::jsonb,'decisions','[]'::jsonb,'plan','[]'::jsonb,
      'proposals',jsonb_build_array(jsonb_build_object('stage','Script','text',repeat('word ',1000),'rationale','r','evidenceIds','[]'::jsonb,'verify','[]'::jsonb)));
  BEGIN
  BEGIN
    PERFORM studio.studio_validate_text_run_result('script_brief',long_reply,'{"mode":"studio_agent","message":"x","operation":{"mustReply":false},"observations":[]}'::jsonb);
    RAISE EXCEPTION 'A v1 round accepted a 5,000-character Script';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM studio.studio_validate_text_run_result('script_brief',long_reply,'{"mode":"studio_agent","scriptLimits":{},"message":"x","operation":{"mustReply":false},"observations":[]}'::jsonb);
  END;
  queued:=studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',cmd);
  IF studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',cmd)<>queued THEN RAISE EXCEPTION 'Round enqueue not idempotent'; END IF;
  job:=(queued->>'jobId')::uuid; review:=(queued->>'reviewId')::uuid;
  SELECT r.snapshot INTO snapshot FROM studio.studio_idea_reviews r WHERE id=review;
  IF (SELECT prompt_version FROM studio.studio_idea_reviews WHERE id=review)<>'studio.agent.v2' OR snapshot->>'mode'<>'studio_agent'
    OR snapshot::text LIKE '%ZEBRA-TRANSCRIPT%' OR snapshot#>>'{sources,0,id}'<>source::text OR snapshot#>>'{sources,0,approvedFindings}'<>'0'
    OR snapshot->>'message'<>'Make something inspired by this opening' OR snapshot->'observations'<>'[]'::jsonb THEN
    RAISE EXCEPTION 'Agent snapshot exposed source text or lost scope: %',snapshot;
  END IF;
  claim:=studio.studio_text_device_command(repeat('9',64),'substo','claim','{"workerId":"agent-mac","limit":1,"leaseSeconds":60,"textReady":true}');
  fenced:=jsonb_build_object('workerId','agent-mac','jobId',job,'leaseToken',claim->0->>'lease_token');
  BEGIN
    PERFORM studio.studio_text_device_command(repeat('9',64),'substo','complete',fenced||jsonb_build_object('result',jsonb_build_object(
      'output',jsonb_set(tool,'{tool,name}','"run_shell"'),'provider','codex','model','native-default')));
    RAISE EXCEPTION 'Unlisted tool accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM studio.studio_text_device_command(repeat('9',64),'substo','complete',fenced||jsonb_build_object('result',jsonb_build_object('output',tool,'provider','codex','model','native-default')));
  BEGIN PERFORM studio.studio_agent_record_step(loc,'substo',mate,t1,1,review,'{"items":[]}'); RAISE EXCEPTION 'Other member advanced the turn';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  obs:='{"untrusted":true,"items":[{"id":"abcd1234:0","label":"Source","text":"The opening sets the promise.","sourceId":"x","cite":true}]}';
  turn:=studio.studio_agent_record_step(loc,'substo',actor,t1,1,review,obs);
  IF jsonb_array_length(turn->'rounds')<>1 OR studio.studio_agent_record_step(loc,'substo',actor,t1,1,review,obs)<>turn THEN RAISE EXCEPTION 'Step not idempotent'; END IF;
  -- Round 2 sees the stored observation; the reply is validated against what was actually read.
  cmd:=jsonb_build_object('requestId',gen_random_uuid(),'provider','subscription','confirmSubscription',true,'focus','',
    'ideas',jsonb_build_array(jsonb_build_object('id',draft,'version',(saved->>'version')::bigint,'agent',jsonb_build_object('turnId',t1,'round',2))));
  queued:=studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',cmd);
  job:=(queued->>'jobId')::uuid; review:=(queued->>'reviewId')::uuid;
  SELECT r.snapshot INTO snapshot FROM studio.studio_idea_reviews r WHERE id=review;
  IF snapshot#>>'{observations,0,result,items,0,id}'<>'abcd1234:0' THEN RAISE EXCEPTION 'Observation missing from round 2'; END IF;
  BEGIN PERFORM studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',jsonb_set(cmd,'{ideas,0,agent,round}','3')||jsonb_build_object('requestId',gen_random_uuid()));
    RAISE EXCEPTION 'Skipped round accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  claim:=studio.studio_text_device_command(repeat('9',64),'substo','claim','{"workerId":"agent-mac","limit":1,"leaseSeconds":60,"textReady":true}');
  fenced:=jsonb_build_object('workerId','agent-mac','jobId',job,'leaseToken',claim->0->>'lease_token');
  PERFORM pg_temp.agent_reply(fenced,'{"stage":"Hook","text":"Two openings, one promise.","rationale":"Uses the opener idea.","evidenceIds":["invented"],"verify":[]}'::jsonb,'[]'::jsonb,false);
  PERFORM pg_temp.agent_reply(fenced,'{"stage":"Hook","text":"Two openings, one promise.","rationale":"Uses the opener idea.","evidenceIds":["abcd1234:0"],"verify":[]}'::jsonb,
    '[{"key":"publisher","value":"Substo","basis":"never said this"}]'::jsonb,false);
  PERFORM pg_temp.agent_reply(fenced,'{"stage":"Hook","text":"Two openings, one promise.","rationale":"Uses the opener idea.","evidenceIds":["abcd1234:0"],"verify":[]}'::jsonb,
    '[{"key":"publisher","value":"Substo promoting to new creators","basis":"inspired by this opening"}]'::jsonb,true);
  turn:=studio.studio_agent_record_step(loc,'substo',actor,t1,2,review,NULL);
  IF turn->>'status'<>'done' OR turn#>>'{result,proposals,0,stage}'<>'Hook' OR turn#>>'{result,plan,0}'<>'Compare two openings' THEN RAISE EXCEPTION 'Turn did not finish: %',turn; END IF;
  IF (SELECT payload#>>'{creation,stages,Hook}' FROM studio.studio_records WHERE id=draft) IS NOT NULL THEN RAISE EXCEPTION 'The model wrote to the draft'; END IF;
  -- History is Account-private: a teammate's finished turn never reaches this account's next snapshot.
  INSERT INTO studio.studio_agent_turns(id,location_id,record_id,actor_app,created_by_clerk_user_id,seq,message,provider,status,result)
    VALUES(mate_turn,loc,draft,'substo',mate,2,'TEAMMATE SECRET','subscription','done','{"reply":"TEAMMATE SECRET reply","choices":[],"proposals":[],"plan":["TEAMMATE PLAN"],"decisions":[{"key":"style","value":"TEAMMATE STYLE","basis":"x"}]}');
  PERFORM studio.studio_agent_begin_turn(loc,'substo',actor,draft,t3,'make the opener sharper','subscription');
  queued:=studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',jsonb_build_object('requestId',gen_random_uuid(),'provider','subscription','confirmSubscription',true,'focus','',
    'ideas',jsonb_build_array(jsonb_build_object('id',draft,'version',(saved->>'version')::bigint,'agent',jsonb_build_object('turnId',t3,'round',1)))));
  SELECT r.snapshot INTO snapshot FROM studio.studio_idea_reviews r WHERE id=(queued->>'reviewId')::uuid;
  IF snapshot::text LIKE '%TEAMMATE%' OR snapshot#>>'{conversation,0,owner}'<>'Make something inspired by this opening'
    OR snapshot#>>'{decisions,0,value}'<>'Substo promoting to new creators' OR snapshot#>>'{plan,0}'<>'Compare two openings' THEN
    RAISE EXCEPTION 'Private history leaked or own history lost: %',snapshot;
  END IF;
  -- An already-pinned approved template guides the chat without any new field.
  PERFORM studio.studio_propose_script_template(loc,'substo',actor,tpl,tpl_v,0,'Promise then payoff','Test purpose','[{"name":"Promise","guidance":"Show the outcome"}]');
  PERFORM studio.studio_approve_script_template(loc,'substo',actor,tpl,tpl_v);
  pinned_saved:=studio.studio_save_creation(loc,'substo',actor,pinned,0,'Pinned',patch,true,tpl_v,NULL,NULL,NULL);
  PERFORM studio.studio_agent_begin_turn(loc,'substo',actor,pinned,gen_random_uuid(),'Write the script','subscription');
  queued:=studio.studio_enqueue_routed_text_run(loc,'substo',actor,'script_brief',jsonb_build_object('requestId',gen_random_uuid(),'provider','subscription','confirmSubscription',true,'focus','',
    'ideas',jsonb_build_array(jsonb_build_object('id',pinned,'version',(pinned_saved->>'version')::bigint,'agent',jsonb_build_object('turnId',(SELECT id FROM studio.studio_agent_turns WHERE record_id=pinned),'round',1)))));
  SELECT r.snapshot INTO snapshot FROM studio.studio_idea_reviews r WHERE id=(queued->>'reviewId')::uuid;
  IF snapshot#>>'{template,name}'<>'Promise then payoff' OR snapshot#>>'{template,beats,0,name}'<>'Promise' THEN RAISE EXCEPTION 'Pinned template missing from agent snapshot: %',snapshot; END IF;
END $$;
