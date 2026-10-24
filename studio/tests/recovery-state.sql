-- Private snapshot for the disposable recovery rehearsal. No plaintext credentials or customer row bodies in output.
set timezone='UTC';
create function pg_temp.recovery_state() returns jsonb language plpgsql as $$
declare t record; n bigint; h text; tables jsonb:='[]'; sequences jsonb:='[]'; called boolean;
begin
 for t in select relname from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relkind='r' order by relname collate "C" loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(row_to_json(x)::text,E''\n'' order by row_to_json(x)::text collate "C"),''''),''UTF8'')),''hex'') from public.%I x',t.relname) into n,h;
  tables:=tables||jsonb_build_array(jsonb_build_object('name',t.relname,'count',n,'sha256',h));
 end loop;
 for t in select relname from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relkind='S' order by relname collate "C" loop
  execute format('select last_value,is_called from public.%I',t.relname) into n,called;
  sequences:=sequences||jsonb_build_array(jsonb_build_object('name',t.relname,'lastValue',n,'isCalled',called));
 end loop;
 return jsonb_build_object('schema',(public.studio_readiness_snapshot()->>'schema')::integer,'tables',tables,'sequences',sequences,
  'relations',(select jsonb_agg(jsonb_build_object('name',relname,'kind',relkind,'rls',relrowsecurity,'forced',relforcerowsecurity, 'acl',case when relkind in ('r','S','v','m','f','p') then
    (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantor,a.grantee,a.privilege_type)
     from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a)
    else null end) order by relname collate "C") from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public'),
  'functions',(select jsonb_agg(jsonb_build_object('name',proname,'args',pg_get_function_identity_arguments(p.oid),'def',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'acl',proacl::text) order by proname collate "C",pg_get_function_identity_arguments(p.oid) collate "C") from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p where schemaname in ('public','storage')),
  'media',(select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'key',object_key,'byteSize',byte_size,'sha256',sha256) order by bucket_id,object_key),'[]') from public.studio_media_objects),
  'credentials',(select coalesce(jsonb_agg(probe order by probe::text collate "C"),'[]') from (
    select jsonb_build_object('scope','workspace','workspaceId',workspace_id,'cipher',jsonb_build_object('ciphertext',ciphertext,'iv',iv,'authTag',auth_tag,'keyId',key_id)) probe from public.studio_workspace_ai_credentials
    union all select jsonb_build_object('scope','profile','brand',brand,'userId',clerk_user_id,'cipher',refresh_cipher) from public.platform_google_youtube_connections
  ) c));
end $$;
select pg_temp.recovery_state();
