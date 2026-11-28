BEGIN;
ALTER TABLE studio.studio_devices DROP CONSTRAINT studio_devices_allowed_kinds_check;
ALTER TABLE studio.studio_devices ADD CONSTRAINT studio_devices_allowed_kinds_check CHECK (
 'studio.diagnostic'=any(allowed_kinds) AND allowed_kinds <@ ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe','studio.youtube_search','studio.video_assemble','studio.video_edit','studio.open_editor','studio.voice_preview','studio.character_sheet','studio.source_details']::text[]);
CREATE OR REPLACE FUNCTION studio.studio_device_allowed_kinds_sync() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
begin
 if tg_op='INSERT' or new.processing_enabled is distinct from old.processing_enabled then
  new.allowed_kinds:=case when new.processing_enabled then ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe','studio.youtube_search','studio.video_assemble','studio.video_edit','studio.open_editor','studio.voice_preview','studio.character_sheet','studio.source_details']::text[] else ARRAY['studio.diagnostic']::text[] end;
 end if; return new;
end $$;
UPDATE studio.studio_devices d SET allowed_kinds=array_append(d.allowed_kinds,'studio.source_details')
 WHERE d.processing_enabled AND d.revoked_at IS NULL AND NOT 'studio.source_details'=any(d.allowed_kinds);

CREATE TABLE studio.studio_source_details_comments (
 job_id uuid NOT NULL REFERENCES studio.studio_jobs(id) ON DELETE CASCADE,
 item_key text NOT NULL,
 position bigint GENERATED ALWAYS AS IDENTITY,
 data jsonb NOT NULL CHECK (jsonb_typeof(data)='object' AND octet_length(data::text)<=4000),
 PRIMARY KEY (job_id,item_key)
);
REVOKE ALL ON TABLE studio.studio_source_details_comments FROM PUBLIC;
GRANT SELECT ON TABLE studio.studio_source_details_comments TO service_role;

CREATE INDEX studio_source_details_latest ON studio.studio_jobs(location_id,(payload->>'recordId'),created_at DESC,id DESC)
 WHERE kind='studio.source_details';

CREATE FUNCTION studio.studio_request_source_details(p_location_id text,p_app text,p_user text,p_record_id uuid,p_source_url text,p_url text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_app,p_user);
 if p_url is null or p_url !~ '^https://www[.]youtube[.]com/watch[?]v=[A-Za-z0-9_-]{11}$' then raise exception 'Invalid URL' using errcode='22023'; end if;
 -- Serializes requests for the same record and fences source changes during admission.
 perform 1 from studio.studio_records where location_id=p_location_id and id=p_record_id and kind='reference' and not archived and source_url=p_source_url for update;
 if not found then raise exception 'Source unavailable' using errcode='P0002'; end if;
 select * into j from studio.studio_jobs where location_id=p_location_id and kind='studio.source_details' and payload->>'recordId'=p_record_id::text
  and payload->>'sourceUrl'=p_source_url and (
   (status='queued' or status='running' and lease_expires_at>clock_timestamp())
   or (created_by_clerk_user_id=p_user and idempotency_key='source-details:'||p_record_id::text||':'||p_request_id::text))
  order by created_at desc limit 1;
 if found then return jsonb_build_object('jobId',j.id); end if;
 select * into d from studio.studio_devices x where x.location_id=p_location_id and x.app=p_app and x.created_by=p_user and x.revoked_at is null
   and x.processing_enabled and 'studio.source_details'=any(x.allowed_kinds) and x.report->'handlers' ? 'studio.source_details'
   and x.report->>'sourceDetailsReady'='true' order by x.seen_at desc nulls last limit 1 for share;
 if not found then raise exception 'No ready Mac' using errcode='SD001'; end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.source_details',jsonb_build_object('recordId',p_record_id,'sourceUrl',p_source_url,'url',p_url),
  'source-details:'||p_record_id::text||':'||p_request_id::text,p_user,1);
 update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id and execution_target<>'device';
 return jsonb_build_object('jobId',j.id);
end $$;

CREATE FUNCTION studio.studio_source_details_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; snapshot jsonb;
begin
 if p_operation not in ('claim','extend','complete','fail','source_details_batch') then
  return studio.studio_character_sheet_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>(case when p_operation='source_details_batch' then 64000 else 32768 end)
   or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_operation='claim' then
  if p_body->>'sourceDetailsReady'='true' then
   if coalesce(p_body->>'leaseSeconds','') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 then raise exception 'Invalid lease' using errcode='22023'; end if;
   perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
   select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
   if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
   update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp(),
      last_error_code='worker_lease_expired',last_error_message='The Mac stopped before finishing. Any saved comments are still available.'
    where device_id=d.id and kind='studio.source_details' and status='running' and lease_expires_at<=clock_timestamp();
   if d.processing_enabled and not d.paused and 'studio.source_details'=any(d.allowed_kinds)
     and not exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then
    select x.* into j from studio.studio_jobs x join studio.studio_records r on r.location_id=x.location_id and r.id=(x.payload->>'recordId')::uuid
      where x.location_id=d.location_id and x.device_id=d.id and x.created_by_clerk_user_id=d.created_by and x.execution_target='device'
        and x.kind='studio.source_details' and x.status='queued' and x.run_after<=clock_timestamp()
        and r.kind='reference' and not r.archived and r.source_url=x.payload->>'sourceUrl'
      order by x.created_at limit 1 for update of x skip locked;
    if found then
     update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),
       lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
     insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
     return jsonb_build_array(to_jsonb(j));
    end if;
   end if;
  end if;
  return studio.studio_character_sheet_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;
 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id
   and created_by_clerk_user_id=d.created_by and execution_target='device' and kind='studio.source_details' for update;
 if not found then
  if p_operation='source_details_batch' then return 'false'::jsonb; end if;
  return studio.studio_character_sheet_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;
 if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid
   or j.lease_expires_at<=clock_timestamp() then
  return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end;
 end if;
 if p_operation='fail' then
  return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,p_body#>>'{failure,code}',left(p_body#>>'{failure,message}',300),false,null));
 end if;
 if not d.processing_enabled or not exists(select 1 from studio.studio_records where location_id=j.location_id
    and id=(j.payload->>'recordId')::uuid and kind='reference' and not archived and source_url=j.payload->>'sourceUrl') then return 'false'::jsonb; end if;
 if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
 if p_operation='complete' then
  if p_body#>'{result,sourceDetailsDone}' is distinct from 'true'::jsonb or j.result->>'outcome' is null then raise exception 'Incomplete source details' using errcode='22023'; end if;
  return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,j.result));
 end if;
 snapshot:=coalesce(j.result,'{}'::jsonb);
 if p_body ? 'meta' then snapshot:=snapshot||jsonb_build_object('meta',p_body->'meta'); end if;
 if p_body ? 'rows' then
  -- The first occurrence determines display order; repeating a batch cannot add duplicates.
  insert into studio.studio_source_details_comments(job_id,item_key,data)
   select j.id,row->>'id',row from jsonb_array_elements(p_body->'rows') as t(row)
   on conflict (job_id,item_key) do nothing;
  select snapshot||jsonb_build_object(
    'comments',count(*) filter (where data->>'parentId' is null),
    'replies',count(*) filter (where data->>'parentId' is not null)) into snapshot
   from studio.studio_source_details_comments where job_id=j.id;
  if (snapshot->>'comments')::integer+(snapshot->>'replies')::integer>250 then raise exception 'Too many comments' using errcode='22023'; end if;
 end if;
 if p_body ? 'outcome' then snapshot:=snapshot||(p_body-'workerId'-'leaseToken'-'jobId'-'meta'-'rows'); end if;
 update studio.studio_jobs set result=snapshot,updated_at=clock_timestamp() where id=j.id;
 return 'true'::jsonb;
end $$;

CREATE FUNCTION studio.studio_source_details_device_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.revoked_at is not null or not new.processing_enabled then
  update studio.studio_jobs set status='cancelled',lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp(),last_error_message='Mac processing was turned off or access was removed.'
   where device_id=new.id and kind='studio.source_details' and status in ('queued','running');
 end if;
 return null;
end $$;
CREATE TRIGGER studio_source_details_device_release AFTER UPDATE OF revoked_at,processing_enabled ON studio.studio_devices
 FOR EACH ROW EXECUTE FUNCTION studio.studio_source_details_device_release();

REVOKE ALL ON FUNCTION studio.studio_request_source_details(text,text,text,uuid,text,text,uuid),studio.studio_source_details_device_command(text,text,text,jsonb,text,jsonb),studio.studio_source_details_device_release() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_source_details(text,text,text,uuid,text,text,uuid),studio.studio_source_details_device_command(text,text,text,jsonb,text,jsonb) TO service_role;
COMMIT;
