BEGIN;
-- Studio Bin: deleting a content piece or an uploaded video moves it to a bin for 30 days (soft delete). A nightly purge removes the stored files first, then these rows. Additive; nothing is removed here.
ALTER TABLE studio.studio_records ADD COLUMN deleted_at timestamptz;
ALTER TABLE studio.studio_uploads ADD COLUMN deleted_at timestamptz;
CREATE INDEX studio_records_binned_idx ON studio.studio_records (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX studio_uploads_binned_idx ON studio.studio_uploads (deleted_at) WHERE deleted_at IS NOT NULL;

-- Move one item to the bin. p_kind is 'content' or 'upload'. Returns false when it is not there or already binned.
CREATE FUNCTION studio.studio_bin_item(p_location_id text,p_actor_app text,p_clerk_user_id text,p_kind text,p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare n integer;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_kind='content' then
  update studio.studio_records set deleted_at=clock_timestamp() where location_id=p_location_id and id=p_id and kind='content' and deleted_at is null;
 elsif p_kind='upload' then
  update studio.studio_uploads set deleted_at=clock_timestamp() where location_id=p_location_id and id=p_id and status='uploaded' and deleted_at is null;
 else raise exception 'Invalid bin item' using errcode='22023'; end if;
 get diagnostics n = row_count;
 return n>0;
end $$;

-- Take one item back out of the bin. An upload cannot come back while its piece is still binned.
CREATE FUNCTION studio.studio_restore_bin_item(p_location_id text,p_actor_app text,p_clerk_user_id text,p_kind text,p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare n integer;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_kind='content' then
  update studio.studio_records set deleted_at=null where location_id=p_location_id and id=p_id and kind='content' and deleted_at is not null;
 elsif p_kind='upload' then
  if exists(select 1 from studio.studio_uploads u join studio.studio_records r on r.location_id=u.location_id and r.id=u.record_id where u.location_id=p_location_id and u.id=p_id and r.deleted_at is not null) then
   raise exception 'Restore the piece first' using errcode='BN002'; end if;
  update studio.studio_uploads set deleted_at=null where location_id=p_location_id and id=p_id and deleted_at is not null;
 else raise exception 'Invalid bin item' using errcode='22023'; end if;
 get diagnostics n = row_count;
 return n>0;
end $$;

-- What is in the bin, newest first. Uploads that belong to a binned piece travel with it and are not listed.
CREATE FUNCTION studio.studio_list_bin(p_location_id text,p_actor_app text,p_clerk_user_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 return coalesce((select jsonb_agg(x order by x->>'deletedAt' desc) from (
  select jsonb_build_object('kind','content','id',r.id,'name',r.title,'deletedAt',r.deleted_at,'detail',
    (select count(*) from studio.studio_uploads u where u.location_id=r.location_id and u.record_id=r.id and u.status='uploaded')) x
   from studio.studio_records r where r.location_id=p_location_id and r.kind='content' and r.deleted_at is not null
  union all
  select jsonb_build_object('kind','upload','id',u.id,'name',u.original_filename,'deletedAt',u.deleted_at,'detail',p.title)
   from studio.studio_uploads u join studio.studio_records p on p.location_id=u.location_id and p.id=u.record_id
   where u.location_id=p_location_id and u.deleted_at is not null and p.deleted_at is null
 ) s),'[]'::jsonb);
end $$;

-- Purge plan (server only): the items binned before the cutoff and every stored file each owns, so the server can remove the files first. Jobs carry their owner so the server can derive picture keys.
CREATE FUNCTION studio.studio_bin_purge_plan(p_cutoff timestamptz,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare out jsonb:='[]'::jsonb; it record; objs jsonb; jobs jsonb;
begin
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'Invalid limit' using errcode='22023'; end if;
 for it in
  select 'content'::text kind,r.location_id,r.id,r.deleted_at from studio.studio_records r where r.kind='content' and r.deleted_at is not null and r.deleted_at<=p_cutoff
  union all
  select 'upload',u.location_id,u.id,u.deleted_at from studio.studio_uploads u where u.deleted_at is not null and u.deleted_at<=p_cutoff
   and not exists(select 1 from studio.studio_records r where r.location_id=u.location_id and r.id=u.record_id and r.deleted_at is not null and r.deleted_at<=p_cutoff)
  order by 4 limit p_limit
 loop
  if it.kind='content' then
   select coalesce(jsonb_agg(distinct jsonb_build_object('bucket',b,'key',k)),'[]') into objs from (
     select u.bucket_id b,u.object_key k from studio.studio_uploads u where u.location_id=it.location_id and u.record_id=it.id
     union select m.bucket_id,m.object_key from studio.studio_uploads u join studio.studio_media_objects m on m.id=u.media_object_id and m.location_id=u.location_id where u.location_id=it.location_id and u.record_id=it.id
     union select m.bucket_id,m.object_key from studio.studio_legacy_files f join studio.studio_media_objects m on m.id=f.media_object_id and m.location_id=f.location_id where f.location_id=it.location_id and f.record_id=it.id
     union select fr.bucket_id,fr.object_key from studio.studio_video_transcriptions t join studio.studio_video_frames fr on fr.location_id=t.location_id and fr.transcription_id=t.id where t.location_id=it.location_id and t.record_id=it.id and fr.bucket_id is not null
   ) o;
   select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'userId',j.created_by_clerk_user_id,'files',coalesce(j.result->'files','[]'::jsonb))),'[]') into jobs from studio.studio_jobs j
    where j.location_id=it.location_id and j.kind='studio.character_sheet' and (j.payload->>'recordId'=it.id::text
      or j.payload->>'uploadId' in (select u.id::text from studio.studio_uploads u where u.location_id=it.location_id and u.record_id=it.id));
  else
   select coalesce(jsonb_agg(distinct jsonb_build_object('bucket',b,'key',k)),'[]') into objs from (
     select u.bucket_id b,u.object_key k from studio.studio_uploads u where u.location_id=it.location_id and u.id=it.id
     union select m.bucket_id,m.object_key from studio.studio_uploads u join studio.studio_media_objects m on m.id=u.media_object_id and m.location_id=u.location_id where u.location_id=it.location_id and u.id=it.id
   ) o;
   select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'userId',j.created_by_clerk_user_id,'files',coalesce(j.result->'files','[]'::jsonb))),'[]') into jobs from studio.studio_jobs j
    where j.location_id=it.location_id and j.kind='studio.character_sheet' and j.payload->>'uploadId'=it.id::text;
  end if;
  out:=out||jsonb_build_array(jsonb_build_object('kind',it.kind,'locationId',it.location_id,'id',it.id,'objects',objs,'jobs',jobs));
 end loop;
 return out;
end $$;

-- Remove the database rows of one purged item (server only, after its files are gone). Skips an item restored or re-binned later than the cutoff.
CREATE FUNCTION studio.studio_bin_purge_finish(p_kind text,p_location_id text,p_id uuid,p_cutoff timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare uploads uuid[]; media uuid[]; jobs uuid[]; m uuid;
begin
 if p_kind='content' then
  perform 1 from studio.studio_records where location_id=p_location_id and id=p_id and kind='content' and deleted_at<=p_cutoff for update;
  if not found then return false; end if;
  select coalesce(array_agg(id),'{}') into uploads from studio.studio_uploads where location_id=p_location_id and record_id=p_id;
 elsif p_kind='upload' then
  perform 1 from studio.studio_uploads where location_id=p_location_id and id=p_id and deleted_at<=p_cutoff for update;
  if not found then return false; end if;
  uploads:=array[p_id];
 else raise exception 'Invalid bin item' using errcode='22023'; end if;
 select coalesce(array_agg(distinct x),'{}') into media from (
  select media_object_id x from studio.studio_uploads where location_id=p_location_id and id=any(uploads) and media_object_id is not null
  union select f.media_object_id from studio.studio_legacy_files f where p_kind='content' and f.location_id=p_location_id and f.record_id=p_id and f.media_object_id is not null
  union select fr.media_object_id from studio.studio_video_transcriptions t join studio.studio_video_frames fr on fr.location_id=t.location_id and fr.transcription_id=t.id where p_kind='content' and t.location_id=p_location_id and t.record_id=p_id and fr.media_object_id is not null) y;
 select coalesce(array_agg(id),'{}') into jobs from studio.studio_jobs where location_id=p_location_id and kind='studio.character_sheet' and status<>'running'
  and ((p_kind='content' and payload->>'recordId'=p_id::text) or payload->>'uploadId' in (select unnest(uploads)::text));
 if p_kind='content' then
  delete from studio.studio_video_edit_messages where location_id=p_location_id and record_id=p_id;
  delete from studio.studio_narration_runs where location_id=p_location_id and record_id=p_id;
  delete from studio.studio_record_links where location_id=p_location_id and (source_id=p_id or target_id=p_id);
  delete from studio.studio_legacy_files where location_id=p_location_id and record_id=p_id;
 end if;
 delete from studio.studio_job_events where job_id=any(jobs);
 delete from studio.studio_jobs where id=any(jobs);
 delete from studio.studio_uploads where location_id=p_location_id and id=any(uploads);
 if p_kind='content' then delete from studio.studio_records where location_id=p_location_id and id=p_id; end if;
 foreach m in array media loop
  begin delete from studio.studio_media_objects where location_id=p_location_id and id=m;
  exception when foreign_key_violation then null; end;   -- still used by something else: keep the row
 end loop;
 return true;
end $$;

REVOKE ALL ON FUNCTION studio.studio_bin_item(text,text,text,text,uuid),studio.studio_restore_bin_item(text,text,text,text,uuid),studio.studio_list_bin(text,text,text),studio.studio_bin_purge_plan(timestamptz,integer),studio.studio_bin_purge_finish(text,text,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_bin_item(text,text,text,text,uuid),studio.studio_restore_bin_item(text,text,text,text,uuid),studio.studio_list_bin(text,text,text),studio.studio_bin_purge_plan(timestamptz,integer),studio.studio_bin_purge_finish(text,text,uuid,timestamptz) TO service_role;
COMMIT;
