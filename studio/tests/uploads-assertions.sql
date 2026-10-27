-- Synthetic fixtures only. Upload registration, completion, and transcript assembly.
do $$
declare
  w text := 'a1000000-0000-4000-8000-000000000001';
  other_w text := 'a1000000-0000-4000-8000-000000000002';
  rec uuid := 'a2000000-0000-4000-8000-000000000001';
  other_rec uuid := 'a2000000-0000-4000-8000-000000000002';
  up uuid := 'a3000000-0000-4000-8000-000000000001';
  u public.studio_uploads%rowtype; t public.studio_transcripts%rowtype; tbl text; op text;
begin
  foreach tbl in array array['studio_uploads','studio_transcript_chunks','studio_transcripts'] loop
    foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('service_role','public.'||tbl,op) then raise exception 'Unsafe direct write on %', tbl; end if;
    end loop;
  end loop;
  if has_function_privilege('authenticated','public.studio_create_upload(text,text,text,uuid,uuid,text,text,bigint,text)','EXECUTE')
    or has_function_privilege('service_role','public.studio_lock_location_member(text,text,text)','EXECUTE') then raise exception 'Unsafe upload grants'; end if;

  perform public.studio_create_substo_location(w,'Uploads fixture','up-owner');
  perform public.studio_create_substo_location(other_w,'Other uploads','up-other');
  insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role) values(w,'substo','up-member','member');
  insert into public.studio_records(location_id,id,kind,title,payload) values(w,rec,'content','Mine','{}'),(other_w,other_rec,'content','Theirs','{}');

  begin perform public.studio_create_upload(w,'substo','up-other',up,rec,'a.mp4','video/mp4',100,'studio-media'); raise exception 'Non-member created upload';
  exception when sqlstate '42501' then null; end;
  begin perform public.studio_create_upload(w,'substo','up-member',up,other_rec,'a.mp4','video/mp4',100,'studio-media'); raise exception 'Foreign record accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.studio_create_upload(w,'substo','up-member',up,rec,'a.html','text/html',100,'studio-media'); raise exception 'HTML accepted';
  exception when sqlstate '23514' then null; end;
  begin perform public.studio_create_upload(w,'substo','up-member',up,rec,'../a.mp4','video/mp4',100,'studio-media'); raise exception 'Path filename accepted';
  exception when sqlstate '23514' then null; end;
  begin perform public.studio_create_upload(w,'substo','up-member',up,rec,'a.mp4','video/mp4',5368709121,'studio-media'); raise exception 'Oversize accepted';
  exception when sqlstate '23514' then null; end;

  u := public.studio_create_upload(w,'substo','up-member',up,rec,'My video.mp4','video/mp4',100,'studio-media');
  if u.object_key <> w::text||'/uploads/'||up::text||'/original' or u.status <> 'awaiting_upload' then raise exception 'Unexpected upload %', row_to_json(u); end if;
  if (public.studio_create_upload(w,'substo','up-member',up,rec,'My video.mp4','video/mp4',100,'studio-media')).id <> up then raise exception 'Create not idempotent'; end if;
  begin perform public.studio_create_upload(w,'substo','up-member',up,rec,'My video.mp4','video/mp4',101,'studio-media'); raise exception 'Upload id reused';
  exception when sqlstate '23505' then null; end;

  begin perform public.studio_complete_upload(w,'substo','up-member',up,99); raise exception 'Wrong size completed';
  exception when sqlstate '22023' then null; end;
  begin perform public.studio_complete_upload(w,'substo','up-owner',up,100); raise exception 'Another member completed';
  exception when sqlstate '42501' then null; end;
  if exists(select 1 from public.studio_media_objects where location_id=w) or exists(select 1 from public.studio_jobs where location_id=w) then raise exception 'Failed completion left rows'; end if;
  u := public.studio_complete_upload(w,'substo','up-member',up,100);
  if u.status <> 'uploaded' or u.media_object_id is null or u.transcription_job_id is null then raise exception 'Completion incomplete'; end if;
  if (select kind||':'||(payload->>'uploadId')||':'||status from public.studio_jobs where id=u.transcription_job_id) <> 'studio.transcribe_upload:'||up::text||':queued' then raise exception 'Job not queued'; end if;
  if (public.studio_complete_upload(w,'substo','up-member',up,100)).transcription_job_id <> u.transcription_job_id then raise exception 'Completion not idempotent'; end if;
  if (select count(*) from public.studio_jobs where location_id=w) <> 1 then raise exception 'Duplicate jobs'; end if;

  perform public.studio_save_transcript_chunk(w,up,1,600,30,'whisper-1',' second part ','[{"start":600,"end":605,"text":"second"}]');
  perform public.studio_save_transcript_chunk(w,up,0,0,600,'whisper-1','First part.','[{"start":0,"end":5,"text":"First"}]');
  if public.studio_save_transcript_chunk(w,up,0,0,600,'whisper-1','different','[]') then raise exception 'Chunk overwritten'; end if;
  begin perform public.studio_save_transcript_chunk(other_w,up,2,0,1,'whisper-1','x','[]'); raise exception 'Cross-location chunk';
  exception when sqlstate '22023' then null; end;
  t := public.studio_save_transcript(w,up,'whisper-1','en',630);
  if t.text <> 'First part. second part' or jsonb_array_length(t.segments) <> 2 or t.segments->0->>'text' <> 'First' then raise exception 'Bad assembly %', row_to_json(t); end if;
  if (public.studio_save_transcript(w,up,'whisper-1','en',630)).created_at <> t.created_at then raise exception 'Transcript not idempotent'; end if;
end;
$$;
select 'Studio upload assertions passed' as result;
