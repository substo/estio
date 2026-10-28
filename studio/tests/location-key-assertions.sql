-- Studio is keyed by the CRM Location ID; no workspace or brand names remain.
do $$
declare loc text := 'cm-location-key-test'; legacy uuid := 'ab000000-0000-4000-8000-000000000001';
begin
  if exists(select 1 from information_schema.columns where table_schema='studio' and (column_name ~ 'workspace|brand' or (column_name ~ 'location_id' and data_type <> 'text'))) then
    raise exception 'Workspace/brand column or non-text location_id remains';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='studio' and (p.proname ~ 'workspace|brand' or array_to_string(p.proargnames,',') ~ 'workspace|brand')) then
    raise exception 'Workspace/brand function or parameter remains';
  end if;
  if to_regclass('studio.studio_workspaces') is not null or to_regclass('studio.studio_location_invitations') is not null then
    raise exception 'Retired workspace tables remain';
  end if;
  if (studio.studio_readiness_snapshot()->>'schema')::int <> 29 then raise exception 'Readiness schema is not 29'; end if;

  perform studio.studio_create_substo_location(loc,'Location key test','key-owner');
  insert into studio.studio_media_objects(location_id,bucket_id,object_key,original_filename) values(loc,'studio-media', loc||'/uploads/new/original','new.bin');
  insert into studio.studio_media_objects(location_id,bucket_id,object_key,original_filename,legacy_key_prefix) values(loc,'studio-media', legacy::text||'/legacy-library/old','old.bin',legacy);
  begin
    insert into studio.studio_media_objects(location_id,bucket_id,object_key,original_filename) values(loc,'studio-media', legacy::text||'/legacy-library/other','other.bin');
    raise exception 'Foreign key prefix accepted';
  exception when check_violation then null; end;
  begin
    insert into studio.studio_media_objects(location_id,bucket_id,object_key,original_filename,legacy_key_prefix) values(loc,'studio-media', loc||'/x','x.bin',legacy);
    raise exception 'Current prefix accepted on a legacy row';
  exception when check_violation then null; end;
  delete from studio.studio_media_objects where location_id=loc;
  delete from studio.studio_locations where location_id=loc;
end;
$$;
