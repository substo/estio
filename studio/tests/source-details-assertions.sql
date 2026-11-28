-- A source details run uses the requesting Mac's lease, stores batches before completion and survives duplicate delivery.
DO $$
DECLARE
 loc text:='cc000000-0000-4000-8000-0000000000b1';
 owner_id text:='cs-owner';
 h text:=repeat('a',64);
 other text:=repeat('c',64);
 source_id uuid:=gen_random_uuid();
 url text:='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
 req uuid:=gen_random_uuid();
 base jsonb:='{"workerId":"mac","leaseSeconds":120,"limit":1,"sourceDetailsReady":true}';
 claim jsonb;
 lease jsonb;
 batch jsonb;
 j uuid;
 outcome jsonb;
BEGIN
 UPDATE studio.studio_devices SET processing_enabled=true,paused=false,
  report='{"handlers":["studio.source_details"],"sourceDetailsReady":true}'
  WHERE token_hash=h;
 INSERT INTO studio.studio_records(location_id,id,kind,title,payload)
  VALUES(loc,source_id,'reference','Fixture',jsonb_build_object('url',url));
 IF has_table_privilege('authenticated','studio.studio_source_details_comments','SELECT')
   OR has_function_privilege('authenticated','studio.studio_source_details_device_command(text,text,text,jsonb,text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Source details permissions leaked'; END IF;
 j:=(studio.studio_request_source_details(loc,'substo',owner_id,source_id,url,url,req)->>'jobId')::uuid;
 IF j IS NULL OR j IS DISTINCT FROM (studio.studio_request_source_details(loc,'substo',owner_id,source_id,url,url,gen_random_uuid())->>'jobId')::uuid
 THEN RAISE EXCEPTION 'Active fetch was not reused'; END IF;
 claim:=studio.studio_source_details_device_command(h,'substo','claim',base);
 IF claim#>>'{0,id}' IS DISTINCT FROM j::text THEN RAISE EXCEPTION 'Unexpected claim: %',claim; END IF;
 lease:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim#>>'{0,lease_token}');
 IF studio.studio_source_details_device_command(h,'substo','source_details_batch',lease||'{"meta":{"title":"Fixture details"}}')<>'true'::jsonb
 THEN RAISE EXCEPTION 'Metadata not saved'; END IF;
 batch:=lease||'{"rows":[{"id":"thread-1","text":"First"},{"id":"reply-1","parentId":"thread-1","text":"Reply"}]}';
 IF studio.studio_source_details_device_command(other,'substo','source_details_batch',batch)<>'false'::jsonb
   OR studio.studio_source_details_device_command(h,'substo','source_details_batch',batch||jsonb_build_object('leaseToken',gen_random_uuid()))<>'false'::jsonb
 THEN RAISE EXCEPTION 'Invalid device or lease wrote rows'; END IF;
 FOR n IN 1..2 LOOP
  IF studio.studio_source_details_device_command(h,'substo','source_details_batch',batch)<>'true'::jsonb
  THEN RAISE EXCEPTION 'Batch was rejected'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM studio.studio_source_details_comments WHERE job_id=j)<>2
   OR (SELECT result->>'replies' FROM studio.studio_jobs WHERE id=j)<>'1'
   OR (SELECT result->>'comments' FROM studio.studio_jobs WHERE id=j)<>'1'
 THEN RAISE EXCEPTION 'Live rows or counts incorrect'; END IF;
 PERFORM studio.studio_source_details_device_command(h,'substo','source_details_batch',lease||'{"outcome":"limited","reason":"Fixture limit","unresolved":0}');
 PERFORM studio.studio_source_details_device_command(h,'substo','complete',lease||'{"result":{"sourceDetailsDone":true}}');
 SELECT result INTO outcome FROM studio.studio_jobs WHERE id=j AND status='succeeded';
 IF outcome IS NULL OR outcome->>'outcome'<>'limited' OR outcome#>>'{meta,title}'<>'Fixture details'
 THEN RAISE EXCEPTION 'Completed result incorrect: %',outcome; END IF;
 IF studio.studio_source_details_device_command(h,'substo','source_details_batch',batch)<>'false'::jsonb
   OR j IS DISTINCT FROM (studio.studio_request_source_details(loc,'substo',owner_id,source_id,url,url,req)->>'jobId')::uuid
 THEN RAISE EXCEPTION 'Terminal job accepted a late write or duplicate request'; END IF;
 j:=(studio.studio_request_source_details(loc,'substo',owner_id,source_id,url,url,gen_random_uuid())->>'jobId')::uuid;
 claim:=studio.studio_source_details_device_command(h,'substo','claim',base);
 UPDATE studio.studio_devices SET processing_enabled=false WHERE token_hash=h;
 IF claim#>>'{0,id}' IS DISTINCT FROM j::text OR (SELECT status FROM studio.studio_jobs WHERE id=j)<>'cancelled'
 THEN RAISE EXCEPTION 'Turning off processing did not stop the fetch'; END IF;
END $$;
