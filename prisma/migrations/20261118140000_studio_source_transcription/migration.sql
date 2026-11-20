BEGIN;
-- Additive: a paired Mac may transcribe a saved YouTube source (yt-dlp + local Parakeet, caption fallback, OCR of scene states).
ALTER TABLE studio.studio_devices DROP CONSTRAINT studio_devices_allowed_kinds_check;
ALTER TABLE studio.studio_devices ADD CONSTRAINT studio_devices_allowed_kinds_check CHECK (
 'studio.diagnostic'=any(allowed_kinds) AND allowed_kinds <@ ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.source_transcribe']::text[]);
CREATE OR REPLACE FUNCTION studio.studio_device_allowed_kinds_sync() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
begin
 if tg_op='INSERT' or new.processing_enabled is distinct from old.processing_enabled then
  new.allowed_kinds:=case when new.processing_enabled then ARRAY['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.source_transcribe']::text[] else ARRAY['studio.diagnostic']::text[] end;
 end if; return new;
end $$;
UPDATE studio.studio_devices SET allowed_kinds=array_append(allowed_kinds,'studio.source_transcribe') WHERE processing_enabled AND NOT 'studio.source_transcribe'=any(allowed_kinds);

-- Record the outcome on the source itself so every page and later workflow reads one place.
CREATE FUNCTION studio.studio_source_transcription_mark(p_location text,p_record uuid,p_status text,p_message text DEFAULT NULL,p_extra jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE sql SET search_path='' AS $$
 update studio.studio_records set payload=(payload - 'transcriptionMessage') || jsonb_build_object('transcriptionStatus',p_status) || case when p_message is null then '{}'::jsonb else jsonb_build_object('transcriptionMessage',left(p_message,300)) end || p_extra
 where location_id=p_location and id=p_record;
$$;
REVOKE ALL ON FUNCTION studio.studio_source_transcription_mark(text,uuid,text,text,jsonb) FROM PUBLIC;

-- trigger 'user' = pasted/saved/retried by a person (always transcribes). 'discovery' = an approved-channel find: the Mac first asks
-- the owner's text subscription whether it is relevant, and only a high score proceeds without confirmation.
CREATE FUNCTION studio.studio_request_source_transcription(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid,p_trigger text DEFAULT 'user') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare r studio.studio_records%rowtype; d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; jp jsonb; n integer; appr jsonb;
begin
 if p_trigger not in ('user','discovery') then raise exception 'Invalid trigger' using errcode='22023'; end if;
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 select * into r from studio.studio_records where location_id=p_location_id and id=p_record_id and kind='reference' and not archived for update;
 if not found then raise exception 'Source unavailable' using errcode='22023'; end if;
 if coalesce(r.payload->>'url','') !~* '^https?://([a-z0-9-]+\.)?(youtube\.com/(watch|shorts|live|embed)|youtu\.be/)' then
  return jsonb_build_object('status','unsupported');
 end if;
 select * into j from studio.studio_jobs where location_id=p_location_id and kind='studio.source_transcribe' and payload->>'recordId'=r.id::text and status in ('queued','running') order by created_at desc limit 1;
 if found then return jsonb_build_object('status',case when j.status='running' then 'running' else 'queued' end,'jobId',j.id); end if;
 if p_trigger='discovery' and length(btrim(coalesce(r.payload->>'transcript','')))>0 then return jsonb_build_object('status','has_transcript'); end if;
 select * into d from studio.studio_devices where location_id=p_location_id and app=p_actor_app and created_by=p_clerk_user_id and revoked_at is null and processing_enabled
  and 'studio.source_transcribe'=any(allowed_kinds) order by seen_at desc nulls last,created_at desc limit 1 for update;
 if not found then
  perform studio.studio_source_transcription_mark(p_location_id,r.id,'no_device','Pair a Mac and turn Transcription on in Mac Setup, then request it again.');
  return jsonb_build_object('status','no_device');
 end if;
 select count(*) into n from studio.studio_jobs where location_id=p_location_id and kind='studio.source_transcribe' and payload->>'recordId'=r.id::text;
 jp:=jsonb_build_object('recordId',r.id,'recordVersion',r.version,'url',r.payload->>'url','trigger',p_trigger);
 if p_trigger='discovery' then
  select coalesce(jsonb_agg(jsonb_build_object('title',left(a.title,300),'summary',left(coalesce(a.payload->>'aiSummary',a.payload->>'summary',''),600))),'[]'::jsonb) into appr
   from (select title,payload from studio.studio_records where location_id=p_location_id and kind='reference' and approved and not archived and id<>r.id order by updated_at desc limit 25) a;
  jp:=jp||jsonb_build_object('gate',jsonb_build_object('title',left(r.title,300),'description',left(coalesce(r.payload->>'description',''),4000),'channel',left(coalesce(r.payload->>'channelName',''),200),'approved',appr));
 end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.source_transcribe',jp,'source-transcribe:'||r.id||':'||n,p_clerk_user_id,3);
 if j.device_id is null and j.status='queued' and j.attempts=0 then
  update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j;
 end if;
 perform studio.studio_source_transcription_mark(p_location_id,r.id,'queued','Waiting for your Mac to pick this up.',jsonb_build_object('transcriptionJobId',j.id,'transcriptionTrigger',p_trigger));
 return jsonb_build_object('status','queued','jobId',j.id);
end $$;
REVOKE ALL ON FUNCTION studio.studio_request_source_transcription(text,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_source_transcription(text,text,text,uuid,text) TO service_role;

-- Outermost device entry point. Video transcription is claimed only one-at-a-time per Mac, then everything else goes to the text wrapper.
CREATE FUNCTION studio.studio_transcribe_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; r studio.studio_records%rowtype; res jsonb; src jsonb; ok boolean; decision text; human boolean; extra jsonb; retry boolean; code text;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
 select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>(select case when p_operation='complete' then 307200 else 32768 end) or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 if p_operation='claim' then
  if coalesce(p_body->>'leaseSeconds','') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 or octet_length(p_body::text)>32768 then raise exception 'Invalid lease' using errcode='22023'; end if;
  if not d.paused and d.processing_enabled and 'studio.source_transcribe'=any(d.allowed_kinds) and d.desired_config#>>'{features,transcription}'='true'
   and d.config_version=d.applied_config_version and d.config_status='applied' and p_body->>'transcribeReady'='true'
   and not exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind='studio.source_transcribe'
    and execution_target='device' and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    perform studio.studio_source_transcription_mark(j.location_id,(j.payload->>'recordId')::uuid,'running',case when j.payload->>'trigger'='discovery' then 'Checking relevance, then transcribing on your Mac.' else 'Transcribing on your Mac.' end);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
 elsif p_operation in ('extend','complete','fail') then
  select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and execution_target='device' and kind='studio.source_transcribe' for update;
  if found then
   if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end; end if;
   if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
   if p_operation='complete' then
    res:=p_body->'result'; src:=res->'source';
    if jsonb_typeof(res) is distinct from 'object' or jsonb_typeof(src) is distinct from 'object' or exists(select 1 from jsonb_each(res) e where e.key not in ('source','provider','model'))
     or res->>'provider' is distinct from 'mac_local' or res->>'model' is distinct from 'native-default'
     or exists(select 1 from jsonb_each(src) e where e.key not in ('decision','score','reason','method','text','timedText','visualNotes','durationSeconds','language','truncated','frameCount'))
     or src->>'decision' not in ('transcribed','skipped','needs_confirmation')
     or (src ? 'reason' and (jsonb_typeof(src->'reason')<>'string' or length(src->>'reason')>600))
     or (src ? 'score' and (jsonb_typeof(src->'score')<>'number' or (src->>'score')::numeric not between 0 and 100)) then
     raise exception 'Invalid source result' using errcode='22023';
    end if;
    decision:=src->>'decision';
    if decision='transcribed' and (src->>'method' not in ('local-parakeet-tdt-v3','youtube-captions-fallback') or jsonb_typeof(src->'text')<>'string' or length(btrim(src->>'text')) not between 1 and 100000
     or (src ? 'timedText' and (jsonb_typeof(src->'timedText')<>'string' or length(src->>'timedText')>150000)) or (src ? 'visualNotes' and (jsonb_typeof(src->'visualNotes')<>'string' or length(src->>'visualNotes')>20000))) then
     raise exception 'Invalid transcript' using errcode='22023';
    end if;
    select * into r from studio.studio_records where location_id=j.location_id and id=(j.payload->>'recordId')::uuid for update;
    ok:=studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,jsonb_build_object('decision',decision,'chars',length(coalesce(src->>'text','')),'method',src->>'method'));
    if ok and found and not r.archived then
     extra:=case when src ? 'score' then jsonb_build_object('relevanceScore',src->'score','relevanceReason',coalesce(src->'reason','null'::jsonb)) else '{}'::jsonb end;
     if decision='transcribed' then
      -- Never overwrite words a person typed or pasted; keep the machine transcript beside them instead.
      human:=length(btrim(coalesce(r.payload->>'transcript','')))>0 and (not (r.payload ? 'transcriptSource') or md5(r.payload->>'transcript') is distinct from r.payload#>>'{transcriptSource,md5}');
      if human then
       update studio.studio_records set payload=(payload - 'transcriptionMessage') || extra || jsonb_build_object('transcriptionStatus','kept_existing','transcriptionMessage','A saved transcript already exists, so the Mac transcript was kept separately.',
        'machineTranscript',src->>'text','machineTranscriptMethod',src->>'method') ,version=version+1,updated_at=clock_timestamp() where location_id=r.location_id and id=r.id;
      else
       update studio.studio_records set payload=(payload - 'transcriptionMessage' - 'machineTranscript') || extra || jsonb_build_object('transcriptionStatus','ready','transcript',src->>'text',
        'transcriptSource',jsonb_build_object('md5',md5(src->>'text'),'method',src->>'method','jobId',j.id,'at',clock_timestamp(),'durationSeconds',src->'durationSeconds','language',src->'language','truncated',coalesce(src->'truncated','false'::jsonb)))
        || case when src ? 'timedText' then jsonb_build_object('timedTranscript',src->>'timedText') else '{}'::jsonb end
        || case when src ? 'visualNotes' then jsonb_build_object('visualNotes',src->>'visualNotes') else '{}'::jsonb end,version=version+1,updated_at=clock_timestamp() where location_id=r.location_id and id=r.id;
       -- The summary reads the saved transcript; request a fresh one in the same transaction, best effort.
       begin perform studio.studio_request_library_summary(r.location_id,d.app,d.created_by,r.id); exception when others then null; end;
      end if;
     elsif decision='skipped' then
      perform studio.studio_source_transcription_mark(r.location_id,r.id,'skipped','Not transcribed: the relevance check scored this below the threshold.',extra);
     else
      perform studio.studio_source_transcription_mark(r.location_id,r.id,'needs_confirmation','Possibly relevant. Choose Transcribe to run it on your Mac.',extra);
     end if;
    end if;
    return to_jsonb(ok);
   end if;
   -- Only waits before any download/transcription may retry; every other failure is terminal and visible on the source.
   code:=p_body#>>'{failure,code}'; retry:=code in ('subscription_capacity','local_policy','transcription_tools_missing') and p_body#>>'{failure,retryable}'='true';
   if retry then update studio.studio_jobs set attempts=greatest(0,attempts-1) where id=j.id; end if;
   res:=to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,code,p_body#>>'{failure,message}',retry,case when retry then coalesce((p_body#>>'{failure,retryAfterSeconds}')::integer,300) else null end));
   perform studio.studio_source_transcription_mark(j.location_id,(j.payload->>'recordId')::uuid,case when res='"retry_scheduled"'::jsonb then 'waiting_for_device' else 'failed' end,left(coalesce(p_body#>>'{failure,message}','Transcription failed.'),300));
   return res;
  end if;
 end if;
 if octet_length(p_body::text)>32768 then raise exception 'Invalid command' using errcode='22023'; end if;
 return studio.studio_text_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by);
end $$;
REVOKE ALL ON FUNCTION studio.studio_transcribe_device_command(text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_transcribe_device_command(text,text,text,jsonb,text) TO service_role;

-- Queued transcription never waits forever for a Mac that was revoked or stopped processing.
CREATE FUNCTION studio.studio_device_source_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare q record;
begin
 if (new.revoked_at is not null and old.revoked_at is null) or (old.processing_enabled and not new.processing_enabled) then
  for q in update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),updated_at=clock_timestamp(),last_error_code='device_unavailable',
    last_error_message='The Mac stopped accepting transcription. Request it again to use another connection.'
    where device_id=new.id and kind='studio.source_transcribe' and status='queued' returning location_id,payload loop
   perform studio.studio_source_transcription_mark(q.location_id,(q.payload->>'recordId')::uuid,'no_device','The Mac stopped accepting transcription. Request it again.');
  end loop;
 end if;
 return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_device_source_release() FROM PUBLIC;
CREATE TRIGGER studio_device_source_release AFTER UPDATE OF revoked_at,processing_enabled ON studio.studio_devices FOR EACH ROW EXECUTE FUNCTION studio.studio_device_source_release();
-- Scheduled discovery already saves each find as a bookmarked source. A find from an APPROVED channel (the run's own channel is on the
-- Location's approved list) is handed to the owner's Mac with the relevance gate; search results and unapproved subscriptions are not.
-- Best effort: it can never fail or delay the discovery run itself.
CREATE FUNCTION studio.studio_discovery_source_transcription() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare l jsonb;
begin
 if old.result is null and new.result is not null and not new.manual and new.source_mode in ('approved_channel','subscription') and new.channel_id is not null
  and exists(select 1 from studio.studio_youtube_channels c where c.location_id=new.location_id and c.channel_id=new.channel_id) then
  for l in select e from jsonb_array_elements(coalesce(new.result->'links','[]'::jsonb)) e where e->>'reused'='false' loop
   begin perform studio.studio_request_source_transcription(new.location_id,new.actor_app,new.created_by_clerk_user_id,(l->>'recordId')::uuid,'discovery');
   exception when others then null; end;
  end loop;
 end if;
 return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_discovery_source_transcription() FROM PUBLIC;
CREATE TRIGGER studio_youtube_source_discovery AFTER UPDATE OF result ON studio.studio_youtube_schedule_runs FOR EACH ROW EXECUTE FUNCTION studio.studio_discovery_source_transcription();
COMMIT;
