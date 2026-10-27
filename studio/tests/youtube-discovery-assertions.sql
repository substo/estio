do $$
declare
 w text := 'b1000000-0000-4000-8000-000000000001'; other_w text := 'b1000000-0000-4000-8000-000000000002';
 record_id uuid := 'b2000000-0000-4000-8000-000000000001'; result uuid;
 cipher jsonb := '{"ciphertext":"sealed","iv":"iv","authTag":"tag","keyId":"v1"}';
 scope text[] := array['https://www.googleapis.com/auth/youtube.readonly'];
 channel text := 'UCaaaaaaaaaaaaaaaaaaaaaa';
 principal text := 'same-user-id'; s text := repeat('a',64); sess text := repeat('b',64); table_name text;
begin
 foreach table_name in array array['platform_google_youtube_connections','platform_google_youtube_oauth_states','studio_youtube_channels','studio_youtube_usage','studio_youtube_bookmarks'] loop
   if has_table_privilege('anon','public.'||table_name,'SELECT') or has_table_privilege('authenticated','public.'||table_name,'SELECT')
     or has_table_privilege('service_role','public.'||table_name,'UPDATE') or has_table_privilege('service_role','public.'||table_name,'INSERT')
     or has_table_privilege('service_role','public.'||table_name,'DELETE')
     or not (select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass) then raise exception 'Unsafe YouTube grants'; end if;
 end loop;
 if has_function_privilege('anon','public.platform_youtube_oauth(text,text,text,text,text,jsonb,text,text[])','EXECUTE')
   or has_function_privilege('authenticated','public.studio_save_youtube_bookmark(text,text,text,uuid,text,text,jsonb)','EXECUTE') then raise exception 'Browser RPC exposed'; end if;
 -- Profiles require no location. The same Clerk ID in two realms is independent.
 perform public.platform_youtube_oauth('begin','substo',principal,sess,s);
 if public.platform_youtube_oauth('consume','estio',principal,sess,s) then raise exception 'Cross-realm state consumed'; end if;
 if public.platform_youtube_oauth('consume','substo',principal,repeat('c',64),s) then raise exception 'Wrong-session state consumed'; end if;
 if not public.platform_youtube_oauth('consume','substo',principal,sess,s) then raise exception 'State not consumed'; end if;
 if public.platform_youtube_oauth('consume','substo',principal,sess,s) then raise exception 'State replay accepted'; end if;
 begin perform public.platform_youtube_oauth('commit','substo',principal,sess,s,cipher,'client',array['gmail',null]); raise exception 'Invalid scopes accepted'; exception when invalid_parameter_value then null; end;
 if not public.platform_youtube_oauth('commit','substo',principal,sess,s,cipher,'client',scope) then raise exception 'Profile grant not stored'; end if;
 if public.platform_youtube_oauth('commit','substo',principal,sess,s,cipher,'client',scope) then raise exception 'Callback replay committed'; end if;
 perform public.platform_youtube_oauth('begin','estio',principal,sess,s);
 perform public.platform_youtube_oauth('consume','estio',principal,sess,s);
 perform public.platform_youtube_oauth('commit','estio',principal,sess,s,cipher,'other-client',scope);
 perform public.platform_clear_youtube_connection('substo',principal);
 if exists(select 1 from public.platform_google_youtube_connections where app='substo' and clerk_user_id=principal)
   or not exists(select 1 from public.platform_google_youtube_connections where app='estio' and clerk_user_id=principal) then raise exception 'Profile removal crossed realm'; end if;
 -- Removing a connection prevents an in-flight callback from committing later.
 perform public.platform_youtube_oauth('begin','substo',principal,sess,s);
 perform public.platform_youtube_oauth('consume','substo',principal,sess,s);
 perform public.platform_clear_youtube_connection('substo',principal);
 if public.platform_youtube_oauth('commit','substo',principal,sess,s,cipher,'client',scope) then raise exception 'Removed grant reconnected in flight'; end if;
 perform public.platform_youtube_oauth('begin','substo',principal,sess,s);
 update public.platform_google_youtube_oauth_states set expires_at=now()-interval '1 second' where app='substo' and clerk_user_id=principal;
 if public.platform_youtube_oauth('consume','substo',principal,sess,s) then raise exception 'Expired state accepted'; end if;

 perform public.studio_create_substo_location(w,'YT fixture','owner');
 perform public.studio_create_substo_location(other_w,'Other YT fixture','other-owner');
 insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role) values(w,'substo','member','member');
 begin perform public.studio_youtube_channel(w,'substo','member',channel,'User label',false); raise exception 'Member approved channel'; exception when insufficient_privilege then null; end;
 perform public.studio_youtube_channel(w,'substo','owner',channel,'User label',false);
 begin perform public.studio_youtube_request_slot(w,'estio','owner'); raise exception 'Wrong app used location'; exception when insufficient_privilege then null; end;
 for i in 1..50 loop if not public.studio_youtube_request_slot(w,'substo','member') then raise exception 'Quota denied early'; end if; end loop;
 if public.studio_youtube_request_slot(w,'substo','member') then raise exception 'Quota cap bypassed'; end if;
 result := public.studio_save_youtube_bookmark(w,'substo','member',record_id,'aB_cD-eF123','My own research title','{"kind":"public_search","query":"my query","rights":"research_link_only"}');
 if result<>record_id then raise exception 'Bookmark failed'; end if;
 perform public.studio_save_record(w,record_id,'reference','Edited title','{"notes":"Own exact notes"}',1,'member');
 result := public.studio_save_youtube_bookmark(w,'substo','member',gen_random_uuid(),'aB_cD-eF123','Later title','{"kind":"saved_url"}');
 if result<>record_id or (select title from public.studio_records where location_id=w and id=record_id)<>'Edited title'
   or (select payload->>'notes' from public.studio_records where location_id=w and id=record_id)<>'Own exact notes' then raise exception 'Duplicate bookmark overwrote edits'; end if;
 begin perform public.studio_save_youtube_bookmark(other_w,'substo','member',gen_random_uuid(),'aB_cD-eF123','Foreign','{"kind":"saved_url"}'); raise exception 'Foreign location bookmark accepted'; exception when insufficient_privilege then null; end;
 begin perform public.studio_save_youtube_bookmark(w,'substo','member',gen_random_uuid(),'aB_cD-eF124','Fake feed','{"kind":"recommendation"}'); raise exception 'Fake personalized provenance accepted'; exception when invalid_parameter_value then null; end;
 delete from public.studio_location_memberships where location_id=w and clerk_user_id='member';
 begin perform public.studio_save_youtube_bookmark(w,'substo','member',gen_random_uuid(),'aB_cD-eF124','Revoked','{"kind":"saved_url"}'); raise exception 'Revoked member saved'; exception when insufficient_privilege then null; end;
end;
$$;
select 'Profile YouTube and Studio discovery assertions passed' as result;
