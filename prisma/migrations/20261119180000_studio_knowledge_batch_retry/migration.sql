BEGIN;
-- Stopped batch recovery. Completed batches are untouched; a stopped batch gets one new, explicitly
-- authorized job through the existing routed enqueue. Uncertain work is never replayed automatically,
-- and the replay fence on the failed job stays in force.

CREATE TABLE studio.studio_knowledge_outline_retries (
  location_id text NOT NULL,
  outline_id uuid NOT NULL,
  request_id uuid NOT NULL,
  failed_review_id uuid NOT NULL,
  start_unit integer NOT NULL,
  batch_request_id uuid NOT NULL,
  request jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(location_id,request_id),
  UNIQUE(location_id,batch_request_id),
  FOREIGN KEY(location_id,outline_id) REFERENCES studio.studio_knowledge_outlines(location_id,id) ON DELETE CASCADE
);
ALTER TABLE studio.studio_knowledge_outline_retries ENABLE ROW LEVEL SECURITY;

-- Admission also accepts a retry batch that the retry function recorded first.
CREATE OR REPLACE FUNCTION studio.studio_enqueue_knowledge_extraction(p_location_id text, p_actor_app text, p_clerk_user_id text, p_request_id uuid, p_source_id uuid, p_expected_version bigint, p_mode text, p_input_id text, p_start_unit integer, p_unit_count integer, p_focus text, p_confirm_paid boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare prior studio.studio_idea_reviews%rowtype; v_request jsonb; snapshot jsonb; run_id uuid:=gen_random_uuid(); j studio.studio_jobs%rowtype;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_request_id is null or p_confirm_paid is distinct from true then raise exception 'Explicit paid extraction authorization required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location_id::text,0));
 v_request := jsonb_build_object('sourceId',p_source_id,'version',p_expected_version,'mode',p_mode,'inputId',p_input_id,'startUnit',p_start_unit,'unitCount',p_unit_count,'focus',p_focus,'actor',p_clerk_user_id,'app',p_actor_app);
 select * into prior from studio.studio_idea_reviews where location_id=p_location_id and request_id=p_request_id;
 if found then
  if prior.workflow<>'knowledge_extract' or prior.request is distinct from v_request then raise exception 'Extraction request reused' using errcode='23505'; end if;
  return jsonb_build_object('reviewId',prior.id,'jobId',prior.job_id);
 end if;
 if p_mode='outline' then
  if not exists(select 1 from studio.studio_knowledge_outlines o where o.location_id=p_location_id and o.id=p_input_id::uuid
    and o.actor_app=p_actor_app and o.actor_id=p_clerk_user_id and (p_request_id=md5(o.id::text||':'||p_start_unit::text)::uuid
    or exists(select 1 from studio.studio_knowledge_outline_retries t where t.location_id=o.location_id and t.outline_id=o.id and t.batch_request_id=p_request_id and t.start_unit=p_start_unit))) then
   raise exception 'Invalid outline batch admission' using errcode='42501';
  end if;
 elsif (select count(*) from studio.studio_jobs active_job where active_job.location_id=p_location_id
   and active_job.kind in ('studio.idea_review','studio.script_brief','studio.knowledge_extract') and active_job.status in ('queued','running')
   and not exists(select 1 from studio.studio_idea_reviews b where b.location_id=active_job.location_id and b.job_id=active_job.id and b.snapshot->>'mode'='outline'))>=5 then
  raise exception 'Too many active text runs' using errcode='40001';
 end if;
 snapshot := studio.studio_build_knowledge_snapshot(p_location_id,p_source_id,p_expected_version,p_mode,p_input_id,p_start_unit,p_unit_count,p_focus);
 if octet_length(snapshot::text)>24000 then raise exception 'Select fewer source units for this bounded extraction' using errcode='22023'; end if;
 j := studio.studio_enqueue_job(p_location_id,'studio.knowledge_extract',jsonb_build_object('reviewId',run_id),'text-run:'||p_request_id::text,p_clerk_user_id,5);
 insert into studio.studio_idea_reviews(id,location_id,request_id,created_by_clerk_user_id,actor_app,request,snapshot,job_id,workflow,prompt_version)
  values(run_id,p_location_id,p_request_id,p_clerk_user_id,p_actor_app,v_request,snapshot,j.id,'knowledge_extract','studio.knowledge-extract.v1');
 return jsonb_build_object('reviewId',run_id,'jobId',j.id);
end; $$;


CREATE FUNCTION studio.studio_retry_knowledge_outline_batch(p_location text,p_app text,p_actor text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o studio.studio_knowledge_outlines%rowtype; failed studio.studio_idea_reviews%rowtype; fj studio.studio_jobs%rowtype;
  prior studio.studio_knowledge_outline_retries%rowtype; run jsonb; provider text; start_unit integer; batch_request uuid;
  v_request uuid:=(p_command->>'requestId')::uuid; v_outline uuid:=(p_command->>'outlineId')::uuid; v_review uuid:=(p_command->>'reviewId')::uuid;
  route_request jsonb;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  IF v_request IS NULL OR v_outline IS NULL OR v_review IS NULL THEN
    RAISE EXCEPTION 'Choose a stopped batch' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location,0));
  route_request:=p_command||jsonb_build_object('app',p_app,'actor',p_actor);
  SELECT * INTO prior FROM studio.studio_knowledge_outline_retries t WHERE t.location_id=p_location AND t.request_id=v_request;
  IF FOUND THEN
    IF prior.request IS DISTINCT FROM route_request THEN RAISE EXCEPTION 'Retry request reused' USING ERRCODE='23505'; END IF;
    RETURN prior.result;
  END IF;
  SELECT * INTO o FROM studio.studio_knowledge_outlines x WHERE x.location_id=p_location AND x.id=v_outline AND x.actor_app=p_app AND x.actor_id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extraction access denied' USING ERRCODE='42501'; END IF;
  provider:=o.request->>'provider';
  IF provider IS NULL OR provider NOT IN ('subscription','openai')
    OR (provider='subscription' AND p_command->>'confirmSubscription' IS DISTINCT FROM 'true')
    OR (provider='openai' AND p_command->>'confirmPaid' IS DISTINCT FROM 'true') THEN
    RAISE EXCEPTION 'Authorize extraction funding explicitly' USING ERRCODE='22023';
  END IF;
  SELECT * INTO failed FROM studio.studio_idea_reviews r WHERE r.location_id=p_location AND r.id=v_review AND r.workflow='knowledge_extract'
    AND r.snapshot->>'mode'='outline' AND r.snapshot->>'inputId'=o.id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found' USING ERRCODE='22023'; END IF;
  SELECT * INTO fj FROM studio.studio_jobs j WHERE j.location_id=p_location AND j.id=failed.job_id FOR UPDATE;
  IF fj.status IS DISTINCT FROM 'failed' OR failed.result IS NOT NULL THEN
    RAISE EXCEPTION 'Only a stopped batch can be retried' USING ERRCODE='40001';
  END IF;
  start_unit:=(failed.snapshot->>'startUnit')::integer;
  IF EXISTS(SELECT 1 FROM studio.studio_idea_reviews r2 WHERE r2.location_id=p_location AND r2.workflow='knowledge_extract'
    AND r2.snapshot->>'mode'='outline' AND r2.snapshot->>'inputId'=o.id::text AND (r2.snapshot->>'startUnit')::integer=start_unit
    AND r2.id<>failed.id AND (r2.created_at,r2.id)>(failed.created_at,failed.id)) THEN
    RAISE EXCEPTION 'This batch was already retried' USING ERRCODE='40001';
  END IF;
  IF 1+(SELECT count(*) FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
      WHERE r.location_id=p_location AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='outline' AND j.status IN ('queued','running'))>72 THEN
    RAISE EXCEPTION 'Wait for existing extraction batches to finish' USING ERRCODE='P2012';
  END IF;
  batch_request:=md5(o.id::text||':'||start_unit::text||':retry:'||v_request::text)::uuid;
  INSERT INTO studio.studio_knowledge_outline_retries(location_id,outline_id,request_id,failed_review_id,start_unit,batch_request_id,request)
    VALUES(p_location,o.id,v_request,failed.id,start_unit,batch_request,route_request);
  run:=studio.studio_enqueue_routed_text_run(p_location,p_app,p_actor,'knowledge_extract',
    jsonb_build_object('requestId',batch_request,'sourceId',o.source_id,'expectedVersion',o.source_version,'mode','outline','inputId',o.id,
      'startUnit',start_unit,'unitCount',(failed.snapshot->>'unitCount')::integer,'focus','','provider',provider,
      'confirmSubscription',provider='subscription','confirmPaid',provider='openai'));
  UPDATE studio.studio_knowledge_outline_retries t SET result=jsonb_build_object('outlineId',o.id,'reviewId',run->>'reviewId')
    WHERE t.location_id=p_location AND t.request_id=v_request;
  RETURN jsonb_build_object('outlineId',o.id,'reviewId',run->>'reviewId');
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_retry_knowledge_outline_batch(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_retry_knowledge_outline_batch(text,text,text,jsonb) TO service_role;

-- The outline shows each batch's job id and hides a stopped batch once a later retry supersedes it.
-- The superseded review and its job stay as evidence.
ALTER FUNCTION studio.studio_get_knowledge_outline(text,text,text,uuid) RENAME TO studio_get_outline_before_retries;
CREATE FUNCTION studio.studio_get_knowledge_outline(p_location text,p_app text,p_actor text,p_outline uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH base AS (SELECT studio.studio_get_outline_before_retries(p_location,p_app,p_actor,p_outline) AS v)
  SELECT CASE WHEN v IS NULL THEN NULL ELSE jsonb_set(v,'{batches}',coalesce((
    SELECT jsonb_agg(x.b||jsonb_build_object('jobId',r.job_id) ORDER BY x.ord)
    FROM jsonb_array_elements(v->'batches') WITH ORDINALITY AS x(b,ord)
    JOIN studio.studio_idea_reviews r ON r.location_id=p_location AND r.id=(x.b->>'reviewId')::uuid
    WHERE NOT EXISTS(SELECT 1 FROM studio.studio_idea_reviews r2 WHERE r2.location_id=r.location_id AND r2.workflow='knowledge_extract'
      AND r2.snapshot->>'mode'='outline' AND r2.snapshot->>'inputId'=r.snapshot->>'inputId'
      AND (r2.snapshot->>'startUnit')::integer=(r.snapshot->>'startUnit')::integer AND r2.id<>r.id AND (r2.created_at,r2.id)>(r.created_at,r.id))),'[]'::jsonb)) END
  FROM base;
$$;
REVOKE ALL ON FUNCTION studio.studio_get_knowledge_outline(text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION studio.studio_get_outline_before_retries(text,text,text,uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION studio.studio_get_knowledge_outline(text,text,text,uuid) TO service_role;

-- Name the stopped stage from a fixed vocabulary. The Mac's own message is never stored.
ALTER FUNCTION studio.studio_text_device_command(text,text,text,jsonb,text) RENAME TO studio_text_device_command_before_stage;
CREATE FUNCTION studio.studio_text_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; stage text:=p_body#>>'{failure,stage}';
BEGIN
  result:=studio.studio_text_device_command_before_stage(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
  IF p_operation='fail' AND result='"failed"'::jsonb AND stage IN ('cli_not_ready','cli_timeout','cli_cancelled','cli_failed','cli_output_limit','result_parse','result_validation','unknown')
    AND p_body->>'jobId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE studio.studio_jobs SET last_error_message='Subscription execution stopped without a validated saved result (stage: '||stage||'). Automatic replay is blocked.'
      WHERE id=(p_body->>'jobId')::uuid AND kind='studio.text_run' AND status='failed' AND last_error_code='text_execution_uncertain';
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION studio.studio_text_device_command(text,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION studio.studio_text_device_command_before_stage(text,text,text,jsonb,text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION studio.studio_text_device_command(text,text,text,jsonb,text) TO service_role;
COMMIT;
