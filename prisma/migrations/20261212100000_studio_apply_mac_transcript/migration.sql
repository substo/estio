-- When the owner asks for a Mac transcription (pasted link, chosen result, or "Transcribe again"), the finished Mac transcript becomes the source's transcript.
-- Until now it was stored but not applied whenever any transcript existed, so the owner saw nothing change. The text it replaces is kept as payload.previousTranscript.
-- Automatic discovery runs (approved channels) still never replace an existing transcript.
CREATE FUNCTION studio.studio_apply_mac_transcript(p_location text,p_transcription uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare t studio.studio_video_transcriptions%rowtype; rec studio.studio_records%rowtype; text_out text; old text;
begin
 select * into t from studio.studio_video_transcriptions where location_id=p_location and id=p_transcription;
 if not found or t.status not in ('ready','partial') then return false; end if;
 select string_agg('['||lpad((floor((s.v->>'start')::numeric/3600))::text,2,'0')||':'||lpad((floor(((s.v->>'start')::numeric%3600)/60))::text,2,'0')||':'||lpad((floor((s.v->>'start')::numeric%60))::text,2,'0')||'] '||btrim(s.v->>'text'),E'\n' order by c.chunk_index,s.o)
  into text_out from studio.studio_video_transcript_chunks c cross join lateral jsonb_array_elements(c.segments) with ordinality as s(v,o) where c.location_id=t.location_id and c.transcription_id=t.id;
 if coalesce(text_out,'')='' then return false; end if;
 select * into rec from studio.studio_records where location_id=t.location_id and id=t.record_id for update;
 if not found or rec.archived then return false; end if;
 old:=coalesce(btrim(rec.payload->>'transcript'),'');
 update studio.studio_records set payload=payload||jsonb_strip_nulls(jsonb_build_object('transcript',text_out,'transcriptOrigin','mac_local','transcriptMethod',t.method,'transcriptLanguage',t.language,'transcriptAt',clock_timestamp(),'transcriptionId',t.id,
   'previousTranscript',case when old<>'' and coalesce(rec.payload->>'transcriptOrigin','')<>'mac_local' then rec.payload->>'transcript' else rec.payload->>'previousTranscript' end)),
  version=version+1,updated_at=clock_timestamp() where location_id=t.location_id and id=t.record_id;
 update studio.studio_video_transcriptions set transcript_applied=true,transcript_chars=char_length(text_out) where id=t.id and location_id=t.location_id;
 return true;
end $$;
REVOKE ALL ON FUNCTION studio.studio_apply_mac_transcript(text,uuid) FROM PUBLIC;

CREATE FUNCTION studio.studio_video_apply_on_finish() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.status in ('ready','partial') and old.status in ('queued','running') and not new.transcript_applied and new.origin in ('paste','search','suggestion') then
  perform studio.studio_apply_mac_transcript(new.location_id,new.id);
 end if;
 return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_apply_on_finish() FROM PUBLIC;
CREATE TRIGGER studio_video_apply_on_finish AFTER UPDATE OF status ON studio.studio_video_transcriptions FOR EACH ROW EXECUTE FUNCTION studio.studio_video_apply_on_finish();

-- Apply the newest finished explicit run of each source that was left unapplied.
select studio.studio_apply_mac_transcript(x.location_id,x.id) from (
 select distinct on (location_id,record_id) location_id,id,record_id,transcript_applied,origin from studio.studio_video_transcriptions
 where status in ('ready','partial') and method='local-parakeet-tdt-v3-4bit' order by location_id,record_id,completed_at desc nulls last) x
where not x.transcript_applied and x.origin in ('paste','search','suggestion');
