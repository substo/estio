do $$
declare
  a text := '10000000-0000-0000-0000-000000000001';
  b text := '10000000-0000-0000-0000-000000000002';
  e text := '10000000-0000-0000-0000-000000000003';
  r uuid := '20000000-0000-0000-0000-000000000001';
  t uuid := '20000000-0000-0000-0000-000000000002';
  v jsonb;
begin
  if has_table_privilege('anon','studio.studio_records','SELECT') or
     has_table_privilege('authenticated','studio.studio_locations','INSERT') or
     has_function_privilege('anon','studio.studio_save_record(text,uuid,text,text,jsonb,bigint,text)','EXECUTE') then
    raise exception 'Client grants expose Studio data';
  end if;
  perform studio.studio_create_substo_location(a,'Location A','owner-a');
  perform studio.studio_create_substo_location(a,'Location A','owner-a');
  if (select count(*) from studio.studio_location_members where location_id=a) <> 1 then raise exception 'Duplicate owner'; end if;
  begin
    perform studio.studio_create_substo_location(a,'Location A','attacker');
    raise exception 'A different creator stole an idempotency ID';
  exception when unique_violation then null; end;
  perform studio.studio_create_substo_location(b,'Location B','owner-b');
  insert into studio.studio_locations(location_id,app,name) values(e,'estio','Estio');

  v := studio.studio_save_record(a,r,'reference','Source','{"notes":"Original","discovery":{"kind":"search"},"transcript":"Words\nexactly"}',0,'owner-a');
  v := studio.studio_save_record(a,r,'reference','Source','{"notes":"Original","discovery":{"kind":"search"},"transcript":"Words\nexactly"}',0,'owner-a');
  if (v->>'version')::int <> 1 then raise exception 'Create retry changed version'; end if;
  v := studio.studio_save_record(a,r,'reference','Edited','{"notes":"Reviewed"}',1,'owner-a');
  if v->'payload'->>'transcript' <> E'Words\nexactly' or v->'payload'->'discovery'->>'kind' <> 'search' then raise exception 'Edit lost imported evidence'; end if;
  begin
    perform studio.studio_save_record(a,r,'reference','Stale','{}',1,'owner-a');
    raise exception 'Stale editor overwrote new record';
  exception when serialization_failure then null; end;
  perform studio.studio_save_record(b,t,'reference','Other location','{}',0,'owner-b');
  begin
    insert into studio.studio_record_links(location_id,source_id,target_id) values(a,r,t);
    raise exception 'Cross-location relationship accepted';
  exception when foreign_key_violation then null; end;

end;
$$;

select 'Studio schema assertions passed' as result;
