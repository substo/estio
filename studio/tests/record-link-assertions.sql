do $$
declare
 w text := '61000000-0000-4000-8000-000000000001';
 other_w text := '61000000-0000-4000-8000-000000000002';
 estio_w text := '61000000-0000-4000-8000-000000000003';
 source uuid := '62000000-0000-4000-8000-000000000001';
 target uuid := '62000000-0000-4000-8000-000000000002';
 foreign_target uuid := '62000000-0000-4000-8000-000000000003';
 large_source uuid := '62000000-0000-4000-8000-000000000004';
 original jsonb := '{"transcript":" Exact words\n untouched ","discovery":{"kind":"recommendation","unknown":true},"linkedIds":[]}'::jsonb;
 result jsonb; relation text; operation text;
begin
 foreach relation in array array['studio_records','studio_record_links','studio_record_link_events'] loop
   foreach operation in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
     if has_table_privilege('service_role','studio.'||relation,operation) then raise exception 'Unsafe direct record/link write'; end if;
   end loop;
   if not has_table_privilege('service_role','studio.'||relation,'SELECT')
     or has_table_privilege('anon','studio.'||relation,'SELECT')
     or has_table_privilege('authenticated','studio.'||relation,'SELECT') then raise exception 'Unsafe record/link reads'; end if;
 end loop;
 if has_function_privilege('service_role','studio.studio_save_record_fields(text,uuid,text,text,jsonb,bigint,text)','EXECUTE')
   or has_function_privilege('anon','studio.studio_change_record_link(text,uuid,uuid,text,bigint,text,text)','EXECUTE')
   or has_function_privilege('authenticated','studio.studio_change_record_link(text,uuid,uuid,text,bigint,text,text)','EXECUTE')
   or not has_function_privilege('service_role','studio.studio_change_record_link(text,uuid,uuid,text,bigint,text,text)','EXECUTE')
   or not (select relrowsecurity from pg_class where oid='studio.studio_record_link_events'::regclass) then raise exception 'Unsafe link RPC/RLS grants'; end if;
 perform studio.studio_create_substo_location(w,'Link fixture','link-owner');
 perform studio.studio_create_substo_location(other_w,'Other link fixture','other-owner');
 insert into studio.studio_locations(location_id,app,name) values(estio_w,'estio','Estio links');
 perform studio.studio_save_record(w,source,'content','Content','{"transcript":" Exact words\n untouched ","discovery":{"kind":"recommendation","unknown":true}}',0,'link-owner');
 update studio.studio_records set legacy_payload=original where location_id=w and id=source;
 perform studio.studio_save_record(w,target,'channel','Channel','{}',0,'link-owner');
 perform studio.studio_save_record(other_w,foreign_target,'reference','Private foreign source','{}',0,'other-owner');
 begin perform studio.studio_change_record_link(w,source,target,'add',1,'substo','other-owner'); raise exception 'Nonmember linked records'; exception when insufficient_privilege then null; end;
 begin perform studio.studio_change_record_link(w,source,target,'add',1,'estio','link-owner'); raise exception 'Wrong-app link accepted'; exception when insufficient_privilege then null; end;
 begin perform studio.studio_change_record_link(w,source,source,'add',1,'substo','link-owner'); raise exception 'Self-link accepted'; exception when invalid_parameter_value then null; end;
 begin perform studio.studio_change_record_link(w,source,foreign_target,'add',1,'substo','link-owner'); raise exception 'Foreign target accepted'; exception when no_data_found then null; end;
 begin perform studio.studio_save_record(w,source,'content','Tampered','{"linkedIds":[]}',1,'link-owner'); raise exception 'Ordinary field patch changed links'; exception when invalid_parameter_value then null; end;
 result := studio.studio_change_record_link(w,source,target,'add',1,'substo','link-owner');
 if result->'changed' <> 'true'::jsonb or result->>'version' <> '2'
   or (select payload->'linkedIds' from studio.studio_records where location_id=w and id=source) is distinct from jsonb_build_array(target::text)
   or (select legacy_payload from studio.studio_records where location_id=w and id=source) is distinct from original
   or (select payload->>'transcript' from studio.studio_records where location_id=w and id=source) is distinct from original->>'transcript'
   or (select payload->'discovery' from studio.studio_records where location_id=w and id=source) is distinct from original->'discovery'
   or exists(select 1 from studio.studio_record_links where location_id=w and source_id=target and target_id=source)
   or not exists(select 1 from studio.studio_record_link_events where location_id=w and source_id=source and target_id=target and action='add' and record_version=2 and actor_clerk_user_id='link-owner' and actor_app='substo') then raise exception 'Link add lost direction/provenance/audit'; end if;
 begin perform studio.studio_change_record_link(w,source,target,'remove',1,'substo','link-owner'); raise exception 'Stale link changed record'; exception when serialization_failure then null; end;
 begin perform studio.studio_save_record(w,source,'content','Stale','{}',1,'link-owner'); raise exception 'Stale field edit overwrote link version'; exception when serialization_failure then null; end;
 perform studio.studio_save_record(w,source,'content','Edited fields','{"notes":"new"}',2,'link-owner');
 result := studio.studio_change_record_link(w,source,target,'add',3,'substo','link-owner');
 if result->'changed' <> 'false'::jsonb or result->>'version' <> '3'
   or (select count(*) from studio.studio_record_link_events where location_id=w and source_id=source) <> 1 then raise exception 'No-op link changed version/history'; end if;
 -- Add an explicit reverse edge, which must survive unlinking source -> target.
 perform studio.studio_change_record_link(w,target,source,'add',1,'substo','link-owner');
 alter table studio.studio_record_link_events add constraint forced_link_audit_failure check (action <> 'remove') not valid;
 begin perform studio.studio_change_record_link(w,source,target,'remove',3,'substo','link-owner'); raise exception 'Audit failure accepted'; exception when check_violation then null; end;
 if (select version from studio.studio_records where location_id=w and id=source) <> 3
   or not exists(select 1 from studio.studio_record_links where location_id=w and source_id=source and target_id=target) then raise exception 'Failed audit left partial link edit'; end if;
 alter table studio.studio_record_link_events drop constraint forced_link_audit_failure;
 result := studio.studio_change_record_link(w,source,target,'remove',3,'substo','link-owner');
 if result->>'version' <> '4'
   or (select payload->'linkedIds' from studio.studio_records where location_id=w and id=source) is distinct from '[]'::jsonb
   or not exists(select 1 from studio.studio_record_links where location_id=w and source_id=target and target_id=source)
   or (select count(*) from studio.studio_records where location_id=w and id in (source,target)) <> 2
   or (select legacy_payload from studio.studio_records where location_id=w and id=source) is distinct from original then raise exception 'Unlink changed records, incoming edge or provenance'; end if;
 result := studio.studio_change_record_link(w,source,target,'remove',4,'substo','link-owner');
 if result->'changed' <> 'false'::jsonb or result->>'version' <> '4' then raise exception 'Missing-edge removal changed version'; end if;

 -- Larger legacy imports are not truncated; removal works even above the add cap.
 perform studio.studio_save_record(w,large_source,'reference','Large imported source','{}',0,'link-owner');
 insert into studio.studio_records(location_id,id,kind,title,payload)
   select w,md5('link-fixture-target-'||n)::uuid,'reference','Target '||n,'{}'::jsonb from generate_series(1,101) n;
 insert into studio.studio_record_links(location_id,source_id,target_id)
   select w,large_source,md5('link-fixture-target-'||n)::uuid from generate_series(1,101) n;
 begin perform studio.studio_change_record_link(w,large_source,target,'add',1,'substo','link-owner'); raise exception 'Add cap bypassed'; exception when invalid_parameter_value then null; end;
 perform studio.studio_change_record_link(w,large_source,md5('link-fixture-target-1')::uuid,'remove',1,'substo','link-owner');
 if (select count(*) from studio.studio_record_links where location_id=w and source_id=large_source) <> 100 then raise exception 'Legacy links were truncated'; end if;
 delete from studio.studio_location_members where location_id=w and clerk_user_id='link-owner';
 begin perform studio.studio_change_record_link(w,source,target,'add',4,'substo','link-owner'); raise exception 'Revoked member linked records'; exception when insufficient_privilege then null; end;
 -- Estio's separately verified location authority is supplied by the server.
 perform studio.studio_save_record(estio_w,source,'reference','Estio source','{}',0,'estio-user');
 perform studio.studio_save_record(estio_w,target,'content','Estio content','{}',0,'estio-user');
 result := studio.studio_change_record_link(estio_w,source,target,'add',1,'estio','estio-user');
 if result->>'version' <> '2' then raise exception 'Estio authorized link failed'; end if;
end;
$$;
select 'Studio record link assertions passed' as result;

-- Exercise the deployed service-role boundary, not only the migration owner.
set role service_role;
do $$
begin
  perform studio.studio_save_record('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001',
    'reference','Service field edit','{"notes":"service fixture"}',2,'estio-user');
  perform studio.studio_change_record_link('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000002','remove',3,'estio','estio-user');
  begin
    update studio.studio_records set payload='{}' where false;
    raise exception 'Service role bypassed record RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform studio.studio_save_record_fields('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001',
      'reference','Bypass','{}',4,'estio-user');
    raise exception 'Service role called private field writer';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'Studio record link service-role boundary assertions passed' as result;
