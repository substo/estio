BEGIN;

-- Saved descriptions are untimed source evidence, using the same bounds and citations as other saved text.
CREATE OR REPLACE FUNCTION studio.studio_outline_input(p_location text,p_source uuid,p_version bigint,p_mode text,p_input text) RETURNS jsonb
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

  IF p_mode='record_text' AND p_input IN ('transcript','script','notes','description') AND jsonb_typeof(r.payload->p_input)='string' THEN
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
      'evidenceType',CASE WHEN p_input IN ('notes','script','description') AND p_mode='record_text' THEN 'text' ELSE 'speech' END,
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

CREATE OR REPLACE FUNCTION studio.studio_knowledge_extraction_inputs(p_location_id text, p_actor_app text, p_clerk_user_id text, p_source_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare r studio.studio_records%rowtype; inputs jsonb:='[]'; field text; item record;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 select * into r from studio.studio_records where location_id=p_location_id and id=p_source_id;
 if not found or r.archived or r.kind not in ('reference','content') then raise exception 'Source unavailable' using errcode='22023'; end if;
 foreach field in array array['transcript','description','notes','script'] loop
  if jsonb_typeof(r.payload->field)='string' and r.payload->>field !~ '^[[:space:]]*$' then
   inputs:=inputs||jsonb_build_array(jsonb_build_object('mode','record_text','inputId',field,'label','Saved '||field,'totalUnits',ceil(char_length(r.payload->>field)::numeric/2000)::integer));
  end if;
 end loop;
 for item in select transcription_id,max(unit_index)+1 as n from studio.studio_knowledge_source_units where location_id=p_location_id and source_id=p_source_id group by transcription_id order by transcription_id limit 20 loop
  inputs:=inputs||jsonb_build_array(jsonb_build_object('mode','source_units','inputId',item.transcription_id,'label','Imported units: '||item.transcription_id,'totalUnits',item.n));
 end loop;
 for item in select t.upload_id,ceil(char_length(t.text)::numeric/2000)::integer as n,u.original_filename from studio.studio_transcripts t join studio.studio_uploads u on u.id=t.upload_id and u.location_id=t.location_id
  where t.location_id=p_location_id and u.record_id=p_source_id and u.status='uploaded' and char_length(t.text)>0 order by t.created_at desc limit 20 loop
  inputs:=inputs||jsonb_build_array(jsonb_build_object('mode','upload_transcript','inputId',item.upload_id,'label','Upload transcript: '||item.original_filename,'totalUnits',item.n));
 end loop;
 return jsonb_build_object('source',jsonb_build_object('id',r.id,'version',r.version,'title',r.title),'inputs',inputs);
end; $_$;

CREATE FUNCTION studio.studio_queue_import_knowledge(p_location text,p_app text,p_actor text,p_source uuid,p_transcription uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r studio.studio_records%rowtype; j studio.studio_jobs%rowtype;
  job_key text:='import-knowledge:'||p_source::text;
BEGIN
  PERFORM studio.studio_lock_location_member(p_location,p_app,p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended(job_key,0));
  SELECT * INTO r FROM studio.studio_records WHERE id=p_source AND location_id=p_location AND kind='reference' AND NOT archived;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT id INTO j.id FROM studio.studio_jobs WHERE location_id=p_location AND idempotency_key=job_key;
  IF FOUND THEN RETURN j.id; END IF;
  IF p_transcription IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM studio.studio_video_transcriptions v WHERE v.id=p_transcription AND v.location_id=p_location AND v.record_id=p_source
  ) THEN RAISE EXCEPTION 'Unknown source transcription' USING ERRCODE='22023'; END IF;
  j:=studio.studio_enqueue_job(p_location,'studio.import_knowledge',
    jsonb_strip_nulls(jsonb_build_object('app',p_app,'recordId',p_source,'sourceUrl',r.source_url,'transcriptionId',p_transcription)),
    job_key,p_actor,20);
  RETURN j.id;
END;
$$;

-- A hosted job coordinates timing only. Its lease and the original member are checked before admitting Mac work.
CREATE FUNCTION studio.studio_start_import_knowledge(p_job_id uuid,p_worker_id text,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j studio.studio_jobs%rowtype; r studio.studio_records%rowtype; v_status text; input_name text; existing uuid;
BEGIN
  SELECT * INTO j FROM studio.studio_jobs WHERE id=p_job_id AND kind='studio.import_knowledge' AND execution_target='hosted'
    AND status='running' AND lease_owner=p_worker_id AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"state":"lease_lost"}'; END IF;
  PERFORM studio.studio_lock_location_member(j.location_id,j.payload->>'app',j.created_by_clerk_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('idea-review:'||j.location_id,0));
  SELECT * INTO r FROM studio.studio_records WHERE location_id=j.location_id AND id=(j.payload->>'recordId')::uuid
    AND kind='reference' AND NOT archived AND source_url IS NOT DISTINCT FROM (j.payload->>'sourceUrl') FOR SHARE;
  IF NOT FOUND THEN RETURN '{"state":"source_changed"}'; END IF;
  SELECT id INTO existing FROM studio.studio_knowledge_outlines WHERE location_id=j.location_id AND source_id=r.id
    AND actor_app=j.payload->>'app' AND actor_id=j.created_by_clerk_user_id
    ORDER BY created_at DESC,id LIMIT 1;
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('state','started','outlineId',existing); END IF;
  SELECT status INTO v_status FROM studio.studio_video_transcriptions WHERE id=(j.payload->>'transcriptionId')::uuid
    AND location_id=j.location_id AND record_id=r.id;
  IF v_status IN ('queued','running') THEN RETURN '{"state":"waiting_transcript"}'; END IF;
  input_name:=CASE
    WHEN jsonb_typeof(r.payload->'transcript')='string' AND r.payload->>'transcript' ~ '[^[:space:]]' THEN 'transcript'
    WHEN jsonb_typeof(r.payload->'description')='string' AND r.payload->>'description' ~ '[^[:space:]]' THEN 'description'
  END;
  IF input_name IS NULL THEN RETURN '{"state":"no_evidence"}'; END IF;
  RETURN '{"state":"started"}'::jsonb || studio.studio_enqueue_knowledge_outline(j.location_id,j.payload->>'app',j.created_by_clerk_user_id,
    jsonb_build_object('requestId',j.id,'sourceId',r.id,'expectedVersion',r.version,'mode','record_text','inputId',input_name,
      'curationVersion',1,'provider','subscription','confirmSubscription',true,'confirmPaid',false));
END;
$$;
REVOKE ALL ON FUNCTION studio.studio_queue_import_knowledge(text,text,text,uuid,uuid),studio.studio_start_import_knowledge(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_queue_import_knowledge(text,text,text,uuid,uuid),studio.studio_start_import_knowledge(uuid,text,uuid) TO service_role;
COMMIT;
