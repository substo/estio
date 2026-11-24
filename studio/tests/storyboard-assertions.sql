-- Real SQL against an isolated PostgreSQL cluster. No credentials, network or providers.
-- Discard of unfinished uploads and the private storyboard avatar.
create function pg_temp.fails(sql text,code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then if sqlstate<>code then raise notice 'got % % wanted %',sqlstate,sqlerrm,code; end if; return sqlstate=code; end $$;
do $$
declare w text:='cd000000-0000-4000-8000-0000000000d1'; w2 text:='cd000000-0000-4000-8000-0000000000d2';
 rec uuid:=gen_random_uuid(); rec2 uuid:=gen_random_uuid(); fin uuid:=gen_random_uuid(); mo uuid; pend1 uuid:=gen_random_uuid(); pend2 uuid:=gen_random_uuid(); theirs uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
 bucket text:='studio-test-bucket'; r jsonb; sha text:=repeat('a',64);
begin
 perform studio.studio_create_substo_location(w,'Storyboard fixture','sb-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','sb-other');
 if has_function_privilege('authenticated','studio.studio_discard_unfinished_uploads(text,text,text,uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_set_avatar(text,text,text,text,integer,text)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_job_avatar(text,text)','EXECUTE')
  or not has_function_privilege('service_role','studio.studio_discard_unfinished_uploads(text,text,text,uuid,uuid)','EXECUTE')
  or not has_function_privilege('service_role','studio.studio_set_avatar(text,text,text,text,integer,text)','EXECUTE') then raise exception 'Unsafe storyboard grants'; end if;

 insert into studio.studio_records(location_id,id,kind,title,payload) values (w,rec,'content','Piece','{"script":"Hi."}'),(w,rec2,'content','Other piece','{"script":"Yo."}'),(w2,gen_random_uuid(),'content','Elsewhere','{"script":"Hey."}');
 -- A finished upload, two unfinished ones of this user, one unfinished one of a teammate, and one on another record.
 insert into studio.studio_media_objects(id,location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
  values(gen_random_uuid(),w,bucket,w||'/uploads/'||fin::text||'/original','shot.mp4','video/mp4',5000,repeat('1',64),'sb-owner') returning id into mo;
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,media_object_id,uploaded_at,created_by_clerk_user_id)
  values(fin,w,rec,'shot.mp4','video/mp4',5000,bucket,w||'/uploads/'||fin::text||'/original','uploaded',mo,now(),'sb-owner');
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,created_by_clerk_user_id) values
  (pend1,w,rec,'a.mp4','video/mp4',100,bucket,w||'/uploads/'||pend1::text||'/original','awaiting_upload','sb-owner'),
  (pend2,w,rec,'b.mp4','video/mp4',100,bucket,w||'/uploads/'||pend2::text||'/original','awaiting_upload','sb-owner'),
  (theirs,w,rec,'c.mp4','video/mp4',100,bucket,w||'/uploads/'||theirs::text||'/original','awaiting_upload','sb-teammate'),
  (other,w,rec2,'d.mp4','video/mp4',100,bucket,w||'/uploads/'||other::text||'/original','awaiting_upload','sb-owner');

 -- Fences: a stranger, another Location's member and the wrong record find nothing to discard or are refused.
 if not pg_temp.fails(format($q$select studio.studio_discard_unfinished_uploads(%L,'substo','sb-stranger',%L)$q$,w,rec),'42501') then raise exception 'A non-member discarded uploads'; end if;
 if not pg_temp.fails(format($q$select studio.studio_discard_unfinished_uploads(%L,'substo','sb-other',%L)$q$,w,rec),'42501') then raise exception 'Another tenant discarded uploads'; end if;

 -- One by id: only that row goes. Replaying it is a no-op.
 r:=studio.studio_discard_unfinished_uploads(w,'substo','sb-owner',rec,pend1);
 if (r->>'discarded')::int<>1 or r->'objects'->0->>'id'<>pend1::text or r->'objects'->0->>'key'<>w||'/uploads/'||pend1::text||'/original' then raise exception 'Single discard wrong: %',r; end if;
 if (studio.studio_discard_unfinished_uploads(w,'substo','sb-owner',rec,pend1)->>'discarded')::int<>0 then raise exception 'Replay not idempotent'; end if;
 -- Asking for a finished upload by id removes nothing.
 if (studio.studio_discard_unfinished_uploads(w,'substo','sb-owner',rec,fin)->>'discarded')::int<>0 or not exists(select 1 from studio.studio_uploads where id=fin and status='uploaded') then raise exception 'A finished upload was discarded'; end if;
 -- All of this user's unfinished uploads on this record: not the teammate's, not another record's, not the finished one.
 r:=studio.studio_discard_unfinished_uploads(w,'substo','sb-owner',rec);
 if (r->>'discarded')::int<>1 or r->'objects'->0->>'id'<>pend2::text then raise exception 'Discard all wrong: %',r; end if;
 if not exists(select 1 from studio.studio_uploads where id=theirs) or not exists(select 1 from studio.studio_uploads where id=other) or not exists(select 1 from studio.studio_uploads where id=fin) then raise exception 'Discard touched rows it does not own'; end if;

 -- Avatar: validated, per user, replaceable, removable, tenant-fenced.
 if studio.studio_get_avatar(w,'substo','sb-owner') is not null then raise exception 'Avatar existed before it was set'; end if;
 if not pg_temp.fails(format($q$select studio.studio_set_avatar(%L,'substo','sb-owner','image/gif',1000,%L)$q$,w,sha),'22023') then raise exception 'Non-image avatar accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_set_avatar(%L,'substo','sb-owner','image/png',5242881,%L)$q$,w,sha),'22023') then raise exception 'Oversize avatar accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_set_avatar(%L,'substo','sb-owner','image/png',1000,'xyz')$q$,w),'22023') then raise exception 'Bad checksum accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_set_avatar(%L,'substo','sb-stranger','image/png',1000,%L)$q$,w,sha),'42501') then raise exception 'A non-member set an avatar'; end if;
 perform studio.studio_set_avatar(w,'substo','sb-owner','image/png',1000,sha);
 perform studio.studio_set_avatar(w,'substo','sb-owner','image/jpeg',2000,repeat('b',64));
 r:=studio.studio_get_avatar(w,'substo','sb-owner');
 if r->>'contentType'<>'image/jpeg' or (r->>'byteSize')::int<>2000 then raise exception 'Avatar not replaced: %',r; end if;
 if (select count(*) from studio.studio_avatars where location_id=w)<>1 then raise exception 'More than one avatar per user'; end if;
 if studio.studio_job_avatar(w,'sb-owner')->>'contentType'<>'image/jpeg' or studio.studio_job_avatar(w,'sb-stranger') is not null or studio.studio_job_avatar(w2,'sb-owner') is not null then raise exception 'Job avatar lookup is not fenced'; end if;
 if not studio.studio_remove_avatar(w,'substo','sb-owner') or studio.studio_remove_avatar(w,'substo','sb-owner') or studio.studio_get_avatar(w,'substo','sb-owner') is not null then raise exception 'Avatar removal wrong'; end if;
end $$;
