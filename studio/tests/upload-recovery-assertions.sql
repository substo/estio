-- Synthetic fixtures. Verify new replay binding without changing the paid worker/attempt contracts.
do $$
declare
 w uuid := 'f7100000-0000-4000-8000-000000000001'; r uuid := 'f7200000-0000-4000-8000-000000000001';
 u uuid := 'f7300000-0000-4000-8000-000000000001'; expired uuid := 'f7300000-0000-4000-8000-000000000002';
 original public.studio_uploads; replay public.studio_uploads;
begin
 perform public.studio_create_substo_workspace(w,'Upload recovery','recovery-owner');
 insert into public.studio_workspace_memberships(workspace_id,workspace_brand,clerk_user_id,role) values(w,'substo','recovery-member','member');
 insert into public.studio_records(workspace_id,id,kind,title,payload) values(w,r,'content','Recovery fixture','{}');
 original := public.studio_create_upload(w,'substo','recovery-owner',u,r,'a.mp4','video/mp4',100,'studio-media');
 replay := public.studio_create_upload(w,'substo','recovery-owner',u,r,'a.mp4','video/mp4',100,'studio-media');
 if replay is distinct from original then raise exception 'Registration replay changed metadata'; end if;
 begin perform public.studio_create_upload(w,'substo','recovery-owner',u,r,'b.mp4','video/mp4',100,'studio-media'); raise exception 'Changed filename accepted'; exception when unique_violation then null; end;
 begin perform public.studio_create_upload(w,'substo','recovery-owner',u,r,'a.mp4','video/mp4',100,'other-bucket'); raise exception 'Changed bucket accepted'; exception when unique_violation then null; end;
 begin perform public.studio_create_upload(w,'substo','recovery-member',u,r,'a.mp4','video/mp4',100,'studio-media'); raise exception 'Different uploader replay accepted'; exception when unique_violation then null; end;
 begin perform public.studio_complete_upload(w,'estio','recovery-owner',u,100); raise exception 'Wrong realm accepted'; exception when insufficient_privilege then null; end;
 original := public.studio_complete_upload(w,'substo','recovery-owner',u,100);
 -- A lost finish response replays the exact saved media/job, even if the window has elapsed.
 update public.studio_uploads set expires_at=now()-interval '8 hours' where id=u;
 replay := public.studio_complete_upload(w,'substo','recovery-owner',u,100);
 if replay.transcription_job_id <> original.transcription_job_id or replay.media_object_id <> original.media_object_id then raise exception 'Finish duplicated work'; end if;
 begin perform public.studio_complete_upload(w,'substo','recovery-member',u,100); raise exception 'Different uploader completed replay'; exception when insufficient_privilege then null; end;
 perform public.studio_create_upload(w,'substo','recovery-owner',expired,r,'b.mp4','video/mp4',100,'studio-media');
 update public.studio_uploads set expires_at=now()-interval '7 hours' where id=expired;
 begin perform public.studio_complete_upload(w,'substo','recovery-owner',expired,100); raise exception 'Expired pending upload completed'; exception when invalid_parameter_value then null; end;
 if (select count(*) from public.studio_media_objects where workspace_id=w)<>1 or (select count(*) from public.studio_jobs where workspace_id=w)<>1 then raise exception 'Duplicate/orphan media or job'; end if;
 if exists(select 1 from public.studio_ai_usage where workspace_id=w) then raise exception 'Recovery took paid hold'; end if;
 delete from public.studio_workspace_memberships where workspace_id=w and clerk_user_id='recovery-owner';
 begin perform public.studio_complete_upload(w,'substo','recovery-owner',u,100); raise exception 'Revoked member replay accepted'; exception when insufficient_privilege then null; end;
end $$;
select 'Studio upload recovery assertions passed' as result;
