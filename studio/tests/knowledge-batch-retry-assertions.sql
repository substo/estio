-- Partial extraction: completed batches stay, uncertain work is never replayed automatically,
-- and an explicit authorized retry runs only the stopped batch as a new job.
DO $$
DECLARE loc text:='ac000000-0000-4000-8000-000000000051'; actor text:='retry-owner'; src uuid:=gen_random_uuid();
  device uuid; digest text:=repeat('d',64); cmd jsonb; retry jsonb; outline uuid; data jsonb; claimed jsonb; body jsonb;
  n integer; i integer; failed_job uuid; failed_review uuid; done_job uuid; before_results jsonb; jobs_before integer; reviews_before integer;
  retry_id uuid:=gen_random_uuid(); fresh_review uuid;
BEGIN
  PERFORM studio.studio_create_substo_location(loc,'Retry fixture',actor);
  PERFORM public.test_member(loc,'retry-teammate','member');
  device:=pg_temp.pair_text_device(loc,actor,'RETRYAAA',digest);
  UPDATE studio.studio_devices SET report=report||'{"knowledgeOutlineVersion":2}' WHERE id=device;
  INSERT INTO studio.studio_records(location_id,id,kind,title,payload)
    VALUES(loc,src,'reference','Partial source',jsonb_build_object('transcript',repeat('Example text. ',1850)));
  cmd:=jsonb_build_object('action','enqueueOutline','requestId',gen_random_uuid(),'sourceId',src,'expectedVersion',1,
    'mode','record_text','inputId','transcript','provider','subscription','confirmSubscription',true);
  outline:=(studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd)->>'outlineId')::uuid;
  data:=studio.studio_get_knowledge_outline(loc,'substo',actor,outline);
  n:=jsonb_array_length(data->'batches');
  IF n<2 THEN RAISE EXCEPTION 'Fixture needs several batches'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(data->'batches') b JOIN studio.studio_idea_reviews r
        ON r.id=(b->>'reviewId')::uuid AND r.job_id=(b->>'jobId')::uuid AND r.location_id=loc)<>n THEN
    RAISE EXCEPTION 'Batch job ids missing or mismatched';
  END IF;
  -- All but one batch complete; the last claimed stops as uncertain with a named stage.
  FOR i IN 1..n LOOP
    claimed:=studio.studio_text_device_command(digest,'substo','claim','{"workerId":"retry-mac","limit":1,"leaseSeconds":60,"textReady":true}')->0;
    body:=jsonb_build_object('workerId','retry-mac','jobId',claimed->>'id','leaseToken',claimed->>'lease_token');
    IF i<n THEN
      IF studio.studio_text_device_command(digest,'substo','complete',body||jsonb_build_object('result',
        jsonb_build_object('output','{"findings":[]}'::jsonb,'provider','codex','model','native-default')))<>'true' THEN RAISE EXCEPTION 'Completion rejected'; END IF;
    ELSE
      failed_job:=(claimed->>'id')::uuid;
      IF studio.studio_text_device_command(digest,'substo','fail',body||'{"failure":{"code":"text_execution_uncertain","message":"ignored","retryable":false,"stage":"cli_timeout"}}')<>'"failed"'::jsonb THEN
        RAISE EXCEPTION 'Failure not recorded'; END IF;
    END IF;
  END LOOP;
  SELECT r.id INTO failed_review FROM studio.studio_idea_reviews r WHERE r.job_id=failed_job;
  IF (SELECT last_error_message FROM studio.studio_jobs WHERE id=failed_job) NOT LIKE '%(stage: cli_timeout)%' THEN RAISE EXCEPTION 'Stage not recorded'; END IF;
  -- Unknown stage text is never stored.
  UPDATE studio.studio_jobs SET last_error_message='x' WHERE id=failed_job;
  data:=studio.studio_get_knowledge_outline(loc,'substo',actor,outline);
  IF (SELECT count(*) FROM jsonb_array_elements(data->'batches') b WHERE b->>'status'='failed' AND coalesce(b->'result','null'::jsonb)='null'::jsonb)<>1
    OR (SELECT count(*) FROM jsonb_array_elements(data->'batches') b WHERE b->>'status'='succeeded' AND b->'result' IS NOT NULL)<>n-1 THEN
    RAISE EXCEPTION 'Partial state not preserved';
  END IF;
  done_job:=(SELECT (b->>'jobId')::uuid FROM jsonb_array_elements(data->'batches') b WHERE b->>'status'='succeeded' LIMIT 1);
  before_results:=(SELECT jsonb_agg(b->'result' ORDER BY b->>'reviewId') FROM jsonb_array_elements(data->'batches') b WHERE b->>'status'='succeeded');
  SELECT count(*) INTO jobs_before FROM studio.studio_jobs WHERE location_id=loc;
  SELECT count(*) INTO reviews_before FROM studio.studio_idea_reviews WHERE location_id=loc;
  -- Never replayed automatically, and the old job itself can never be requeued.
  IF studio.studio_text_device_command(digest,'substo','claim','{"workerId":"retry-mac","limit":1,"leaseSeconds":60,"textReady":true}')->0 IS NOT NULL THEN
    RAISE EXCEPTION 'Uncertain work was replayed automatically';
  END IF;
  BEGIN PERFORM studio.studio_member_job_action(loc,'substo',actor,failed_job,'retry'); RAISE EXCEPTION 'Replay fence bypassed';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  retry:=jsonb_build_object('action','retryBatch','requestId',retry_id,'outlineId',outline,'reviewId',failed_review,'provider','subscription','confirmSubscription',true);
  -- Authority and consent.
  BEGIN PERFORM studio.studio_retry_knowledge_outline_batch(loc,'estio',actor,retry); RAISE EXCEPTION 'Wrong realm retried';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM studio.studio_retry_knowledge_outline_batch(loc,'substo','retry-teammate',retry); RAISE EXCEPTION 'Other member retried';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM studio.studio_retry_knowledge_outline_batch(loc,'substo',actor,retry||'{"confirmSubscription":false}'); RAISE EXCEPTION 'Retry without consent';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM studio.studio_retry_knowledge_outline_batch(loc,'substo',actor,retry||jsonb_build_object('reviewId',(SELECT (b->>'reviewId')::uuid FROM jsonb_array_elements(data->'batches') b WHERE b->>'status'='succeeded' LIMIT 1)));
    RAISE EXCEPTION 'Completed batch retried';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  UPDATE studio.studio_devices SET revoked_at=now() WHERE id=device;
  BEGIN PERFORM studio.studio_retry_knowledge_outline_batch(loc,'substo',actor,retry); RAISE EXCEPTION 'Revoked Mac retried';
  EXCEPTION WHEN SQLSTATE 'P2011' OR invalid_parameter_value THEN NULL; END;
  UPDATE studio.studio_devices SET revoked_at=NULL WHERE id=device;
  -- Failed attempts leave no half-created work.
  IF (SELECT count(*) FROM studio.studio_jobs WHERE location_id=loc)<>jobs_before OR (SELECT count(*) FROM studio.studio_knowledge_outline_retries WHERE location_id=loc)<>0 THEN
    RAISE EXCEPTION 'Rejected retry left work behind';
  END IF;
  -- Explicit retry creates exactly one new job for exactly this batch; replay is stable.
  data:=studio.studio_retry_knowledge_outline_batch(loc,'substo',actor,retry);
  fresh_review:=(data->>'reviewId')::uuid;
  IF studio.studio_retry_knowledge_outline_batch(loc,'substo',actor,retry) IS DISTINCT FROM data THEN RAISE EXCEPTION 'Unstable retry replay'; END IF;
  BEGIN PERFORM studio.studio_retry_knowledge_outline_batch(loc,'substo',actor,retry||'{"provider":"openai","confirmPaid":true}'); RAISE EXCEPTION 'Changed replay accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN PERFORM studio.studio_retry_knowledge_outline_batch(loc,'substo',actor,retry||jsonb_build_object('requestId',gen_random_uuid())); RAISE EXCEPTION 'Stopped batch retried twice';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  IF (SELECT count(*) FROM studio.studio_jobs WHERE location_id=loc)<>jobs_before+1
    OR (SELECT count(*) FROM studio.studio_idea_reviews WHERE location_id=loc)<>reviews_before+1
    OR fresh_review=failed_review
    OR (SELECT snapshot->>'startUnit' FROM studio.studio_idea_reviews WHERE id=fresh_review)<>(SELECT snapshot->>'startUnit' FROM studio.studio_idea_reviews WHERE id=failed_review)
    OR (SELECT snapshot->>'unitCount' FROM studio.studio_idea_reviews WHERE id=fresh_review)<>(SELECT snapshot->>'unitCount' FROM studio.studio_idea_reviews WHERE id=failed_review) THEN
    RAISE EXCEPTION 'Retry did not create exactly one matching batch';
  END IF;
  IF (SELECT status FROM studio.studio_jobs WHERE id=failed_job)<>'failed' OR (SELECT last_error_message FROM studio.studio_jobs WHERE id=failed_job)<>'x' THEN
    RAISE EXCEPTION 'Failed evidence changed';
  END IF;
  data:=studio.studio_get_knowledge_outline(loc,'substo',actor,outline);
  IF jsonb_array_length(data->'batches')<>n OR EXISTS(SELECT 1 FROM jsonb_array_elements(data->'batches') b WHERE b->>'reviewId'=failed_review::text) THEN
    RAISE EXCEPTION 'Superseded batch still shown';
  END IF;
  -- Another extraction for the same source waits while the retry is active.
  BEGIN PERFORM studio.studio_enqueue_knowledge_outline(loc,'substo',actor,cmd||jsonb_build_object('requestId',gen_random_uuid())); RAISE EXCEPTION 'Parallel extraction during retry';
  EXCEPTION WHEN SQLSTATE 'P2012' THEN NULL; END;
  claimed:=studio.studio_text_device_command(digest,'substo','claim','{"workerId":"retry-mac","limit":1,"leaseSeconds":60,"textReady":true}')->0;
  IF claimed#>>'{payload,reviewId}' IS DISTINCT FROM fresh_review::text THEN RAISE EXCEPTION 'Retry claimed another batch'; END IF;
  body:=jsonb_build_object('workerId','retry-mac','jobId',claimed->>'id','leaseToken',claimed->>'lease_token');
  IF studio.studio_text_device_command(digest,'substo','complete',body||jsonb_build_object('result',
    jsonb_build_object('output','{"findings":[]}'::jsonb,'provider','codex','model','native-default')))<>'true' THEN RAISE EXCEPTION 'Retry completion rejected'; END IF;
  data:=studio.studio_get_knowledge_outline(loc,'substo',actor,outline);
  IF (SELECT count(*) FROM jsonb_array_elements(data->'batches') b WHERE b->>'status'='succeeded' AND b->'result' IS NOT NULL)<>n
    OR (SELECT jsonb_agg(b->'result' ORDER BY b->>'reviewId') FROM jsonb_array_elements(data->'batches') b WHERE (b->>'jobId')::uuid<>(SELECT job_id FROM studio.studio_idea_reviews WHERE id=fresh_review)) IS DISTINCT FROM before_results THEN
    RAISE EXCEPTION 'Completed batches changed by retry';
  END IF;
END $$;
