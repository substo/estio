do $$
declare
  a text := '10000000-0000-0000-0000-000000000001';
  b text := '10000000-0000-0000-0000-000000000002';
  e text := '10000000-0000-0000-0000-000000000003';
  r uuid := '20000000-0000-0000-0000-000000000001';
  t uuid := '20000000-0000-0000-0000-000000000002';
  v jsonb;
  membership uuid;
begin
  if has_table_privilege('anon','public.studio_records','SELECT') or
     has_table_privilege('authenticated','public.studio_locations','INSERT') or
     has_function_privilege('anon','public.studio_save_record(text,uuid,text,text,jsonb,bigint,text)','EXECUTE') then
    raise exception 'Client grants expose Studio data';
  end if;
  perform public.studio_create_substo_location(a,'Location A','owner-a');
  perform public.studio_create_substo_location(a,'Location A','owner-a');
  if (select count(*) from public.studio_location_memberships where location_id=a) <> 1 then raise exception 'Duplicate owner'; end if;
  begin
    perform public.studio_create_substo_location(a,'Location A','attacker');
    raise exception 'A different creator stole an idempotency ID';
  exception when unique_violation then null; end;
  perform public.studio_create_substo_location(b,'Location B','owner-b');
  insert into public.studio_locations(location_id,app,name) values(e,'estio','Estio');
  begin
    insert into public.studio_location_memberships(location_id,clerk_user_id) values(e,'owner-a');
    raise exception 'Standalone membership attached to Estio';
  exception when foreign_key_violation then null; end;

  v := public.studio_save_record(a,r,'reference','Source','{"notes":"Original","discovery":{"kind":"search"},"transcript":"Words\nexactly"}',0,'owner-a');
  v := public.studio_save_record(a,r,'reference','Source','{"notes":"Original","discovery":{"kind":"search"},"transcript":"Words\nexactly"}',0,'owner-a');
  if (v->>'version')::int <> 1 then raise exception 'Create retry changed version'; end if;
  v := public.studio_save_record(a,r,'reference','Edited','{"notes":"Reviewed"}',1,'owner-a');
  if v->'payload'->>'transcript' <> E'Words\nexactly' or v->'payload'->'discovery'->>'kind' <> 'search' then raise exception 'Edit lost imported evidence'; end if;
  begin
    perform public.studio_save_record(a,r,'reference','Stale','{}',1,'owner-a');
    raise exception 'Stale editor overwrote new record';
  exception when serialization_failure then null; end;
  perform public.studio_save_record(b,t,'reference','Other location','{}',0,'owner-b');
  begin
    insert into public.studio_record_links(location_id,source_id,target_id) values(a,r,t);
    raise exception 'Cross-location relationship accepted';
  exception when foreign_key_violation then null; end;

  insert into public.studio_location_invitations(location_id,email,token_hash,invited_by_clerk_user_id,expires_at)
    values(a,'Teammate@example.com','token-one','owner-a',now()+interval '1 day');
  membership := public.studio_accept_substo_invitation('token-one','teammate@example.com','member-a');
  if membership <> public.studio_accept_substo_invitation('token-one','teammate@example.com','member-a') then raise exception 'Invitation retry duplicated membership'; end if;
  begin
    perform public.studio_accept_substo_invitation('token-one','teammate@example.com','other-account');
    raise exception 'Invitation merged accounts by email';
  exception when insufficient_privilege then null; end;
  insert into public.studio_location_invitations(location_id,email,token_hash,invited_by_clerk_user_id,expires_at)
    values(a,'expired@example.com','token-expired','owner-a',now()-interval '1 second');
  begin
    perform public.studio_accept_substo_invitation('token-expired','expired@example.com','member-expired');
    raise exception 'Expired invitation accepted';
  exception when no_data_found then null; end;
end;
$$;

insert into storage.buckets(id,name,public) values('other','other',false);
insert into storage.objects(bucket_id) values('studio-media'),('other');
set role authenticated;
do $$
begin
  if (select count(*) from storage.objects where bucket_id='studio-media') <> 0 then raise exception 'Legacy policy exposes private Studio media'; end if;
  if (select count(*) from storage.objects where bucket_id='other') <> 1 then raise exception 'Studio policy broke another bucket'; end if;
  begin
    insert into storage.objects(bucket_id) values('studio-media');
    raise exception 'Client uploaded Studio media without server authorization';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'Studio schema assertions passed' as result;
