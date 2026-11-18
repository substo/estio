BEGIN;
-- Gap 1: paired-Mac video transcription (local Parakeet, YouTube captions fallback, scene frames + OCR).
-- Additive. Reuses the device lease/idempotency protocol; never routes to a paid API or another account's Mac.

-- 1. A paired Mac may also be granted video transcription while processing is On (the Setup toggle is the consent).
ALTER TABLE studio.studio_devices DROP CONSTRAINT studio_devices_allowed_kinds_check;
ALTER TABLE studio.studio_devices ADD CONSTRAINT studio_devices_allowed_kinds_check CHECK (
 'studio.diagnostic'=any(allowed_kinds) AND allowed_kinds <@ ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe']::text[]);
CREATE OR REPLACE FUNCTION studio.studio_device_allowed_kinds_sync() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
begin
 if tg_op='INSERT' or new.processing_enabled is distinct from old.processing_enabled then
  new.allowed_kinds:=case when new.processing_enabled then ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe']::text[] else ARRAY['studio.diagnostic']::text[] end;
 end if; return new;
end $$;
UPDATE studio.studio_devices SET allowed_kinds=array_append(allowed_kinds,'studio.video_transcribe') WHERE processing_enabled AND revoked_at IS NULL AND NOT 'studio.video_transcribe'=any(allowed_kinds);

-- 2. One row per transcription attempt for a Library source.
CREATE TABLE studio.studio_video_transcriptions (
 location_id text NOT NULL REFERENCES public."Location"(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 record_id uuid NOT NULL,
 video_id text NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
 origin text NOT NULL CHECK (origin IN ('paste','search','approved_channel','suggestion','discovery_suggestion')),
 actor_app text NOT NULL CHECK (actor_app IN ('estio','substo')),
 actor_id text NOT NULL CHECK (btrim(actor_id)<>''),
 request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9:._-]{1,120}$'),
 device_id uuid,
 job_id uuid,
 status text NOT NULL CHECK (status IN ('suggested','queued','running','ready','partial','failed','cancelled','skipped')),
 gated boolean NOT NULL DEFAULT false,
 relevance jsonb CHECK (relevance IS NULL OR (jsonb_typeof(relevance)='object' AND octet_length(relevance::text)<=2048)),
 method text CHECK (method IS NULL OR method IN ('local-parakeet-tdt-v3-4bit','youtube-captions-fallback')),
 language text CHECK (language IS NULL OR language ~ '^[a-z]{2,12}$'),
 duration_seconds numeric CHECK (duration_seconds IS NULL OR (duration_seconds>=0 AND duration_seconds<=7300)),
 segment_count integer NOT NULL DEFAULT 0 CHECK (segment_count>=0),
 transcript_chars integer NOT NULL DEFAULT 0 CHECK (transcript_chars>=0),
 transcript_applied boolean NOT NULL DEFAULT false,
 visual_status text NOT NULL DEFAULT 'pending' CHECK (visual_status IN ('pending','ready','failed','skipped')),
 visual_error text CHECK (visual_error IS NULL OR char_length(visual_error)<=300),
 frame_count integer NOT NULL DEFAULT 0 CHECK (frame_count BETWEEN 0 AND 200),
 error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
 error_message text CHECK (error_message IS NULL OR char_length(error_message)<=300),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 PRIMARY KEY (location_id,id),
 UNIQUE (location_id,request_key),
 FOREIGN KEY (location_id,record_id) REFERENCES studio.studio_records(location_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX studio_video_transcriptions_one_active ON studio.studio_video_transcriptions(location_id,record_id) WHERE status IN ('queued','running');
CREATE INDEX studio_video_transcriptions_record ON studio.studio_video_transcriptions(location_id,record_id,created_at DESC);
CREATE INDEX studio_video_transcriptions_job ON studio.studio_video_transcriptions(job_id) WHERE job_id IS NOT NULL;

-- Timestamped segments, uploaded in bounded chunks under the job lease (a transcript is larger than one device request).
CREATE TABLE studio.studio_video_transcript_chunks (
 location_id text NOT NULL,
 transcription_id uuid NOT NULL,
 chunk_index integer NOT NULL CHECK (chunk_index BETWEEN 0 AND 79),
 segments jsonb NOT NULL CHECK (jsonb_typeof(segments)='array' AND jsonb_array_length(segments) BETWEEN 1 AND 400 AND octet_length(segments::text)<=26000),
 PRIMARY KEY (location_id,transcription_id,chunk_index),
 FOREIGN KEY (location_id,transcription_id) REFERENCES studio.studio_video_transcriptions(location_id,id) ON DELETE CASCADE
);

-- Private R2 scene frames with OCR. The OCR text is also exposed to extraction as source units.
CREATE TABLE studio.studio_video_frames (
 location_id text NOT NULL,
 transcription_id uuid NOT NULL,
 frame_index integer NOT NULL CHECK (frame_index BETWEEN 0 AND 199),
 time_seconds numeric NOT NULL CHECK (time_seconds>=0 AND time_seconds<=7300),
 scene_start numeric NOT NULL CHECK (scene_start>=0 AND scene_start<=7300),
 scene_end numeric NOT NULL CHECK (scene_end>=0 AND scene_end<=7300),
 ocr_text text NOT NULL DEFAULT '' CHECK (char_length(ocr_text)<=1200),
 audio_context text NOT NULL DEFAULT '' CHECK (char_length(audio_context)<=1000),
 selection text NOT NULL CHECK (selection ~ '^[a-z][a-z0-9-]{0,39}$'),
 sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 1572864),
 content_type text NOT NULL CHECK (content_type='image/jpeg'),
 object_key text NOT NULL,
 status text NOT NULL CHECK (status IN ('pending','verified')),
 bucket_id text CHECK (bucket_id IS NULL OR bucket_id ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
 media_object_id uuid,
 unit_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (location_id,transcription_id,frame_index),
 FOREIGN KEY (location_id,transcription_id) REFERENCES studio.studio_video_transcriptions(location_id,id) ON DELETE CASCADE,
 FOREIGN KEY (media_object_id,location_id) REFERENCES studio.studio_media_objects(id,location_id) ON DELETE RESTRICT,
 CHECK (object_key=location_id||'/video-frames/'||transcription_id::text||'/'||frame_index::text||'-'||sha256||'.jpg'),
 CHECK ((status='verified')=(media_object_id IS NOT NULL AND bucket_id IS NOT NULL))
);
ALTER TABLE studio.studio_video_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.studio_video_transcript_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.studio_video_frames ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON studio.studio_video_transcriptions,studio.studio_video_transcript_chunks,studio.studio_video_frames FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON studio.studio_video_transcriptions,studio.studio_video_frames TO service_role;

-- 3. Device selection: the REQUESTING account's own Mac only. Offline/paused Macs still qualify (the job waits).
CREATE FUNCTION studio.studio_video_pick_device(p_location text,p_app text,p_user text) RETURNS TABLE(device_id uuid,reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype;
begin
 select * into d from studio.studio_devices x where x.location_id=p_location and x.app=p_app and x.created_by=p_user and x.revoked_at is null
  and x.processing_enabled and 'studio.video_transcribe'=any(x.allowed_kinds) and x.report->'handlers' ? 'studio.video_transcribe'
  and x.desired_config#>>'{features,transcription}'='true' and x.config_version=x.applied_config_version and x.config_status='applied'
  and x.report#>>'{video,ready}'='true' order by x.seen_at desc nulls last limit 1 for share;
 if found then return query select d.id,null::text; return; end if;
 return query select null::uuid,case
  when not exists(select 1 from studio.studio_devices x where x.location_id=p_location and x.app=p_app and x.created_by=p_user and x.revoked_at is null) then 'no_mac'
  when not exists(select 1 from studio.studio_devices x where x.location_id=p_location and x.app=p_app and x.created_by=p_user and x.revoked_at is null and x.processing_enabled) then 'processing_off'
  when not exists(select 1 from studio.studio_devices x where x.location_id=p_location and x.app=p_app and x.created_by=p_user and x.revoked_at is null and x.processing_enabled and x.desired_config#>>'{features,transcription}'='true' and x.config_version=x.applied_config_version and x.config_status='applied') then 'transcription_off'
  when not exists(select 1 from studio.studio_devices x where x.location_id=p_location and x.app=p_app and x.created_by=p_user and x.revoked_at is null and x.processing_enabled and x.report->'handlers' ? 'studio.video_transcribe') then 'companion_outdated'
  else 'tools_missing' end;
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_pick_device(text,text,text) FROM PUBLIC;

-- Tunable relevance thresholds: score >= auto (and relevant) transcribes, score >= review asks the user, below is logged and skipped.
CREATE FUNCTION studio.studio_video_gate(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
declare t jsonb:=coalesce(p_context->'thresholds','{"auto":70,"review":40}'::jsonb); c jsonb:=coalesce(p_context->'context','{}'::jsonb);
begin
 if jsonb_typeof(p_context) is distinct from 'object' or jsonb_typeof(t) is distinct from 'object' or jsonb_typeof(c) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_context) k where k not in ('thresholds','context'))
  or exists(select 1 from jsonb_object_keys(t) k where k not in ('auto','review'))
  or exists(select 1 from jsonb_object_keys(c) k where k not in ('approvedTitles','pinnedKnowledge','profile'))
  or jsonb_typeof(t->'auto') is distinct from 'number' or jsonb_typeof(t->'review') is distinct from 'number'
  or (t->>'review')::numeric<=0 or (t->>'auto')::numeric>100 or (t->>'review')::numeric>=(t->>'auto')::numeric
  or octet_length(p_context::text)>14000
  or jsonb_typeof(coalesce(c->'approvedTitles','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(c->'approvedTitles','[]'::jsonb))>30
  or jsonb_typeof(coalesce(c->'pinnedKnowledge','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(c->'pinnedKnowledge','[]'::jsonb))>20
  or jsonb_typeof(coalesce(c->'profile','{}'::jsonb)) is distinct from 'object' then raise exception 'Invalid relevance context' using errcode='22023'; end if;
 return jsonb_build_object('thresholds',jsonb_build_object('auto',(t->>'auto')::numeric,'review',(t->>'review')::numeric),'context',c);
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_gate(jsonb) FROM PUBLIC;

CREATE FUNCTION studio.studio_video_id_of(p_url text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 select (regexp_match(p_url,'^https://www\.youtube\.com/watch\?v=([A-Za-z0-9_-]{11})$'))[1]
$$;
REVOKE ALL ON FUNCTION studio.studio_video_id_of(text) FROM PUBLIC;

-- Shared enqueue core. The caller has already locked the member/location and holds the per-location video lock.
CREATE FUNCTION studio.studio_video_enqueue_core(p_location text,p_app text,p_user text,p_record uuid,p_origin text,p_request_key text,p_gate jsonb,p_raise boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare rec studio.studio_records%rowtype; vid text; prior studio.studio_video_transcriptions%rowtype; dev uuid; why text; t studio.studio_video_transcriptions%rowtype; j studio.studio_jobs%rowtype;
begin
 select * into rec from studio.studio_records where location_id=p_location and id=p_record and kind='reference' for share;
 if not found or rec.archived then raise exception 'Source unavailable' using errcode='22023'; end if;
 vid:=studio.studio_video_id_of(rec.source_url);
 if vid is null then raise exception 'Only a canonical YouTube video source can be transcribed' using errcode='22023'; end if;
 select * into prior from studio.studio_video_transcriptions where location_id=p_location and request_key=p_request_key;
 if found then
  if prior.record_id<>p_record or prior.origin<>p_origin then raise exception 'Request key reused' using errcode='23505'; end if;
  return jsonb_build_object('transcriptionId',prior.id,'status',prior.status,'reused',true);
 end if;
 select * into prior from studio.studio_video_transcriptions where location_id=p_location and record_id=p_record and status in ('queued','running') limit 1;
 if found then return jsonb_build_object('transcriptionId',prior.id,'status',prior.status,'reused',true); end if;
 -- An existing finished transcript is never replaced by an automatic request.
 if p_gate is not null and (exists(select 1 from studio.studio_video_transcriptions where location_id=p_location and record_id=p_record and status in ('ready','partial','suggested'))
  or coalesce(btrim(rec.payload->>'transcript'),'')<>'') then return jsonb_build_object('status','skipped_existing','reused',true); end if;
 select x.device_id,x.reason into dev,why from studio.studio_video_pick_device(p_location,p_app,p_user) x;
 if dev is null then
  if p_raise then raise exception 'No ready Mac (%)',why using errcode=case why when 'no_mac' then 'VT001' when 'processing_off' then 'VT002' when 'transcription_off' then 'VT002' when 'companion_outdated' then 'VT004' else 'VT003' end; end if;
  insert into studio.studio_video_transcriptions(location_id,record_id,video_id,origin,actor_app,actor_id,request_key,status,gated,error_code,error_message,completed_at)
   values(p_location,p_record,vid,p_origin,p_app,p_user,p_request_key,'skipped',p_gate is not null,'video_'||why,'No ready Mac for automatic transcription ('||why||'). Use Transcribe on your Mac once Setup is ready.',clock_timestamp()) returning * into t;
  return jsonb_build_object('transcriptionId',t.id,'status','skipped','reason',why);
 end if;
 insert into studio.studio_video_transcriptions(location_id,record_id,video_id,origin,actor_app,actor_id,request_key,device_id,status,gated)
  values(p_location,p_record,vid,p_origin,p_app,p_user,p_request_key,dev,'queued',p_gate is not null) returning * into t;
 j:=studio.studio_enqueue_job(p_location,'studio.video_transcribe',jsonb_build_object('transcriptionId',t.id,'recordId',p_record,'videoId',vid,'url','https://www.youtube.com/watch?v='||vid,
   'origin',p_origin,'gate',p_gate,'limits',jsonb_build_object('maxSeconds',7200,'maxMediaMb',500,'maxFrames',120)),'video:'||p_request_key,p_user,3);
 update studio.studio_jobs set execution_target='device',device_id=dev where id=j.id;
 update studio.studio_video_transcriptions set job_id=j.id where location_id=p_location and id=t.id;
 return jsonb_build_object('transcriptionId',t.id,'status','queued','jobId',j.id);
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_enqueue_core(text,text,text,uuid,text,text,jsonb,boolean) FROM PUBLIC;

-- 4. User-triggered admission: pasted link, chosen search result, or confirming an earlier suggestion. Never gated, never paid.
CREATE FUNCTION studio.studio_enqueue_video_transcription(p_location_id text,p_actor_app text,p_clerk_user_id text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare origin text:=p_command->>'origin'; k text:=p_command->>'requestKey'; rec uuid;
begin
 if jsonb_typeof(p_command) is distinct from 'object' or origin is null or origin not in ('paste','search','suggestion') or k is null or k !~ '^[A-Za-z0-9:._-]{1,120}$'
  or coalesce(p_command->>'recordId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid transcription request' using errcode='22023'; end if;
 rec:=(p_command->>'recordId')::uuid;
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 -- Mac work is AI-manager scoped like every other subscription route; the Account's own paired Mac only.
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 perform pg_advisory_xact_lock(hashtextextended('video:'||p_location_id,0));
 if origin='suggestion' then
  update studio.studio_video_transcriptions set status='cancelled',error_code='superseded',error_message='Replaced by a confirmed request.',completed_at=clock_timestamp(),updated_at=clock_timestamp()
   where location_id=p_location_id and record_id=rec and status='suggested' and not exists(select 1 from studio.studio_video_transcriptions where location_id=p_location_id and request_key=k);
 end if;
 -- Re-pasting or re-selecting a source that already has a finished transcript never re-runs it; use the explicit confirm/re-run action.
 if origin in ('paste','search') and not exists(select 1 from studio.studio_video_transcriptions where location_id=p_location_id and request_key=k)
  and (exists(select 1 from studio.studio_video_transcriptions where location_id=p_location_id and record_id=rec and status in ('ready','partial'))
   or exists(select 1 from studio.studio_records x where x.location_id=p_location_id and x.id=rec and coalesce(btrim(x.payload->>'transcript'),'')<>'')) then
  return jsonb_build_object('status','skipped_existing','reused',true);
 end if;
 return studio.studio_video_enqueue_core(p_location_id,p_actor_app,p_clerk_user_id,rec,origin,k,null,true);
end $$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_video_transcription(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_video_transcription(text,text,text,jsonb) TO service_role;

-- 5. Discovery: approved-channel videos are gated (the Mac scores relevance first); other sources are suggestions only.
CREATE FUNCTION studio.studio_enqueue_discovered_video_transcriptions(p_location text,p_run uuid,p_job uuid,p_worker text,p_lease uuid,p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare run studio.studio_youtube_schedule_runs%rowtype; g studio.platform_youtube_schedule_authorizations%rowtype; link jsonb; v_out jsonb:='[]'; gate jsonb; rec uuid; vid text; r jsonb; sug studio.studio_video_transcriptions%rowtype; k text;
begin
 run:=studio.studio_lock_youtube_run(p_location,p_run,p_job,p_worker,p_lease);
 if run.result is null then raise exception 'Discovery result required' using errcode='22023'; end if;
 g:=studio.studio_lock_youtube_source(p_location,p_run);
 perform studio.studio_lock_ai_manager(p_location,g.app,g.clerk_user_id);
 perform pg_advisory_xact_lock(hashtextextended('video:'||p_location,0));
 gate:=studio.studio_video_gate(coalesce(p_context,'{}'::jsonb));
 for link in select value from jsonb_array_elements(coalesce(run.result->'links','[]'::jsonb)) limit 10 loop
  rec:=(link->>'recordId')::uuid; vid:=link->>'videoId'; k:='discovery:'||p_run::text||':'||vid;
  if vid is null or vid !~ '^[A-Za-z0-9_-]{11}$' or not exists(select 1 from studio.studio_records x where x.location_id=p_location and x.id=rec and x.kind='reference' and x.source_url='https://www.youtube.com/watch?v='||vid) then continue; end if;
  if g.source_mode='approved_channel' and exists(select 1 from studio.studio_youtube_channels where location_id=p_location and channel_id=g.channel_id) then
   r:=studio.studio_video_enqueue_core(p_location,g.app,g.clerk_user_id,rec,'approved_channel',k,gate,false);
  else
   -- Unapproved channels (search/subscription) are suggestions only: no job, no download.
   if exists(select 1 from studio.studio_video_transcriptions where location_id=p_location and request_key=k)
    or exists(select 1 from studio.studio_video_transcriptions where location_id=p_location and record_id=rec and status in ('queued','running','ready','partial','suggested'))
    or exists(select 1 from studio.studio_records x where x.location_id=p_location and x.id=rec and coalesce(btrim(x.payload->>'transcript'),'')<>'') then
    r:=jsonb_build_object('status','skipped_existing');
   else
    insert into studio.studio_video_transcriptions(location_id,record_id,video_id,origin,actor_app,actor_id,request_key,status,gated,error_code,error_message)
     values(p_location,rec,vid,'discovery_suggestion',g.app,g.clerk_user_id,k,'suggested',false,'channel_not_approved','Suggested only: this channel is not approved for automatic transcription.') returning * into sug;
    r:=jsonb_build_object('transcriptionId',sug.id,'status','suggested');
   end if;
  end if;
  v_out:=v_out||jsonb_build_array(r||jsonb_build_object('recordId',rec,'videoId',vid));
 end loop;
 return jsonb_build_object('videos',v_out);
end $$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_discovered_video_transcriptions(text,uuid,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_discovered_video_transcriptions(text,uuid,uuid,text,uuid,jsonb) TO service_role;

-- 6. Consent withdrawal: queued work cannot outlive the grant, the transcription toggle or revocation. Running work keeps its lease.
CREATE FUNCTION studio.studio_video_device_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.revoked_at is not null or not new.processing_enabled or new.desired_config#>>'{features,transcription}' is distinct from 'true' then
  update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),last_error_code='video_mac_settings_changed',last_error_message='Mac settings or authority changed. Transcribe again once Setup is ready.'
   where device_id=new.id and kind='studio.video_transcribe' and status='queued';
  update studio.studio_video_transcriptions set status='cancelled',error_code='video_mac_settings_changed',error_message='Mac settings or authority changed. Transcribe again once Setup is ready.',completed_at=clock_timestamp(),updated_at=clock_timestamp()
   where device_id=new.id and status='queued';
 end if; return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_device_release() FROM PUBLIC;
CREATE TRIGGER studio_video_device_release AFTER UPDATE OF revoked_at,processing_enabled,desired_config ON studio.studio_devices FOR EACH ROW EXECUTE FUNCTION studio.studio_video_device_release();

-- 7. Device protocol (outermost wrapper). Same identity, member, revocation and lease fences as studio_text_device_command.
CREATE FUNCTION studio.studio_video_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; t studio.studio_video_transcriptions%rowtype; v_result jsonb; gate jsonb; band text; auto numeric; review numeric;
 outcome text; v_rel jsonb; score numeric; n integer; chars bigint; segs bigint; text_out text; rec studio.studio_records%rowtype; applied boolean; frames_ok integer; sidecar uuid; unit_n integer; f record; v_final text; vis text; verr text; fr jsonb; idx integer; reserved jsonb:='[]'; ocr_count integer;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
 select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;

 if p_operation='claim' then
  if coalesce(p_body->>'leaseSeconds','') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 then raise exception 'Invalid lease' using errcode='22023'; end if;
  if exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then return '[]'::jsonb; end if;
  -- An abandoned (lease expired) transcription is safe to retry: it is local, idempotent and unmetered.
  for j in select * from studio.studio_jobs where device_id=d.id and kind='studio.video_transcribe' and status='running' and lease_expires_at<=clock_timestamp() for update skip locked loop
   insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id,error_code) values(j.id,j.location_id,j.attempts,'lease_expired',j.lease_owner,'worker_lease_expired');
   if j.attempts>=j.max_attempts then
    update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',last_error_message='The Mac stopped before finishing this transcription.',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
    update studio.studio_video_transcriptions set status='failed',error_code='worker_lease_expired',error_message='The Mac stopped before finishing this transcription.',completed_at=clock_timestamp(),updated_at=clock_timestamp() where job_id=j.id and status='running';
   else
    update studio.studio_jobs set status='queued',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',run_after=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
    update studio.studio_video_transcriptions set status='queued',error_code='worker_lease_expired',error_message='Retrying after the Mac stopped mid-job.',updated_at=clock_timestamp() where job_id=j.id and status='running';
   end if;
  end loop;
  update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),last_error_code='video_mac_settings_changed',last_error_message='Mac settings changed. Transcribe again once Setup is ready.'
   where device_id=d.id and kind='studio.video_transcribe' and status='queued' and (not d.processing_enabled or not 'studio.video_transcribe'=any(d.allowed_kinds) or d.desired_config#>>'{features,transcription}' is distinct from 'true');
  update studio.studio_video_transcriptions x set status='cancelled',error_code='video_mac_settings_changed',error_message='Mac settings changed. Transcribe again once Setup is ready.',completed_at=clock_timestamp(),updated_at=clock_timestamp()
   where x.device_id=d.id and x.status='queued' and exists(select 1 from studio.studio_jobs y where y.id=x.job_id and y.status='cancelled');
  if not d.paused and d.processing_enabled and 'studio.video_transcribe'=any(d.allowed_kinds) and d.desired_config#>>'{features,transcription}'='true'
   and d.config_version=d.applied_config_version and d.config_status='applied' and p_body->>'videoReady'='true' then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind='studio.video_transcribe' and execution_target='device' and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
    update studio.studio_video_transcriptions set status='running',error_code=null,error_message=null,updated_at=clock_timestamp() where job_id=j.id and status='queued';
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
  return studio.studio_text_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
 end if;

 if p_operation in ('extend','complete','fail','video_transcript_chunk','video_frames_reserve','video_frames_verify') then
  select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and execution_target='device' and kind='studio.video_transcribe' for update;
  if not found then
   if p_operation in ('video_transcript_chunk','video_frames_reserve','video_frames_verify') then raise exception 'Current video lease required' using errcode='40001'; end if;
   return studio.studio_text_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
  end if;
  if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then
   if p_operation in ('video_transcript_chunk','video_frames_reserve','video_frames_verify') then raise exception 'Current video lease required' using errcode='40001'; end if;
   return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end;
  end if;
  select * into t from studio.studio_video_transcriptions where location_id=d.location_id and id=(j.payload->>'transcriptionId')::uuid and job_id=j.id for update;
  if not found then raise exception 'Transcription missing' using errcode='22023'; end if;
  if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;

  if p_operation='video_transcript_chunk' then
   if coalesce(p_body->>'chunkIndex','') !~ '^[0-9]{1,2}$' or (p_body->>'chunkIndex')::integer>79 or jsonb_typeof(p_body->'segments') is distinct from 'array' or jsonb_array_length(p_body->'segments') not between 1 and 400
    or octet_length((p_body->'segments')::text)>26000 then raise exception 'Invalid transcript chunk' using errcode='22023'; end if;
   if exists(select 1 from jsonb_array_elements(p_body->'segments') s where jsonb_typeof(s) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(s) kk where kk not in ('start','end','text'))
     or jsonb_typeof(s->'start') is distinct from 'number' or jsonb_typeof(s->'end') is distinct from 'number' or jsonb_typeof(s->'text') is distinct from 'string'
     or (s->>'start')::numeric not between 0 and 7300 or (s->>'end')::numeric not between (s->>'start')::numeric and 7300
     or char_length(btrim(s->>'text')) not between 1 and 2000) then raise exception 'Invalid transcript segment' using errcode='22023'; end if;
   insert into studio.studio_video_transcript_chunks(location_id,transcription_id,chunk_index,segments) values(d.location_id,t.id,(p_body->>'chunkIndex')::integer,p_body->'segments')
    on conflict (location_id,transcription_id,chunk_index) do update set segments=excluded.segments;
   return 'true'::jsonb;
  end if;

  if p_operation='video_frames_reserve' then
   if jsonb_typeof(p_body->'frames') is distinct from 'array' or jsonb_array_length(p_body->'frames') not between 1 and 40 then raise exception 'Invalid frames' using errcode='22023'; end if;
   if (select count(*) from studio.studio_video_frames where location_id=d.location_id and transcription_id=t.id)+jsonb_array_length(p_body->'frames')>200 then raise exception 'Too many frames' using errcode='22023'; end if;
   for fr in select value from jsonb_array_elements(p_body->'frames') loop
    if jsonb_typeof(fr) is distinct from 'object' or exists(select 1 from jsonb_object_keys(fr) kk where kk not in ('index','timeSeconds','sceneStart','sceneEnd','ocr','audioContext','selection','sha256','byteSize'))
     or coalesce(fr->>'index','') !~ '^[0-9]{1,3}$' or (fr->>'index')::integer>199
     or jsonb_typeof(fr->'timeSeconds') is distinct from 'number' or jsonb_typeof(fr->'sceneStart') is distinct from 'number' or jsonb_typeof(fr->'sceneEnd') is distinct from 'number'
     or jsonb_typeof(fr->'ocr') is distinct from 'string' or jsonb_typeof(fr->'audioContext') is distinct from 'string' or char_length(fr->>'ocr')>1200 or char_length(fr->>'audioContext')>1000
     or coalesce(fr->>'selection','') !~ '^[a-z][a-z0-9-]{0,39}$' or coalesce(fr->>'sha256','') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(fr->'byteSize') is distinct from 'number' or (fr->>'byteSize')::numeric<>trunc((fr->>'byteSize')::numeric) or (fr->>'byteSize')::numeric not between 1 and 1572864 then raise exception 'Invalid frame' using errcode='22023'; end if;
    idx:=(fr->>'index')::integer;
    select * into f from studio.studio_video_frames where location_id=d.location_id and transcription_id=t.id and frame_index=idx for update;
    if found and f.status='verified' then
     if f.sha256<>fr->>'sha256' then raise exception 'Frame already bound to different bytes' using errcode='23505'; end if;
    elsif found then
     update studio.studio_video_frames set time_seconds=(fr->>'timeSeconds')::numeric,scene_start=(fr->>'sceneStart')::numeric,scene_end=(fr->>'sceneEnd')::numeric,ocr_text=fr->>'ocr',audio_context=fr->>'audioContext',
      selection=fr->>'selection',sha256=fr->>'sha256',byte_size=(fr->>'byteSize')::bigint,object_key=d.location_id||'/video-frames/'||t.id::text||'/'||idx::text||'-'||(fr->>'sha256')||'.jpg'
      where location_id=d.location_id and transcription_id=t.id and frame_index=idx;
    else
     insert into studio.studio_video_frames(location_id,transcription_id,frame_index,time_seconds,scene_start,scene_end,ocr_text,audio_context,selection,sha256,byte_size,content_type,object_key,status)
      values(d.location_id,t.id,idx,(fr->>'timeSeconds')::numeric,(fr->>'sceneStart')::numeric,(fr->>'sceneEnd')::numeric,fr->>'ocr',fr->>'audioContext',fr->>'selection',fr->>'sha256',(fr->>'byteSize')::bigint,'image/jpeg',
       d.location_id||'/video-frames/'||t.id::text||'/'||idx::text||'-'||(fr->>'sha256')||'.jpg','pending');
    end if;
    select * into f from studio.studio_video_frames where location_id=d.location_id and transcription_id=t.id and frame_index=idx;
    reserved:=reserved||jsonb_build_array(jsonb_build_object('index',idx,'objectKey',f.object_key,'status',f.status,'byteSize',f.byte_size,'sha256',f.sha256));
   end loop;
   return reserved;
  end if;

  if p_operation='video_frames_verify' then
   -- Phase 1 (no observation): list the reserved frames the server must read back. Phase 2: bind what the SERVER observed in private R2.
   if p_observed is null then
    if jsonb_typeof(p_body->'indexes') is distinct from 'array' or jsonb_array_length(p_body->'indexes') not between 1 and 20 then raise exception 'Invalid frame indexes' using errcode='22023'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('index',x.frame_index,'objectKey',x.object_key,'sha256',x.sha256,'byteSize',x.byte_size) order by x.frame_index)
     from studio.studio_video_frames x where x.location_id=d.location_id and x.transcription_id=t.id and x.status='pending'
      and x.frame_index in (select (i#>>'{}')::integer from jsonb_array_elements(p_body->'indexes') i)),'[]'::jsonb);
   end if;
   if jsonb_typeof(p_observed) is distinct from 'object' or coalesce(p_observed->>'bucket','') !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' or jsonb_typeof(p_observed->'frames') is distinct from 'array' then raise exception 'Invalid observation' using errcode='22023'; end if;
   for fr in select value from jsonb_array_elements(p_observed->'frames') loop
    idx:=(fr->>'index')::integer;
    select * into f from studio.studio_video_frames where location_id=d.location_id and transcription_id=t.id and frame_index=idx for update;
    if not found or f.sha256 is distinct from fr->>'sha256' or f.byte_size is distinct from (fr->>'byteSize')::bigint then raise exception 'Frame bytes do not match the reservation' using errcode='22023'; end if;
    if f.status='pending' then
     declare m uuid; begin
      insert into studio.studio_media_objects(location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
       values(d.location_id,p_observed->>'bucket',f.object_key,'frame-'||lpad(idx::text,5,'0')||'.jpg','image/jpeg',f.byte_size,f.sha256,d.created_by)
       on conflict (bucket_id,object_key) do update set byte_size=excluded.byte_size returning id into m;
      update studio.studio_video_frames set status='verified',bucket_id=p_observed->>'bucket',media_object_id=m where location_id=d.location_id and transcription_id=t.id and frame_index=idx;
     end;
    end if;
   end loop;
   return to_jsonb((select count(*) from studio.studio_video_frames where location_id=d.location_id and transcription_id=t.id and status='verified'));
  end if;

  if p_operation='fail' then
   -- Waits that happen before any media work do not consume an attempt. Other failures retry only when the Mac says they are transient.
   if p_body#>>'{failure,retryable}'='true' and p_body#>>'{failure,code}' in ('video_tools_missing','local_policy','video_network','video_provider_waiting') then
    if p_body#>>'{failure,code}' in ('video_tools_missing','local_policy','video_provider_waiting') then update studio.studio_jobs set attempts=greatest(0,attempts-1) where id=j.id; end if;
    v_result:=to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,p_body#>>'{failure,code}',p_body#>>'{failure,message}',true,coalesce(nullif(p_body#>>'{failure,retryAfterSeconds}','')::integer,300)));
    update studio.studio_video_transcriptions set status=case when v_result='"retry_scheduled"'::jsonb then 'queued' else 'failed' end,error_code=p_body#>>'{failure,code}',error_message=left(p_body#>>'{failure,message}',300),updated_at=clock_timestamp(),
     completed_at=case when v_result='"retry_scheduled"'::jsonb then null else clock_timestamp() end where location_id=t.location_id and id=t.id;
    return v_result;
   end if;
   v_result:=to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,p_body#>>'{failure,code}',p_body#>>'{failure,message}',false,null));
   update studio.studio_video_transcriptions set status='failed',error_code=p_body#>>'{failure,code}',error_message=left(p_body#>>'{failure,message}',300),completed_at=clock_timestamp(),updated_at=clock_timestamp() where location_id=t.location_id and id=t.id;
   return v_result;
  end if;

  -- complete
  v_result:=p_body->'result';
  if jsonb_typeof(v_result) is distinct from 'object' or octet_length(v_result::text)>8192 or exists(select 1 from jsonb_object_keys(v_result) kk where kk not in ('outcome','relevance','method','language','durationSeconds','transcript','visual'))
   or coalesce(v_result->>'outcome','') not in ('transcribed','relevance_review','relevance_skipped') then raise exception 'Invalid video result' using errcode='22023'; end if;
  outcome:=v_result->>'outcome'; gate:=j.payload->'gate';
  if jsonb_typeof(gate)='object' then
   v_rel:=v_result->'relevance';
   if jsonb_typeof(v_rel) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_rel) kk where kk not in ('relevant','score','reason','matches'))
    or jsonb_typeof(v_rel->'relevant') is distinct from 'boolean' or jsonb_typeof(v_rel->'score') is distinct from 'number' or (v_rel->>'score')::numeric not between 0 and 100
    or jsonb_typeof(v_rel->'reason') is distinct from 'string' or char_length(v_rel->>'reason') not between 1 and 600
    or jsonb_typeof(v_rel->'matches') is distinct from 'array' or jsonb_array_length(v_rel->'matches')>5
    or exists(select 1 from jsonb_array_elements(v_rel->'matches') m where jsonb_typeof(m) is distinct from 'string' or char_length(m#>>'{}')>200) then raise exception 'Invalid relevance' using errcode='22023'; end if;
   score:=(v_rel->>'score')::numeric; auto:=(gate#>>'{thresholds,auto}')::numeric; review:=(gate#>>'{thresholds,review}')::numeric;
   band:=case when score>=auto and (v_rel->>'relevant')::boolean then 'high' when score>=review then 'review' else 'skip' end;
   v_rel:=v_rel||jsonb_build_object('band',band);
   if (outcome='transcribed' and band<>'high') or (outcome='relevance_review' and band<>'review') or (outcome='relevance_skipped' and band<>'skip') then raise exception 'Relevance outcome does not match the pinned thresholds' using errcode='22023'; end if;
   if outcome<>'transcribed' then
    update studio.studio_video_transcriptions set status=case when outcome='relevance_review' then 'suggested' else 'skipped' end,relevance=v_rel,error_code=case when outcome='relevance_review' then 'relevance_borderline' else 'relevance_low' end,
     error_message=case when outcome='relevance_review' then 'Borderline relevance: confirm to transcribe on your Mac.' else 'Skipped: low relevance to your Library and profile.' end,completed_at=clock_timestamp(),updated_at=clock_timestamp() where location_id=t.location_id and id=t.id;
    return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,jsonb_build_object('transcriptionId',t.id,'status',outcome)));
   end if;
  elsif outcome<>'transcribed' or v_result ? 'relevance' then raise exception 'Relevance results are only valid for gated jobs' using errcode='22023'; end if;
  -- Transcript: contiguous chunks matching the declared counts.
  if jsonb_typeof(v_result->'transcript') is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_result->'transcript') kk where kk not in ('chunks','segments'))
   or coalesce(v_result#>>'{transcript,chunks}','') !~ '^[0-9]{1,2}$' or coalesce(v_result#>>'{transcript,segments}','') !~ '^[0-9]{1,6}$'
   or coalesce(v_result->>'method','') not in ('local-parakeet-tdt-v3-4bit','youtube-captions-fallback') or (v_result ? 'language' and coalesce(v_result->>'language','') !~ '^[a-z]{2,12}$')
   or jsonb_typeof(v_result->'durationSeconds') is distinct from 'number' or (v_result->>'durationSeconds')::numeric not between 0 and 7300
   or jsonb_typeof(v_result->'visual') is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_result->'visual') kk where kk not in ('status','error','frames'))
   or coalesce(v_result#>>'{visual,status}','') not in ('ready','failed') then raise exception 'Invalid transcript result' using errcode='22023'; end if;
  n:=(v_result#>>'{transcript,chunks}')::integer;
  select count(*),coalesce(sum(jsonb_array_length(segments)),0),min(chunk_index),max(chunk_index) into frames_ok,segs,idx,unit_n from studio.studio_video_transcript_chunks where location_id=t.location_id and transcription_id=t.id and chunk_index<n;
  if n<1 or frames_ok<>n or idx<>0 or unit_n<>n-1 or segs<>(v_result#>>'{transcript,segments}')::bigint
   then raise exception 'Transcript chunks do not match the declared result' using errcode='22023'; end if;
  delete from studio.studio_video_transcript_chunks where location_id=t.location_id and transcription_id=t.id and chunk_index>=n;
  select string_agg('['||lpad((floor((s.v->>'start')::numeric/3600))::text,2,'0')||':'||lpad((floor(((s.v->>'start')::numeric%3600)/60))::text,2,'0')||':'||lpad((floor((s.v->>'start')::numeric%60))::text,2,'0')||'] '||btrim(s.v->>'text'),E'\n' order by c.chunk_index,s.o)
   into text_out from studio.studio_video_transcript_chunks c cross join lateral jsonb_array_elements(c.segments) with ordinality as s(v,o) where c.location_id=t.location_id and c.transcription_id=t.id;
  chars:=char_length(coalesce(text_out,''));
  if chars=0 or chars>400000 then raise exception 'Transcript text outside bounds' using errcode='22023'; end if;
  -- Frames: only verified rows survive. A failed visual pass keeps the transcript and reports partial.
  vis:=v_result#>>'{visual,status}'; verr:=left(coalesce(v_result#>>'{visual,error}',''),300);
  delete from studio.studio_video_frames where location_id=t.location_id and transcription_id=t.id and status<>'verified';
  select count(*) into frames_ok from studio.studio_video_frames where location_id=t.location_id and transcription_id=t.id;
  if vis='ready' and (coalesce(v_result#>>'{visual,frames}','') !~ '^[0-9]{1,3}$' or (v_result#>>'{visual,frames}')::integer<>frames_ok) then raise exception 'Verified frames do not match the declared result' using errcode='22023'; end if;
  if vis='failed' then
   -- Drop unusable pictures so a partial result never exposes half-verified evidence.
   delete from studio.studio_video_frames where location_id=t.location_id and transcription_id=t.id; frames_ok:=0;
  end if;
  -- Save the timestamped transcript on the source unless a human transcript is already there.
  select * into rec from studio.studio_records where location_id=t.location_id and id=t.record_id for update;
  applied:=coalesce(found and not rec.archived and (coalesce(btrim(rec.payload->>'transcript'),'')='' or coalesce(rec.payload->>'transcriptOrigin','')='mac_local'),false);
  if applied then
   update studio.studio_records set payload=payload||jsonb_strip_nulls(jsonb_build_object('transcript',text_out,'transcriptOrigin','mac_local','transcriptMethod',v_result->>'method','transcriptLanguage',v_result->>'language','transcriptAt',clock_timestamp(),'transcriptionId',t.id)),
    version=version+1,updated_at=clock_timestamp() where location_id=t.location_id and id=t.record_id;
  end if;
  -- OCR text becomes citable source units for knowledge extraction.
  select count(*) into ocr_count from studio.studio_video_frames where location_id=t.location_id and transcription_id=t.id and btrim(ocr_text)<>'';
  if ocr_count>0 then
   insert into studio.studio_knowledge_sources(location_id,id,payload,total_units,covered_units) values(t.location_id,t.record_id,'{"origin":"video_transcription"}',0,0) on conflict (location_id,id) do nothing;
   delete from studio.studio_knowledge_source_unit_sidecars where location_id=t.location_id and source_id=t.record_id and transcription_id=t.id::text;
   sidecar:=gen_random_uuid();
   insert into studio.studio_knowledge_source_unit_sidecars(location_id,id,source_id,transcription_id,payload) values(t.location_id,sidecar,t.record_id,t.id::text,jsonb_build_object('origin','slide_ocr','videoId',t.video_id));
   unit_n:=0;
   for f in select * from studio.studio_video_frames where location_id=t.location_id and transcription_id=t.id and btrim(ocr_text)<>'' order by time_seconds,frame_index loop
    insert into studio.studio_knowledge_source_units(location_id,id,sidecar_id,source_id,transcription_id,unit_index,payload)
     values(t.location_id,gen_random_uuid(),sidecar,t.record_id,t.id::text,unit_n,jsonb_build_object('unit',jsonb_build_object('text',btrim(f.ocr_text),'start',f.scene_start,'end',f.scene_end,'time',f.time_seconds,'kind','slide_ocr','frameFile','frame-'||lpad(f.frame_index::text,5,'0')||'.jpg','frameIndex',f.frame_index)));
    unit_n:=unit_n+1;
   end loop;
  end if;
  v_final:=case when vis='ready' then 'ready' else 'partial' end;
  update studio.studio_video_transcriptions set status=v_final,relevance=case when jsonb_typeof(gate)='object' then v_rel else null end,method=v_result->>'method',language=v_result->>'language',duration_seconds=(v_result->>'durationSeconds')::numeric,
   segment_count=segs,transcript_chars=chars,transcript_applied=applied,visual_status=vis,visual_error=nullif(verr,''),frame_count=frames_ok,error_code=case when vis='failed' then 'video_visual_failed' end,
   error_message=case when vis='failed' then coalesce(nullif(verr,''),'Slides and frames could not be extracted; the transcript is saved.') end,completed_at=clock_timestamp(),updated_at=clock_timestamp() where location_id=t.location_id and id=t.id;
  return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,jsonb_build_object('transcriptionId',t.id,'status',v_final)));
 end if;
 return studio.studio_text_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_device_command(text,text,text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_video_device_command(text,text,text,jsonb,text,jsonb) TO service_role;

COMMIT;
