-- A transcription cancelled from Jobs (or any path that only touches studio_jobs) must say so on its own row, with a reason the Source page can show.
-- Before this, the job was cancelled with no reason and the transcription stayed "queued" until the Mac's next claim relabelled it "Mac settings changed".
CREATE FUNCTION studio.studio_video_job_cancelled() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.status='cancelled' and old.status is distinct from 'cancelled' and new.kind='studio.video_transcribe' then
  if new.last_error_code is null then
   new.last_error_code:='video_cancelled';
   new.last_error_message:='Cancelled from Jobs before it finished. Transcribe again when you are ready.';
  end if;
  update studio.studio_video_transcriptions set status='cancelled',error_code=new.last_error_code,error_message=left(new.last_error_message,300),completed_at=clock_timestamp(),updated_at=clock_timestamp()
   where job_id=new.id and status in ('queued','running');
 end if;
 return new;
end $$;
REVOKE ALL ON FUNCTION studio.studio_video_job_cancelled() FROM PUBLIC;
CREATE TRIGGER studio_video_job_cancelled BEFORE UPDATE OF status ON studio.studio_jobs FOR EACH ROW EXECUTE FUNCTION studio.studio_video_job_cancelled();

-- Repair rows already mislabelled: the job was cancelled without a reason (a user cancel), but the row says the Mac settings changed.
update studio.studio_jobs set last_error_code='video_cancelled',last_error_message='Cancelled from Jobs before it finished. Transcribe again when you are ready.'
 where kind='studio.video_transcribe' and status='cancelled' and last_error_code is null;
update studio.studio_video_transcriptions x set error_code='video_cancelled',error_message='Cancelled from Jobs before it finished. Transcribe again when you are ready.'
 where x.status='cancelled' and x.error_code='video_mac_settings_changed'
  and exists(select 1 from studio.studio_jobs j where j.id=x.job_id and j.last_error_code='video_cancelled');
