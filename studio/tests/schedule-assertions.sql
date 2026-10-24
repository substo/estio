do $$
declare
  w uuid := '81000000-0000-4000-8000-000000000001';
  other_w uuid := '81000000-0000-4000-8000-000000000002';
  sid uuid := '82000000-0000-4000-8000-000000000001';
  r public.studio_schedules%rowtype;
begin
  if has_table_privilege('anon','public.studio_schedules','SELECT')
    or has_table_privilege('authenticated','public.studio_schedules','SELECT')
    or has_table_privilege('service_role','public.studio_schedules','INSERT')
    or has_table_privilege('service_role','public.studio_schedules','UPDATE')
    or has_table_privilege('service_role','public.studio_schedules','DELETE')
    or not has_table_privilege('service_role','public.studio_schedules','SELECT')
    or has_function_privilege('authenticated','public.studio_save_schedule(uuid,uuid,bigint,text,text,text,text,integer,text)','EXECUTE')
    or has_function_privilege('anon','public.studio_save_schedule(uuid,uuid,bigint,text,text,text,text,integer,text)','EXECUTE')
    or not has_function_privilege('service_role','public.studio_save_schedule(uuid,uuid,bigint,text,text,text,text,integer,text)','EXECUTE')
    or not (select relrowsecurity from pg_class where oid = 'public.studio_schedules'::regclass) then
    raise exception 'Unsafe schedule grants/RLS';
  end if;
  perform public.studio_create_substo_workspace(w,'Schedule fixture','schedule-owner');
  perform public.studio_create_substo_workspace(other_w,'Other schedule fixture','other-owner');
  r := public.studio_save_schedule(w,sid,0,'substo','schedule-owner','idea-review','  exact focus  ',24,'09:00');
  if r.version <> 1 or r.focus <> '  exact focus  ' or r.time_zone <> 'Asia/Nicosia' or r.updated_by <> 'schedule-owner' then
    raise exception 'Schedule creation lost definition or attribution';
  end if;
  begin
    perform public.studio_save_schedule(w,sid,0,'substo','schedule-owner','idea-review','overwrite',24,'09:00');
    raise exception 'Duplicate create overwrote draft';
  exception when serialization_failure then null; end;
  begin
    perform public.studio_save_schedule(w,sid,1,'estio','schedule-owner','idea-review','wrong realm',24,'09:00');
    raise exception 'Wrong realm accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.studio_save_schedule(w,sid,1,'substo','other-owner','idea-review','outsider',24,'09:00');
    raise exception 'Nonmember accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.studio_save_schedule(other_w,sid,1,'substo','other-owner','idea-review','cross workspace',24,'09:00');
    raise exception 'Cross-workspace update accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.studio_save_schedule(w,sid,1,'substo','schedule-owner','idea-review','bad time',24,'24:00');
    raise exception 'Bad daily time accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.studio_save_schedule(w,sid,1,'substo','schedule-owner','video-reading','bad preset',24,'09:00');
    raise exception 'Unsupported preset accepted';
  exception when invalid_parameter_value then null; end;
  r := public.studio_save_schedule(w,sid,1,'substo','schedule-owner','script-brief','weekly',168,'10:30');
  if r.version <> 2 or r.interval_hours <> 168 or r.preset_id <> 'script-brief' then raise exception 'Schedule update failed'; end if;
  begin
    perform public.studio_save_schedule(w,sid,1,'substo','schedule-owner','idea-review','stale',24,'09:00');
    raise exception 'Stale update accepted';
  exception when serialization_failure then null; end;
  delete from public.studio_workspace_memberships where workspace_id = w and clerk_user_id = 'schedule-owner';
  begin
    perform public.studio_save_schedule(w,sid,2,'substo','schedule-owner','idea-review','revoked',24,'09:00');
    raise exception 'Revoked member accepted';
  exception when insufficient_privilege then null; end;
  if (select version from public.studio_schedules where workspace_id = w and id = sid) <> 2 then raise exception 'Failed save changed version'; end if;
end;
$$;
select 'Studio schedule assertions passed' as result;
