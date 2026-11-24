-- Two small Studio pieces.
-- 1. Discard unfinished uploads: remove only the caller's own reserved-but-never-finished uploads of one record. A finished upload, an export or a narration clip is never touched.
-- 2. A private profile photo per user and Location, used only as the stand-in picture on storyboard placeholders while a video is made. Metadata only; the image lives in private storage under a key derived by the app.

CREATE FUNCTION studio.studio_discard_unfinished_uploads(p_location_id text, p_actor_app text, p_clerk_user_id text, p_record_id uuid, p_upload_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare r jsonb;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 with gone as (
  delete from studio.studio_uploads u
   where u.location_id=p_location_id and u.record_id=p_record_id
     and u.status='awaiting_upload' and u.media_object_id is null and u.uploaded_at is null
     and u.created_by_clerk_user_id=p_clerk_user_id
     and (p_upload_id is null or u.id=p_upload_id)
  returning u.id,u.object_key)
 select jsonb_build_object('discarded',count(*),'objects',coalesce(jsonb_agg(jsonb_build_object('id',id,'key',object_key)),'[]'::jsonb)) into r from gone;
 return r;
end $$;

CREATE TABLE studio.studio_avatars (
  location_id text NOT NULL REFERENCES public."Location"(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (location_id, clerk_user_id)
);
ALTER TABLE studio.studio_avatars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON studio.studio_avatars FROM PUBLIC;

CREATE FUNCTION studio.studio_set_avatar(p_location_id text, p_actor_app text, p_clerk_user_id text, p_content_type text, p_byte_size integer, p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_content_type is null or p_content_type not in ('image/jpeg','image/png','image/webp') then raise exception 'Use a JPEG, PNG or WebP photo' using errcode='22023'; end if;
 if p_byte_size is null or p_byte_size not between 1 and 5242880 then raise exception 'The photo must be up to 5 MB' using errcode='22023'; end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid photo checksum' using errcode='22023'; end if;
 insert into studio.studio_avatars(location_id,clerk_user_id,content_type,byte_size,sha256) values(p_location_id,p_clerk_user_id,p_content_type,p_byte_size,p_sha256)
  on conflict (location_id,clerk_user_id) do update set content_type=excluded.content_type,byte_size=excluded.byte_size,sha256=excluded.sha256,updated_at=clock_timestamp();
 return jsonb_build_object('contentType',p_content_type,'byteSize',p_byte_size);
end $$;

CREATE FUNCTION studio.studio_get_avatar(p_location_id text, p_actor_app text, p_clerk_user_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare a studio.studio_avatars%rowtype;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 select * into a from studio.studio_avatars where location_id=p_location_id and clerk_user_id=p_clerk_user_id;
 if not found then return null; end if;
 return jsonb_build_object('contentType',a.content_type,'byteSize',a.byte_size,'updatedAt',a.updated_at);
end $$;

CREATE FUNCTION studio.studio_remove_avatar(p_location_id text, p_actor_app text, p_clerk_user_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare n integer;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 delete from studio.studio_avatars where location_id=p_location_id and clerk_user_id=p_clerk_user_id;
 get diagnostics n = row_count;
 return n > 0;
end $$;

-- The claim wrapper reads the job owner's photo metadata. Only the claim path calls it, with the job's own Location and creator.
CREATE FUNCTION studio.studio_job_avatar(p_location_id text, p_clerk_user_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 select jsonb_build_object('contentType',a.content_type,'byteSize',a.byte_size) from studio.studio_avatars a where a.location_id=p_location_id and a.clerk_user_id=p_clerk_user_id
$$;

REVOKE ALL ON FUNCTION studio.studio_discard_unfinished_uploads(text,text,text,uuid,uuid),studio.studio_set_avatar(text,text,text,text,integer,text),studio.studio_get_avatar(text,text,text),studio.studio_remove_avatar(text,text,text),studio.studio_job_avatar(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_discard_unfinished_uploads(text,text,text,uuid,uuid),studio.studio_set_avatar(text,text,text,text,integer,text),studio.studio_get_avatar(text,text,text),studio.studio_remove_avatar(text,text,text),studio.studio_job_avatar(text,text) TO service_role;
