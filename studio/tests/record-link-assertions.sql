do $$
declare
 w uuid := '61000000-0000-4000-8000-000000000001';
 other_w uuid := '61000000-0000-4000-8000-000000000002';
 estio_w uuid := '61000000-0000-4000-8000-000000000003';
 source uuid := '62000000-0000-4000-8000-000000000001';
 target uuid := '62000000-0000-4000-8000-000000000002';
 foreign_target uuid := '62000000-0000-4000-8000-000000000003';
 large_source uuid := '62000000-0000-4000-8000-000000000004';
 original jsonb := '{"transcript":" Exact words\n untouched ","discovery":{"kind":"recommendation","unknown":true},"linkedIds":[]}'::jsonb;
 result jsonb; relation text; operation text;
begin
 foreach relation in array array['studio_records','studio_record_links','studio_record_link_events'] loop
   foreach operation in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
     if has_table_privilege('service_role','public.'||relation,operation) then raise exception 'Unsafe direct record/link write'; end if;
   end loop;
   if not has_table_privilege('service_role','public.'||relation,'SELECT')
     or has_table_privilege('anon','public.'||relation,'SELECT')
     or has_table_privilege('authenticated','public.'||relation,'SELECT') then raise exception 'Unsafe record/link reads'; end if;
 end loop;
 if has_function_privilege('service_role','public.studio_save_record_fields(uuid,uuid,text,text,jsonb,bigint,text)','EXECUTE')
   or has_function_privilege('anon','public.studio_change_record_link(uuid,uuid,uuid,text,bigint,text,text)','EXECUTE')
   or has_function_privilege('authenticated','public.studio_change_record_link(uuid,uuid,uuid,text,bigint,text,text)','EXECUTE')
   or not has_function_privilege('service_role','public.studio_change_record_link(uuid,uuid,uuid,text,bigint,text,text)','EXECUTE')
   or not (select relrowsecurity from pg_class where oid='public.studio_record_link_events'::regclass) then raise exception 'Unsafe link RPC/RLS grants'; end if;
 perform public.studio_create_substo_workspace(w,'Link fixture','link-owner');
 perform public.studio_create_substo_workspace(other_w,'Other link fixture','other-owner');
 insert into public.studio_workspaces(id,brand,workspace_type,name,estio_location_id) values(estio_w,'estio','estio_location','Estio links','link-location');
 perform public.studio_save_record(w,source,'content','Content','{"transcript":" Exact words\n untouched ","discovery":{"kind":"recommendation","unknown":true}}',0,'link-owner');
 update public.studio_records set legacy_payload=original where workspace_id=w and id=source;
 perform public.studio_save_record(w,target,'channel','Channel','{}',0,'link-owner');
 perform public.studio_save_record(other_w,foreign_target,'reference','Private foreign source','{}',0,'other-owner');
 begin perform public.studio_change_record_link(w,source,target,'add',1,'substo','other-owner'); raise exception 'Nonmember linked records'; exception when insufficient_privilege then null; end;
 begin perform public.studio_change_record_link(w,source,target,'add',1,'estio','link-owner'); raise exception 'Wrong-brand link accepted'; exception when insufficient_privilege then null; end;
 begin perform public.studio_change_record_link(w,source,source,'add',1,'substo','link-owner'); raise exception 'Self-link accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.studio_change_record_link(w,source,foreign_target,'add',1,'substo','link-owner'); raise exception 'Foreign target accepted'; exception when no_data_found then null; end;
 begin perform public.studio_save_record(w,source,'content','Tampered','{"linkedIds":[]}',1,'link-owner'); raise exception 'Ordinary field patch changed links'; exception when invalid_parameter_value then null; end;
 result := public.studio_change_record_link(w,source,target,'add',1,'substo','link-owner');
 if result->'changed' <> 'true'::jsonb or result->>'version' <> '2'
   or (select payload->'linkedIds' from public.studio_records where workspace_id=w and id=source) is distinct from jsonb_build_array(target::text)
   or (select legacy_payload from public.studio_records where workspace_id=w and id=source) is distinct from original
   or (select payload->>'transcript' from public.studio_records where workspace_id=w and id=source) is distinct from original->>'transcript'
   or (select payload->'discovery' from public.studio_records where workspace_id=w and id=source) is distinct from original->'discovery'
   or exists(select 1 from public.studio_record_links where workspace_id=w and source_id=target and target_id=source)
   or not exists(select 1 from public.studio_record_link_events where workspace_id=w and source_id=source and target_id=target and action='add' and record_version=2 and actor_clerk_user_id='link-owner' and actor_brand='substo') then raise exception 'Link add lost direction/provenance/audit'; end if;
 begin perform public.studio_change_record_link(w,source,target,'remove',1,'substo','link-owner'); raise exception 'Stale link changed record'; exception when serialization_failure then null; end;
 begin perform public.studio_save_record(w,source,'content','Stale','{}',1,'link-owner'); raise exception 'Stale field edit overwrote link version'; exception when serialization_failure then null; end;
 perform public.studio_save_record(w,source,'content','Edited fields','{"notes":"new"}',2,'link-owner');
 result := public.studio_change_record_link(w,source,target,'add',3,'substo','link-owner');
 if result->'changed' <> 'false'::jsonb or result->>'version' <> '3'
   or (select count(*) from public.studio_record_link_events where workspace_id=w and source_id=source) <> 1 then raise exception 'No-op link changed version/history'; end if;
 -- Add an explicit reverse edge, which must survive unlinking source -> target.
 perform public.studio_change_record_link(w,target,source,'add',1,'substo','link-owner');
 alter table public.studio_record_link_events add constraint forced_link_audit_failure check (action <> 'remove') not valid;
 begin perform public.studio_change_record_link(w,source,target,'remove',3,'substo','link-owner'); raise exception 'Audit failure accepted'; exception when check_violation then null; end;
 if (select version from public.studio_records where workspace_id=w and id=source) <> 3
   or not exists(select 1 from public.studio_record_links where workspace_id=w and source_id=source and target_id=target) then raise exception 'Failed audit left partial link edit'; end if;
 alter table public.studio_record_link_events drop constraint forced_link_audit_failure;
 result := public.studio_change_record_link(w,source,target,'remove',3,'substo','link-owner');
 if result->>'version' <> '4'
   or (select payload->'linkedIds' from public.studio_records where workspace_id=w and id=source) is distinct from '[]'::jsonb
   or not exists(select 1 from public.studio_record_links where workspace_id=w and source_id=target and target_id=source)
   or (select count(*) from public.studio_records where workspace_id=w and id in (source,target)) <> 2
   or (select legacy_payload from public.studio_records where workspace_id=w and id=source) is distinct from original then raise exception 'Unlink changed records, incoming edge or provenance'; end if;
 result := public.studio_change_record_link(w,source,target,'remove',4,'substo','link-owner');
 if result->'changed' <> 'false'::jsonb or result->>'version' <> '4' then raise exception 'Missing-edge removal changed version'; end if;

 -- Larger legacy imports are not truncated; removal works even above the add cap.
 perform public.studio_save_record(w,large_source,'reference','Large imported source','{}',0,'link-owner');
 insert into public.studio_records(workspace_id,id,kind,title,payload)
   select w,md5('link-fixture-target-'||n)::uuid,'reference','Target '||n,'{}'::jsonb from generate_series(1,101) n;
 insert into public.studio_record_links(workspace_id,source_id,target_id)
   select w,large_source,md5('link-fixture-target-'||n)::uuid from generate_series(1,101) n;
 begin perform public.studio_change_record_link(w,large_source,target,'add',1,'substo','link-owner'); raise exception 'Add cap bypassed'; exception when invalid_parameter_value then null; end;
 perform public.studio_change_record_link(w,large_source,md5('link-fixture-target-1')::uuid,'remove',1,'substo','link-owner');
 if (select count(*) from public.studio_record_links where workspace_id=w and source_id=large_source) <> 100 then raise exception 'Legacy links were truncated'; end if;
 delete from public.studio_workspace_memberships where workspace_id=w and clerk_user_id='link-owner';
 begin perform public.studio_change_record_link(w,source,target,'add',4,'substo','link-owner'); raise exception 'Revoked member linked records'; exception when insufficient_privilege then null; end;
 -- Estio's separately verified location authority is supplied by the server.
 perform public.studio_save_record(estio_w,source,'reference','Estio source','{}',0,'estio-user');
 perform public.studio_save_record(estio_w,target,'content','Estio content','{}',0,'estio-user');
 result := public.studio_change_record_link(estio_w,source,target,'add',1,'estio','estio-user');
 if result->>'version' <> '2' then raise exception 'Estio authorized link failed'; end if;
end;
$$;
select 'Studio record link assertions passed' as result;

-- Exercise the deployed service-role boundary, not only the migration owner.
set role service_role;
do $$
begin
  perform public.studio_save_record('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001',
    'reference','Service field edit','{"notes":"service fixture"}',2,'estio-user');
  perform public.studio_change_record_link('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000002','remove',3,'estio','estio-user');
  begin
    update public.studio_records set payload='{}' where false;
    raise exception 'Service role bypassed record RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform public.studio_save_record_fields('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001',
      'reference','Bypass','{}',4,'estio-user');
    raise exception 'Service role called private field writer';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'Studio record link service-role boundary assertions passed' as result;
