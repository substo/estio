-- A source review groups bounded jobs executed by the existing Studio text routes.
CREATE TABLE studio.studio_knowledge_outlines (
  location_id text NOT NULL REFERENCES public."Location"(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  actor_app text NOT NULL,
  actor_id text NOT NULL,
  source_id uuid NOT NULL,
  source_version bigint NOT NULL,
  source_snapshot jsonb NOT NULL,
  input_mode text NOT NULL,
  input_id text NOT NULL,
  fingerprint text NOT NULL,
  request jsonb NOT NULL,
  plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (location_id,id),
  UNIQUE (location_id,request_id)
);
CREATE INDEX studio_knowledge_outlines_source_idx ON studio.studio_knowledge_outlines(location_id,source_id,created_at DESC);
CREATE INDEX studio_knowledge_outline_batches_idx ON studio.studio_idea_reviews(location_id,(snapshot->>'inputId'))
  WHERE workflow='knowledge_extract' AND snapshot->>'mode'='outline';

CREATE TABLE studio.studio_knowledge_outline_annotations (
  location_id text NOT NULL,
  outline_id uuid NOT NULL,
  node_key text NOT NULL,
  version bigint NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (location_id,outline_id,node_key),
  FOREIGN KEY (location_id,outline_id) REFERENCES studio.studio_knowledge_outlines(location_id,id) ON DELETE CASCADE
);
CREATE TABLE studio.studio_knowledge_outline_commands (
  location_id text NOT NULL,
  request_id uuid NOT NULL,
  outline_id uuid NOT NULL,
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (location_id,request_id),
  FOREIGN KEY (location_id,outline_id) REFERENCES studio.studio_knowledge_outlines(location_id,id) ON DELETE CASCADE
);
ALTER TABLE studio.studio_knowledge_outlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.studio_knowledge_outline_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.studio_knowledge_outline_commands ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON studio.studio_knowledge_outlines TO service_role;

-- The record evidence envelope is optional. Its digest must identify the saved transcript
-- verbatim so stale timings or OCR cannot be attached to a manually edited transcript.
CREATE FUNCTION studio.studio_outline_input(p_location text,p_source uuid,p_version bigint,p_mode text,p_input text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r studio.studio_records%rowtype; t studio.studio_transcripts%rowtype;
  body text; mac_body text; speech jsonb; frames jsonb; visual jsonb; units jsonb;
BEGIN
  SELECT * INTO r FROM studio.studio_records WHERE location_id=p_location AND id=p_source FOR SHARE;
  IF NOT FOUND OR (p_version IS NOT NULL AND r.version<>p_version) OR r.archived OR r.kind NOT IN ('reference','content') THEN
    RAISE EXCEPTION 'Source changed or unavailable' USING ERRCODE='40001';
  END IF;
  IF char_length(r.source_url)>2000 OR p_input IS NULL OR char_length(p_input) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid evidence identity' USING ERRCODE='22023';
  END IF;

  IF p_mode='record_text' AND p_input IN ('transcript','script','notes') AND jsonb_typeof(r.payload->p_input)='string' THEN
    body:=r.payload->>p_input;
    IF p_input='transcript' AND r.payload#>>'{transcriptEvidence,textSha256}'=encode(sha256(convert_to(body,'UTF8')),'hex') THEN
      speech:=r.payload#>'{transcriptEvidence,segments}';
      frames:=r.payload#>'{transcriptEvidence,frames}';
    ELSIF p_input='transcript' AND r.payload->>'transcriptOrigin'='mac_local' THEN
      SELECT jsonb_agg(seg ORDER BY c.chunk_index,n),
        string_agg('['||to_char(make_interval(secs=>floor((seg->>'start')::numeric)::double precision),'HH24:MI:SS')||'] '||btrim(seg->>'text'),E'\n' ORDER BY c.chunk_index,n)
        INTO speech,mac_body
      FROM studio.studio_video_transcriptions v JOIN studio.studio_video_transcript_chunks c
        ON c.location_id=v.location_id AND c.transcription_id=v.id
      CROSS JOIN LATERAL jsonb_array_elements(c.segments) WITH ORDINALITY a(seg,n)
      WHERE v.location_id=p_location AND v.record_id=p_source AND v.id::text=r.payload->>'transcriptionId'
        AND v.transcript_applied AND v.status IN ('ready','partial');
      IF mac_body=body THEN
        SELECT jsonb_agg(jsonb_build_object('id',s.id,'ocr',s.payload#>'{unit,text}',
          'time',f.time_seconds,'end',f.scene_end,'audioContext',f.audio_context) ORDER BY s.unit_index,s.id)
          INTO frames
        FROM studio.studio_knowledge_source_units s JOIN studio.studio_video_frames f
          ON f.location_id=s.location_id AND f.transcription_id::text=s.transcription_id
          AND f.frame_index::text=s.payload#>>'{unit,frameIndex}' AND f.status='verified'
        WHERE s.location_id=p_location AND s.source_id=p_source AND s.transcription_id=r.payload->>'transcriptionId'
          AND s.payload#>>'{unit,kind}'='slide_ocr';
      ELSE
        speech:=NULL;
      END IF;
    END IF;
  ELSIF p_mode='upload_transcript' THEN
    SELECT v.* INTO t FROM studio.studio_transcripts v JOIN studio.studio_uploads u
      ON u.id=v.upload_id AND u.location_id=v.location_id
      WHERE v.location_id=p_location AND u.record_id=p_source AND u.id=p_input::uuid AND u.status='uploaded' FOR SHARE OF v,u;
    body:=t.text;
    speech:=t.segments;
  ELSIF p_mode='source_units' THEN
    PERFORM 1 FROM studio.studio_knowledge_source_units
      WHERE location_id=p_location AND source_id=p_source AND transcription_id=p_input ORDER BY unit_index,id FOR SHARE;
    SELECT jsonb_agg(jsonb_build_object('id',s.id,'text',s.payload#>'{unit,text}',
      'start',s.payload#>'{unit,start}','end',s.payload#>'{unit,end}') ORDER BY s.unit_index,s.id),
      jsonb_agg(jsonb_build_object('id',s.id,'ocr',s.payload#>'{unit,ocr}',
      'time',s.payload#>'{unit,start}','end',s.payload#>'{unit,end}') ORDER BY s.unit_index,s.id)
      INTO speech,frames
      FROM studio.studio_knowledge_source_units s
      WHERE s.location_id=p_location AND s.source_id=p_source AND s.transcription_id=p_input;
  ELSE
    RAISE EXCEPTION 'Choose saved source evidence' USING ERRCODE='22023';
  END IF;

  IF coalesce(octet_length(body),0)>400000 OR coalesce(octet_length(speech::text),0)>600000
    OR coalesce(octet_length(frames::text),0)>500000 THEN
    RAISE EXCEPTION 'Source exceeds the full extraction limit' USING ERRCODE='P2010';
  END IF;
  IF jsonb_typeof(speech) IS DISTINCT FROM 'array' THEN speech:=NULL; END IF;
  IF jsonb_array_length(speech)>0 AND p_mode<>'source_units' AND mac_body IS DISTINCT FROM body
      AND regexp_replace(btrim(body),'[[:space:]]+',' ','g') IS DISTINCT FROM (
        SELECT regexp_replace(btrim(string_agg(x->>'text',' ' ORDER BY n)),'[[:space:]]+',' ','g')
        FROM jsonb_array_elements(speech) WITH ORDINALITY s(x,n)) THEN
    -- An uploaded transcription can contain untimed text. Cover it all as plain text.
    speech:=NULL;
  END IF;
  IF jsonb_array_length(speech)>0 THEN
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(speech) s
      WHERE jsonb_typeof(s->'text') IS DISTINCT FROM 'string'
        OR (p_mode<>'source_units' AND (
          CASE WHEN jsonb_typeof(s->'start')='number' AND jsonb_typeof(s->'end')='number'
          THEN (s->>'start')::numeric<0 OR (s->>'end')::numeric<(s->>'start')::numeric
          ELSE true END))) THEN
      IF p_mode='source_units' THEN RAISE EXCEPTION 'Invalid imported source units' USING ERRCODE='22023'; END IF;
      speech:=NULL;
    END IF;
  END IF;
  IF jsonb_array_length(speech)>0 THEN
    WITH parts AS (
      SELECT n,i,s,substring(s->>'text' FROM i*2000+1 FOR 2000) AS value
      FROM jsonb_array_elements(speech) WITH ORDINALITY a(s,n)
      CROSS JOIN LATERAL generate_series(0,(char_length(s->>'text')-1)/2000) i
      WHERE s->>'text' ~ '[^[:space:]]'
    )
    SELECT jsonb_agg(jsonb_build_object('id','speech:'||n||':'||i,'originalUnitId',s->>'id','text',value,
      'evidenceType','speech','startChar',NULL,'endChar',NULL,
      'startSeconds',CASE WHEN jsonb_typeof(s->'start')='number' THEN CASE WHEN (s->>'start')::numeric>=0 THEN s->'start' END END,
      'endSeconds',CASE WHEN jsonb_typeof(s->'end')='number' AND jsonb_typeof(s->'start')='number' THEN
        CASE WHEN (s->>'start')::numeric>=0 AND (s->>'end')::numeric>=(s->>'start')::numeric THEN s->'end' END END) ORDER BY n,i)
      INTO units FROM parts;
  ELSIF body ~ '[^[:space:]]' THEN
    SELECT jsonb_agg(jsonb_build_object('id','text:'||i,'text',substring(body FROM i*2000+1 FOR 2000),
      'evidenceType',CASE WHEN p_input IN ('notes','script') AND p_mode='record_text' THEN 'text' ELSE 'speech' END,
      'startChar',i*2000,'endChar',least(char_length(body),(i+1)*2000),'startSeconds',NULL,'endSeconds',NULL) ORDER BY i)
      INTO units FROM generate_series(0,(char_length(body)-1)/2000) i;
  END IF;
  IF units IS NULL THEN RAISE EXCEPTION 'Save transcript or source text first' USING ERRCODE='22023'; END IF;

  IF jsonb_typeof(frames)='array' THEN
    SELECT jsonb_agg(jsonb_build_object('id','ocr:'||n||':'||i,'text',substring(f->>'ocr' FROM i*2000+1 FOR 2000),
      'originalUnitId',f->>'id','evidenceType','ocr','startChar',NULL,'endChar',NULL,
      'startSeconds',f->'time','endSeconds',CASE WHEN jsonb_typeof(f->'end')='number' THEN CASE WHEN (f->>'end')::numeric>=(f->>'time')::numeric THEN f->'end' END END,
      'context',left(f->>'audioContext',1000)) ORDER BY n,i)
      INTO visual
      FROM jsonb_array_elements(frames) WITH ORDINALITY a(f,n)
      CROSS JOIN LATERAL generate_series(0,(char_length(f->>'ocr')-1)/2000) i
      WHERE jsonb_typeof(f->'ocr')='string' AND f->>'ocr' ~ '[^[:space:]]'
        AND CASE WHEN jsonb_typeof(f->'time')='number' THEN (f->>'time')::numeric>=0 ELSE false END;
  END IF;
  -- Timed evidence is chronological; untimed passages keep their saved order.
  SELECT jsonb_agg(u||jsonb_build_object('unitIndex',idx-1) ORDER BY idx) INTO units FROM (
    SELECT u,row_number() OVER (ORDER BY (u->>'startSeconds')::numeric NULLS LAST,n) AS idx
    FROM jsonb_array_elements(units||coalesce(visual,'[]'::jsonb)) WITH ORDINALITY a(u,n)
  ) indexed;
  IF jsonb_array_length(units)>2048 OR octet_length(units::text)>720000 THEN
    RAISE EXCEPTION 'Source exceeds the full extraction limit' USING ERRCODE='P2010';
  END IF;
  RETURN jsonb_build_object('source',jsonb_build_object('id',r.id,'version',r.version,'title',left(r.title,180),'url',r.source_url),
    'units',units,'characters',char_length(body),'fingerprint',encode(sha256(convert_to(jsonb_build_array(r.source_url,units)::text,'UTF8')),'hex'));
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_outline_input(text,uuid,bigint,text,text) FROM PUBLIC;

ALTER FUNCTION studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text)
  RENAME TO studio_build_knowledge_range_snapshot;
CREATE FUNCTION studio.studio_build_knowledge_snapshot(p_location_id text,p_source_id uuid,p_expected_version bigint,p_mode text,
  p_input_id text,p_start_unit integer,p_unit_count integer,p_focus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE outline studio.studio_knowledge_outlines%rowtype; evidence jsonb; units jsonb;
BEGIN
  IF p_mode IS DISTINCT FROM 'outline' THEN
    RETURN studio.studio_build_knowledge_range_snapshot(p_location_id,p_source_id,p_expected_version,p_mode,p_input_id,p_start_unit,p_unit_count,p_focus);
  END IF;
  SELECT * INTO outline FROM studio.studio_knowledge_outlines
    WHERE location_id=p_location_id AND id=p_input_id::uuid AND source_id=p_source_id AND source_version=p_expected_version;
  IF NOT FOUND OR NOT outline.plan @> jsonb_build_array(jsonb_build_object('start',p_start_unit,'count',p_unit_count)) OR p_focus<>'' THEN
    RAISE EXCEPTION 'Unknown outline batch' USING ERRCODE='22023';
  END IF;
  evidence:=studio.studio_outline_input(p_location_id,p_source_id,NULL,outline.input_mode,outline.input_id);
  IF evidence->>'fingerprint' IS DISTINCT FROM outline.fingerprint THEN
    RAISE EXCEPTION 'Transcript changed' USING ERRCODE='40001';
  END IF;
  SELECT jsonb_agg(u ORDER BY n) INTO units FROM jsonb_array_elements(evidence->'units') WITH ORDINALITY a(u,n)
    WHERE n>p_start_unit AND n<=p_start_unit+p_unit_count;
  RETURN jsonb_build_object('source',outline.source_snapshot,'mode',p_mode,'inputId',p_input_id,
    'evidenceMode',outline.input_mode,'evidenceInputId',outline.input_id,'startUnit',p_start_unit,'unitCount',p_unit_count,
    'focus',p_focus,'fingerprint',outline.fingerprint,'coverage',jsonb_build_object(
      'totalUnits',jsonb_array_length(evidence->'units'),'selectedUnits',p_unit_count,'totalCharacters',evidence->'characters'),'units',units);
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION studio.studio_knowledge_snapshot_current(p_location_id text,p_snapshot jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN studio.studio_build_knowledge_snapshot(p_location_id,(p_snapshot#>>'{source,id}')::uuid,(p_snapshot#>>'{source,version}')::bigint,
    p_snapshot->>'mode',p_snapshot->>'inputId',(p_snapshot->>'startUnit')::integer,(p_snapshot->>'unitCount')::integer,p_snapshot->>'focus')=p_snapshot;
EXCEPTION WHEN serialization_failure OR invalid_parameter_value OR invalid_text_representation OR SQLSTATE 'P2010' THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION studio.studio_text_prompt_version() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF new.workflow='idea_review' THEN new.prompt_version:='studio.idea-review.v2';
  ELSIF new.workflow='script_brief' THEN new.prompt_version:='studio.script-brief.v2';
  ELSIF new.workflow='knowledge_extract' AND new.snapshot->>'mode'='outline' THEN new.prompt_version:='studio.knowledge-extract.v2';
  END IF;
  RETURN new;
END;
$$;

-- Keep the existing route and reservation lifecycle. Outline admission has its own batch bound.
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
    and o.actor_app=p_actor_app and o.actor_id=p_clerk_user_id and p_request_id=md5(o.id::text||':'||p_start_unit::text)::uuid) then
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

CREATE OR REPLACE FUNCTION studio.studio_enqueue_routed_text_run(p_location_id text,p_actor_app text,p_clerk_user_id text,p_workflow text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare route text:=coalesce(p_command->>'provider','openai'); r jsonb; run studio.studio_idea_reviews%rowtype; d studio.studio_devices%rowtype; prior uuid;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if route not in ('openai','subscription') or p_workflow not in ('idea_review','script_brief','knowledge_extract')
 or (route='openai' and p_command->>'confirmPaid' is distinct from 'true')
 or (route='subscription' and p_command->>'confirmSubscription' is distinct from 'true') then raise exception 'Explicit provider authorization required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location_id,0));
 select id into prior from studio.studio_idea_reviews where location_id=p_location_id and request_id=(p_command->>'requestId')::uuid;
 if prior is null and route='openai' and not exists(select 1 from public.settings_secrets where scope_type::text='LOCATION' and scope_id=p_location_id and domain='location.ai' and secret_key='openai_api_key') then
  raise exception 'Add a Location OpenAI API key before queuing this workflow' using errcode='22023';
 end if;
 if p_workflow='knowledge_extract' then
  r:=studio.studio_enqueue_knowledge_extraction(p_location_id,p_actor_app,p_clerk_user_id,(p_command->>'requestId')::uuid,(p_command->>'sourceId')::uuid,(p_command->>'expectedVersion')::bigint,p_command->>'mode',p_command->>'inputId',(p_command->>'startUnit')::integer,(p_command->>'unitCount')::integer,p_command->>'focus',true);
 else
  r:=studio.studio_enqueue_text_run(p_location_id,p_actor_app,p_clerk_user_id,(p_command->>'requestId')::uuid,p_command->'ideas',p_command->>'focus',true,p_workflow);
 end if;
 select * into run from studio.studio_idea_reviews where id=(r->>'reviewId')::uuid for update;
 if prior is not null then
  if run.execution_provider<>route then raise exception 'Request provider changed' using errcode='23505'; end if;
  return r;
 end if;
 if route='subscription' then
  -- Account-scoped: a teammate's subscription is never borrowed. AI-manager consent is required for Mac work.
  perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
  select * into d from studio.studio_devices where location_id=p_location_id and app=p_actor_app and created_by=p_clerk_user_id
   and revoked_at is null and not paused and processing_enabled and 'studio.text_run'=any(allowed_kinds)
   and seen_at<=clock_timestamp() and seen_at>clock_timestamp()-interval '90 seconds' and coalesce(report->>'draining','false')='false'
   and report->'handlers' ? 'studio.text_run'
   and (p_workflow<>'knowledge_extract' or p_command->>'mode' is distinct from 'outline' or report->>'knowledgeOutlineVersion'='2')
   and desired_config#>>'{features,text}'='true'
   and desired_config->>'textProvider' in ('codex','claude') and config_version=applied_config_version and config_status='applied'
   and report#>>ARRAY[desired_config->>'textProvider','ready']='true'
   and report#>>ARRAY[desired_config->>'textProvider','authenticated']='true'
   and report#>>ARRAY[desired_config->>'textProvider','loginMethod']=case desired_config->>'textProvider' when 'codex' then 'chatgpt' else 'claudeai' end
   and report#>>ARRAY['capacity',desired_config->>'textProvider']='true'
   and coalesce(report->'processingBlocked','[]'::jsonb)='[]'::jsonb
   order by seen_at desc limit 1 for update;
  if not found then
   if p_workflow='knowledge_extract' and p_command->>'mode'='outline' then
    raise exception 'The updated paired Mac is not ready' using errcode='P2011';
   end if;
   raise exception 'Your paired Mac must be ready with Text work and a subscription provider selected and applied' using errcode='22023';
  end if;
  update studio.studio_idea_reviews set execution_provider=route,model='mac_'||(d.desired_config->>'textProvider')||':'||coalesce(d.desired_config->>'textModel','native-default') where id=run.id;
  update studio.studio_jobs set kind='studio.text_run',execution_target='device',device_id=d.id,max_attempts=1,
   payload=payload||jsonb_build_object('workflow',run.workflow,'snapshot',run.snapshot,'promptVersion',run.prompt_version,'provider',d.desired_config->>'textProvider','model',d.desired_config->'textModel','configVersion',d.config_version)
   where id=run.job_id;
 end if;
 return r;
end $$;

CREATE FUNCTION studio.studio_enqueue_knowledge_outline(p_location text,p_app text,p_actor text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior studio.studio_knowledge_outlines%rowtype; evidence jsonb; unit jsonb; batch jsonb;
  v_request_id uuid:=(p_command->>'requestId')::uuid; outline_id uuid:=gen_random_uuid();
  v_source_id uuid:=(p_command->>'sourceId')::uuid; source_version bigint:=(p_command->>'expectedVersion')::bigint;
  input_mode text:=p_command->>'mode'; input_id text:=p_command->>'inputId'; provider text:=p_command->>'provider';
  plan jsonb:='[]'; batch_start integer:=0; batch_count integer:=0; batch_bytes integer:=0; unit_bytes integer;
  route_request jsonb;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  IF v_request_id IS NULL OR v_source_id IS NULL OR source_version IS NULL OR source_version<1
    OR provider IS NULL OR provider NOT IN ('subscription','openai')
    OR (provider='subscription' AND p_command->>'confirmSubscription' IS DISTINCT FROM 'true')
    OR (provider='openai' AND p_command->>'confirmPaid' IS DISTINCT FROM 'true') THEN
    RAISE EXCEPTION 'Authorize extraction funding explicitly' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location,0));
  route_request:=p_command||jsonb_build_object('app',p_app,'actor',p_actor);
  SELECT * INTO prior FROM studio.studio_knowledge_outlines o WHERE o.location_id=p_location AND o.request_id=v_request_id;
  IF FOUND THEN
    IF prior.request IS DISTINCT FROM route_request THEN
      RAISE EXCEPTION 'Extraction request reused' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('outlineId',prior.id);
  END IF;

  IF EXISTS(SELECT 1 FROM studio.studio_knowledge_outlines o JOIN studio.studio_idea_reviews r
     ON r.location_id=o.location_id AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='outline' AND r.snapshot->>'inputId'=o.id::text
    JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
    WHERE o.location_id=p_location AND o.source_id=v_source_id AND j.status IN ('queued','running')) THEN
    RAISE EXCEPTION 'This source already has an active knowledge extraction' USING ERRCODE='P2012';
  END IF;

  evidence:=studio.studio_outline_input(p_location,v_source_id,source_version,input_mode,input_id);
  FOR unit IN SELECT value FROM jsonb_array_elements(evidence->'units') LOOP
    unit_bytes:=octet_length(unit::text)+4;
    IF batch_count=48 OR batch_bytes+unit_bytes>18000 THEN
      plan:=plan||jsonb_build_array(jsonb_build_object('start',batch_start,'count',batch_count));
      batch_start:=batch_start+batch_count;
      batch_count:=0;
      batch_bytes:=0;
    END IF;
    batch_count:=batch_count+1;
    batch_bytes:=batch_bytes+unit_bytes;
  END LOOP;
  plan:=plan||jsonb_build_array(jsonb_build_object('start',batch_start,'count',batch_count));
  IF jsonb_array_length(plan)>48 THEN
    RAISE EXCEPTION 'Source exceeds the full extraction limit' USING ERRCODE='P2010';
  END IF;
  IF jsonb_array_length(plan)+(SELECT count(*) FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j
      ON j.location_id=r.location_id AND j.id=r.job_id
      WHERE r.location_id=p_location AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='outline' AND j.status IN ('queued','running'))>72 THEN
    RAISE EXCEPTION 'Wait for existing extraction batches to finish' USING ERRCODE='P2012';
  END IF;
  INSERT INTO studio.studio_knowledge_outlines(location_id,id,request_id,actor_app,actor_id,source_id,source_version,source_snapshot,input_mode,input_id,fingerprint,request,plan)
    VALUES(p_location,outline_id,v_request_id,p_app,p_actor,v_source_id,source_version,evidence->'source',input_mode,input_id,evidence->>'fingerprint',route_request,plan);
  FOR batch IN SELECT value FROM jsonb_array_elements(plan) LOOP
    PERFORM studio.studio_enqueue_routed_text_run(p_location,p_app,p_actor,'knowledge_extract',
      jsonb_build_object('requestId',md5(outline_id::text||':'||(batch->>'start'))::uuid,'sourceId',v_source_id,
        'expectedVersion',source_version,'mode','outline','inputId',outline_id,'startUnit',batch->'start','unitCount',batch->'count',
        'focus','','provider',provider,'confirmSubscription',provider='subscription','confirmPaid',provider='openai'));
  END LOOP;
  RETURN jsonb_build_object('outlineId',outline_id);
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_knowledge_outline(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_knowledge_outline(text,text,text,jsonb) TO service_role;

ALTER FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb) RENAME TO studio_validate_text_run_range_result;
CREATE FUNCTION studio.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM studio.studio_validate_text_run_range_result(p_workflow,p_result,snapshot);
  IF p_workflow='knowledge_extract' AND snapshot->>'mode'='outline' AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_result->'findings') f WHERE
      CASE WHEN jsonb_typeof(f->'topicPath')='array' THEN
        jsonb_array_length(f->'topicPath') NOT BETWEEN 1 AND 12 OR EXISTS(
          SELECT 1 FROM jsonb_array_elements(f->'topicPath') t
          WHERE jsonb_typeof(t)<>'string' OR char_length(t#>>'{}') NOT BETWEEN 1 AND 120
            OR t#>>'{}' ~ '[[:cntrl:]]|^[[:space:]]|[[:space:]]$')
      ELSE true END) THEN
    RAISE EXCEPTION 'Invalid outline topic path' USING ERRCODE='22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_validate_text_run_result(text,jsonb,jsonb) FROM PUBLIC;

-- Carry the type and original identity of evidence through the ordinary Knowledge application.
CREATE FUNCTION studio.studio_label_outline_citation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; unit jsonb;
BEGIN
  IF new.payload->>'input_mode' IS DISTINCT FROM 'outline' THEN RETURN new; END IF;
  SELECT r.snapshot INTO snapshot FROM studio.studio_idea_reviews r
    WHERE r.location_id=new.location_id AND r.id=(new.payload->>'extraction_id')::uuid AND r.snapshot->>'mode'='outline';
  SELECT u INTO unit FROM jsonb_array_elements(snapshot->'units') u WHERE u->>'id'=new.payload->>'unit_id';
  IF unit IS NULL THEN RAISE EXCEPTION 'Outline citation is unavailable' USING ERRCODE='22023'; END IF;
  new.payload:=new.payload||jsonb_build_object('outline_id',snapshot->>'inputId',
    'input_mode',snapshot->>'evidenceMode','input_id',snapshot->>'evidenceInputId',
    'evidence_type',unit->>'evidenceType','original_unit_id',unit->>'originalUnitId');
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_label_outline_citation() FROM PUBLIC;
CREATE TRIGGER studio_label_outline_citation BEFORE INSERT ON studio.studio_knowledge_evidence
  FOR EACH ROW EXECUTE FUNCTION studio.studio_label_outline_citation();

CREATE FUNCTION studio.studio_get_knowledge_outline(p_location text,p_app text,p_actor text,p_outline uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o studio.studio_knowledge_outlines%rowtype; batch jsonb; current boolean;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  SELECT * INTO o FROM studio.studio_knowledge_outlines WHERE location_id=p_location AND id=p_outline AND actor_app=p_app;
  IF NOT FOUND THEN RETURN NULL; END IF;
  BEGIN
    current:=studio.studio_outline_input(p_location,o.source_id,NULL,o.input_mode,o.input_id)->>'fingerprint'=o.fingerprint;
  EXCEPTION WHEN serialization_failure OR invalid_parameter_value OR invalid_text_representation OR SQLSTATE 'P2010' THEN
    current:=false;
  END;
  SELECT jsonb_agg(jsonb_build_object('reviewId',r.id,'snapshot',r.snapshot,'result',r.result,'model',r.model,
    'status',j.status,'error',j.last_error_message,'stale',r.stale_at_completion,
    'applied',coalesce((SELECT jsonb_agg(jsonb_build_object('index',m.finding_index,'insightId',m.insight_id,'status',i.status,'reused',m.reused))
      FROM studio.studio_knowledge_extraction_findings m JOIN studio.studio_knowledge_insights i
        ON (i.location_id,i.id)=(m.location_id,m.insight_id)
      WHERE m.location_id=r.location_id AND m.review_id=r.id),'[]'::jsonb)) ORDER BY (r.snapshot->>'startUnit')::integer)
    INTO batch FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON (j.location_id,j.id)=(r.location_id,r.job_id)
    WHERE r.location_id=p_location AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='outline' AND r.snapshot->>'inputId'=p_outline::text;
  RETURN jsonb_build_object('id',o.id,'createdAt',o.created_at,'sourceId',o.source_id,'provider',o.request->>'provider','stale',NOT current,
    'batches',coalesce(batch,'[]'::jsonb),'annotations',coalesce((SELECT jsonb_object_agg(a.node_key,(a.value-'author'-'updatedAt')||jsonb_build_object('version',a.version))
      FROM studio.studio_knowledge_outline_annotations a WHERE a.location_id=p_location AND a.outline_id=p_outline),'{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_get_knowledge_outline(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_get_knowledge_outline(text,text,text,uuid) TO service_role;

CREATE FUNCTION studio.studio_outline_node_exists(p_location text,p_outline uuid,p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE path jsonb;
BEGIN
  IF p_key='overview' THEN RETURN true; END IF;
  IF left(p_key,6)='topic:' THEN
    path:=substring(p_key FROM 7)::jsonb;
    IF jsonb_typeof(path) IS DISTINCT FROM 'array' OR jsonb_array_length(path) NOT BETWEEN 1 AND 12 THEN RETURN false; END IF;
    RETURN EXISTS(SELECT 1 FROM studio.studio_idea_reviews r CROSS JOIN LATERAL jsonb_array_elements(r.result->'findings') f
      WHERE r.location_id=p_location AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='outline'
        AND r.snapshot->>'inputId'=p_outline::text AND path=(
          SELECT jsonb_agg(t ORDER BY n) FROM jsonb_array_elements(f->'topicPath') WITH ORDINALITY a(t,n)
          WHERE n<=jsonb_array_length(path)));
  END IF;
  IF p_key ~ '^finding:[0-9a-f-]{36}:[0-9]$' THEN
    RETURN EXISTS(SELECT 1 FROM studio.studio_idea_reviews r WHERE r.location_id=p_location AND r.workflow='knowledge_extract'
      AND r.snapshot->>'mode'='outline' AND r.snapshot->>'inputId'=p_outline::text
      AND r.id=split_part(p_key,':',2)::uuid AND r.result->'findings'->split_part(p_key,':',3)::integer IS NOT NULL);
  END IF;
  IF p_key ~ '^unit:[0-9]{1,4}$' THEN
    RETURN EXISTS(SELECT 1 FROM studio.studio_idea_reviews r CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'units') u
      WHERE r.location_id=p_location AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='outline'
      AND r.snapshot->>'inputId'=p_outline::text AND u->>'unitIndex'=split_part(p_key,':',2));
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_outline_node_exists(text,uuid,text) FROM PUBLIC;

ALTER FUNCTION studio.studio_apply_knowledge_extraction(text,text,text,uuid,uuid,bigint,jsonb,boolean)
  RENAME TO studio_apply_knowledge_extraction_findings;
REVOKE EXECUTE ON FUNCTION studio.studio_apply_knowledge_extraction_findings(text,text,text,uuid,uuid,bigint,jsonb,boolean) FROM service_role;
CREATE FUNCTION studio.studio_apply_knowledge_extraction(p_location_id text,p_actor_app text,p_clerk_user_id text,p_review_id uuid,
  p_request_id uuid,p_expected_version bigint,p_finding_indexes jsonb,p_confirm_pending boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  IF EXISTS(SELECT 1 FROM studio.studio_idea_reviews WHERE location_id=p_location_id AND id=p_review_id AND snapshot->>'mode'='outline') THEN
    RAISE EXCEPTION 'Review the full source to apply these findings' USING ERRCODE='22023';
  END IF;
  RETURN studio.studio_apply_knowledge_extraction_findings(p_location_id,p_actor_app,p_clerk_user_id,
    p_review_id,p_request_id,p_expected_version,p_finding_indexes,p_confirm_pending);
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_apply_knowledge_extraction(text,text,text,uuid,uuid,bigint,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_apply_knowledge_extraction(text,text,text,uuid,uuid,bigint,jsonb,boolean) TO service_role;

CREATE FUNCTION studio.studio_change_knowledge_outline(p_location text,p_app text,p_actor text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o studio.studio_knowledge_outlines%rowtype; prior studio.studio_knowledge_outline_commands%rowtype;
  annotation studio.studio_knowledge_outline_annotations%rowtype; batch studio.studio_idea_reviews%rowtype;
  insight studio.studio_knowledge_insights%rowtype; selection jsonb; finding jsonb; applied jsonb; result jsonb;
  v_request uuid:=(p_command->>'requestId')::uuid; v_outline uuid:=(p_command->>'outlineId')::uuid;
  action text:=p_command->>'action'; v_key text:=p_command->>'nodeKey';
  command jsonb:=p_command||jsonb_build_object('app',p_app,'actor',p_actor);
  note text:=p_command->>'note'; title text:=p_command->>'title'; summary text:=p_command->>'summary';
  v_version bigint:=(p_command->>'expectedVersion')::bigint; finding_index integer; child_id uuid;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  IF v_outline IS NULL OR v_request IS NULL OR action IS NULL OR action NOT IN ('annotate','approve') THEN
    RAISE EXCEPTION 'Invalid outline command' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge-outline-request:'||p_location||':'||v_request,0));
  SELECT * INTO prior FROM studio.studio_knowledge_outline_commands WHERE location_id=p_location AND request_id=v_request;
  IF FOUND THEN
    IF prior.request IS DISTINCT FROM command THEN RAISE EXCEPTION 'Review request reused' USING ERRCODE='23505'; END IF;
    RETURN prior.result;
  END IF;
  SELECT * INTO o FROM studio.studio_knowledge_outlines WHERE location_id=p_location AND id=v_outline AND actor_app=p_app FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outline unavailable' USING ERRCODE='22023'; END IF;

  IF action='annotate' THEN
    IF v_version IS NULL OR v_version<0 OR v_key IS NULL OR octet_length(v_key)>6000
      OR note IS NULL OR char_length(note)>2000 OR title IS NULL OR char_length(title)>120
      OR summary IS NULL OR char_length(summary)>1200
      OR ((title<>'' OR summary<>'') AND v_key<>'overview' AND left(v_key,6)<>'topic:')
      OR NOT studio.studio_outline_node_exists(p_location,o.id,v_key) THEN
      RAISE EXCEPTION 'Invalid outline annotation' USING ERRCODE='22023';
    END IF;
    SELECT * INTO annotation FROM studio.studio_knowledge_outline_annotations a
      WHERE a.location_id=p_location AND a.outline_id=o.id AND a.node_key=v_key;
    IF v_version<>coalesce(annotation.version,0) THEN
      RAISE EXCEPTION 'Annotation changed' USING ERRCODE='40001';
    END IF;
    result:=jsonb_build_object('note',note,'title',title,'summary',summary,'author',p_actor,'updatedAt',clock_timestamp());
    INSERT INTO studio.studio_knowledge_outline_annotations AS a(location_id,outline_id,node_key,version,value)
      VALUES(p_location,o.id,v_key,v_version+1,result)
      ON CONFLICT ON CONSTRAINT studio_knowledge_outline_annotations_pkey
      DO UPDATE SET value=excluded.value,version=excluded.version;
    result:=result||jsonb_build_object('version',v_version+1);
  ELSE
    IF p_command->>'confirmApproval' IS DISTINCT FROM 'true' OR jsonb_typeof(p_command->'selections') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_command->'selections') NOT BETWEEN 1 AND 50
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_command->'selections') s
        WHERE jsonb_typeof(s->'index') IS DISTINCT FROM 'number' OR s->>'index' !~ '^[0-9]$'
          OR jsonb_typeof(s->'reviewId') IS DISTINCT FROM 'string')
      OR (SELECT count(DISTINCT jsonb_build_array(s->>'reviewId',s->>'index')) FROM jsonb_array_elements(p_command->'selections') s)
         <>jsonb_array_length(p_command->'selections') THEN
      RAISE EXCEPTION 'Confirm selected takeaways for approval' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM studio.studio_idea_reviews r WHERE r.location_id=p_location AND r.workflow='knowledge_extract'
      AND r.snapshot->>'mode'='outline' AND r.snapshot->>'inputId'=o.id::text AND (r.result IS NULL OR r.stale_at_completion IS DISTINCT FROM false))
      OR studio.studio_outline_input(p_location,o.source_id,NULL,o.input_mode,o.input_id)->>'fingerprint' IS DISTINCT FROM o.fingerprint THEN
      RAISE EXCEPTION 'Knowledge extraction is incomplete or evidence changed' USING ERRCODE='40001';
    END IF;
    -- Serializes bulk operations that can resolve multiple Location topics.
    PERFORM pg_advisory_xact_lock(hashtextextended('knowledge-outline-approval:'||p_location,0));
    result:='[]';
    FOR selection IN SELECT value FROM jsonb_array_elements(p_command->'selections') LOOP
      child_id:=(selection->>'reviewId')::uuid;
      finding_index:=(selection->>'index')::integer;
      SELECT * INTO batch FROM studio.studio_idea_reviews r WHERE r.location_id=p_location AND r.id=child_id
        AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='outline' AND r.snapshot->>'inputId'=o.id::text;
      finding:=batch.result->'findings'->finding_index;
      IF finding IS NULL THEN RAISE EXCEPTION 'Takeaway unavailable' USING ERRCODE='22023'; END IF;
      applied:=studio.studio_apply_knowledge_extraction_findings(p_location,p_app,p_actor,child_id,gen_random_uuid(),o.source_version,
        jsonb_build_array(finding_index),true)#>'{findings,0}';
      SELECT * INTO insight FROM studio.studio_knowledge_insights i WHERE i.location_id=p_location AND i.id=(applied->>'insightId')::uuid;
      IF insight.status='pending' THEN
        PERFORM studio.studio_mutate_knowledge_insight(p_location,p_app,p_actor,insight.id,gen_random_uuid(),insight.version,'approve',NULL,
          CASE WHEN insight.topic_id IS NOT NULL THEN '{"mode":"keep"}'::jsonb
          ELSE jsonb_build_object('mode','create','name',finding->'topicPath'->>0) END,'Approved from source knowledge review');
      END IF;
      result:=result||jsonb_build_array(applied||jsonb_build_object('reviewId',child_id,
        'status',CASE WHEN insight.status='pending' THEN 'approved' ELSE insight.status END,
        'decision',CASE WHEN insight.status='pending' THEN 'approved' ELSE 'existing' END));
    END LOOP;
    result:=jsonb_build_object('findings',result);
  END IF;
  INSERT INTO studio.studio_knowledge_outline_commands(location_id,request_id,outline_id,request,result)
    VALUES(p_location,v_request,v_outline,command,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_change_knowledge_outline(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_change_knowledge_outline(text,text,text,jsonb) TO service_role;
