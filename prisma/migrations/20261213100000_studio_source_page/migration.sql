-- Source page: what YouTube reported about a video (including its top comments, fetched once with the metadata),
-- the owner's highlights per source (passed to the in-app agent as context), and a summary retry that works after a failure.
ALTER TABLE studio.studio_video_transcriptions ADD COLUMN source_meta jsonb;

CREATE FUNCTION studio.studio_video_save_meta(p_token_hash text,p_app text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; t studio.studio_video_transcriptions%rowtype;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if jsonb_typeof(p_body->'meta') is distinct from 'object' or octet_length((p_body->'meta')::text)>120000 then raise exception 'Invalid source details' using errcode='22023'; end if;
 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and kind='studio.video_transcribe' and status='running'
  and lease_owner=p_body->>'workerId' and lease_token=(p_body->>'leaseToken')::uuid and lease_expires_at>clock_timestamp();
 if not found then return 'false'::jsonb; end if;
 select * into t from studio.studio_video_transcriptions where location_id=d.location_id and id=(j.payload->>'transcriptionId')::uuid and job_id=j.id for update;
 if not found then return 'false'::jsonb; end if;
 update studio.studio_video_transcriptions set source_meta=p_body->'meta' where id=t.id;
 return 'true'::jsonb;
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_save_meta(text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_video_save_meta(text,text,jsonb,text) TO service_role;

CREATE TABLE studio.studio_source_highlights (
 location_id text NOT NULL, record_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind in ('summary','description','transcript','slide','comment')),
 item_key text NOT NULL CHECK (char_length(item_key) between 1 and 80),
 excerpt text NOT NULL CHECK (char_length(excerpt) between 1 and 600),
 at_seconds integer CHECK (at_seconds is null or at_seconds between 0 and 100000),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (location_id,record_id,kind,item_key),
 FOREIGN KEY (location_id,record_id) REFERENCES studio.studio_records(location_id,id) ON DELETE CASCADE
);
REVOKE ALL ON studio.studio_source_highlights FROM PUBLIC;

-- Toggles one highlight; returns true when the item is now highlighted.
CREATE FUNCTION studio.studio_toggle_source_highlight(p_location_id text,p_clerk_user_id text,p_record_id uuid,p_kind text,p_key text,p_excerpt text,p_at integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform 1 from studio.studio_records where location_id=p_location_id and id=p_record_id and kind='reference';
 if not found then raise exception 'Source unavailable' using errcode='P0002'; end if;
 delete from studio.studio_source_highlights where location_id=p_location_id and record_id=p_record_id and kind=p_kind and item_key=p_key;
 if found then return false; end if;
 if (select count(*) from studio.studio_source_highlights where location_id=p_location_id and record_id=p_record_id)>=100 then raise exception 'Too many highlights' using errcode='22023'; end if;
 insert into studio.studio_source_highlights(location_id,record_id,kind,item_key,excerpt,at_seconds,created_by) values(p_location_id,p_record_id,p_kind,p_key,left(btrim(p_excerpt),600),p_at,p_clerk_user_id);
 return true;
end $$;
REVOKE ALL ON FUNCTION studio.studio_toggle_source_highlight(text,text,uuid,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_toggle_source_highlight(text,text,uuid,text,text,text,integer) TO service_role;

-- Retry after a failed, stale or uncertain summary: unchanged evidence would otherwise be treated as already requested.
CREATE FUNCTION studio.studio_retry_library_summary(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 delete from studio.studio_library_summary_requests r where r.location_id=p_location_id and r.record_id=p_record_id
  and not exists(select 1 from studio.studio_jobs j where j.id=r.job_id and j.status in ('queued','running'));
 return studio.studio_request_library_summary(p_location_id,p_actor_app,p_clerk_user_id,p_record_id);
end $$;
REVOKE ALL ON FUNCTION studio.studio_retry_library_summary(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_retry_library_summary(text,text,text,uuid) TO service_role;
