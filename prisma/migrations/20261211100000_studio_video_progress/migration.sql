-- Live progress for a Mac transcription: the phase, an honest percentage when the Mac can measure one, and when the phase began.
ALTER TABLE studio.studio_video_transcriptions ADD COLUMN progress jsonb;

CREATE FUNCTION studio.studio_video_report_progress(p_token_hash text,p_app text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; t studio.studio_video_transcriptions%rowtype; ph text; pct integer; det text;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 ph:=p_body->>'phase'; det:=left(coalesce(p_body->>'detail',''),160);
 pct:=case when coalesce(p_body->>'percent','') ~ '^[0-9]{1,3}$' then least((p_body->>'percent')::integer,100) else null end;
 if ph is null or ph not in ('info','download','transcribe','captions','save','slides_scan','slides_read','slides_save') then raise exception 'Invalid progress' using errcode='22023'; end if;
 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and kind='studio.video_transcribe' and status='running'
  and lease_owner=p_body->>'workerId' and lease_token=(p_body->>'leaseToken')::uuid and lease_expires_at>clock_timestamp();
 if not found then return 'false'::jsonb; end if;
 select * into t from studio.studio_video_transcriptions where location_id=d.location_id and id=(j.payload->>'transcriptionId')::uuid and job_id=j.id for update;
 if not found then return 'false'::jsonb; end if;
 update studio.studio_video_transcriptions set updated_at=clock_timestamp(),progress=jsonb_build_object('phase',ph,'percent',pct,'detail',det,'at',clock_timestamp(),
   'since',case when t.progress->>'phase'=ph then coalesce(t.progress->>'since',clock_timestamp()::text) else clock_timestamp()::text end) where id=t.id;
 return 'true'::jsonb;
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_report_progress(text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_video_report_progress(text,text,jsonb,text) TO service_role;
