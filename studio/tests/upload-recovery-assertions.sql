-- Synthetic fixtures. Verify new replay binding without changing the paid worker/attempt contracts.
do $$
declare
 w text := 'f7100000-0000-4000-8000-000000000001'; r uuid := 'f7200000-0000-4000-8000-000000000001';
 u uuid := 'f7300000-0000-4000-8000-000000000001'; expired uuid := 'f7300000-0000-4000-8000-000000000002';
 original studio.studio_uploads; replay studio.studio_uploads;
begin
 perform studio.studio_create_substo_location(w,'Upload recovery','recovery-owner');
 insert into studio.studio_location_members(location_id,location_app,clerk_user_id,role) values(w,'substo','recovery-member','member');
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,r,'content','Recovery fixture','{}');
 original := studio.studio_create_upload(w,'substo','recovery-owner',u,r,'a.mp4','video/mp4',100,'studio-media');
 replay := studio.studio_create_upload(w,'substo','recovery-owner',u,r,'a.mp4','video/mp4',100,'studio-media');
 if replay is distinct from original then raise exception 'Registration replay changed metadata'; end if;
 begin perform studio.studio_create_upload(w,'substo','recovery-owner',u,r,'b.mp4','video/mp4',100,'studio-media'); raise exception 'Changed filename accepted'; exception when unique_violation then null; end;
 begin perform studio.studio_create_upload(w,'substo','recovery-owner',u,r,'a.mp4','video/mp4',100,'other-bucket'); raise exception 'Changed bucket accepted'; exception when unique_violation then null; end;
 begin perform studio.studio_create_upload(w,'substo','recovery-member',u,r,'a.mp4','video/mp4',100,'studio-media'); raise exception 'Different uploader replay accepted'; exception when unique_violation then null; end;
 begin perform studio.studio_complete_upload(w,'estio','recovery-owner',u,100); raise exception 'Wrong realm accepted'; exception when insufficient_privilege then null; end;
 original := studio.studio_complete_upload(w,'substo','recovery-owner',u,100);
 -- A lost finish response replays the exact saved media/job, even if the window has elapsed.
 update studio.studio_uploads set expires_at=now()-interval '8 hours' where id=u;
 replay := studio.studio_complete_upload(w,'substo','recovery-owner',u,100);
 if replay.transcription_job_id <> original.transcription_job_id or replay.media_object_id <> original.media_object_id then raise exception 'Finish duplicated work'; end if;
 begin perform studio.studio_complete_upload(w,'substo','recovery-member',u,100); raise exception 'Different uploader completed replay'; exception when insufficient_privilege then null; end;
 perform studio.studio_create_upload(w,'substo','recovery-owner',expired,r,'b.mp4','video/mp4',100,'studio-media');
 update studio.studio_uploads set expires_at=now()-interval '7 hours' where id=expired;
 begin perform studio.studio_complete_upload(w,'substo','recovery-owner',expired,100); raise exception 'Expired pending upload completed'; exception when invalid_parameter_value then null; end;
 if (select count(*) from studio.studio_media_objects where location_id=w)<>1 or (select count(*) from studio.studio_jobs where location_id=w)<>1 then raise exception 'Duplicate/orphan media or job'; end if;
 if exists(select 1 from studio.studio_ai_usage where location_id=w) then raise exception 'Recovery took paid hold'; end if;
 delete from studio.studio_location_members where location_id=w and clerk_user_id='recovery-owner';
 begin perform studio.studio_complete_upload(w,'substo','recovery-owner',u,100); raise exception 'Revoked member replay accepted'; exception when insufficient_privilege then null; end;
end $$;
select 'Studio upload recovery assertions passed' as result;
