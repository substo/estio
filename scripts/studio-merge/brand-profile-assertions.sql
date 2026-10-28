-- Disposable database only; no worker/provider is started. All rows roll back.
BEGIN;
DO $$
declare m record; a jsonb; b jsonb; request_id uuid:=gen_random_uuid(); snapshot jsonb:='{"answers":{"offer":"Synthetic fixture"},"excerpts":[],"scriptVersion":"v1"}';
begin
 select * into m from studio.studio_location_members where role='owner' limit 1;
 if not found then raise exception 'Fixture requires an admin'; end if;
 begin
  perform studio.studio_enqueue_brand_profile(m.location_id,m.location_app,m.clerk_user_id,request_id,snapshot,false);
  raise exception 'Missing confirmation accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform studio.studio_enqueue_brand_profile(m.location_id,m.location_app,'unrelated-fixture-account',request_id,snapshot,true);
  raise exception 'Unrelated account accepted';
 exception when insufficient_privilege then null; end;
 a:=studio.studio_enqueue_brand_profile(m.location_id,m.location_app,m.clerk_user_id,request_id,snapshot,true);
 b:=studio.studio_enqueue_brand_profile(m.location_id,m.location_app,m.clerk_user_id,request_id,snapshot,true);
 if a<>b then raise exception 'Enqueue was not idempotent'; end if;
 begin
  perform studio.studio_enqueue_brand_profile(m.location_id,m.location_app,m.clerk_user_id,request_id,'{}',true);
  raise exception 'Changed retry accepted';
 exception when unique_violation then null; end;
 perform studio.studio_validate_text_run_result('brand_profile','{"summary":"Fixture","audience":"Creators","offer":"Editing","tone":"Clear","useWords":[],"avoidWords":[],"pillars":[]}',snapshot);
 begin
  perform studio.studio_validate_text_run_result('brand_profile','{}',snapshot);
  raise exception 'Malformed result accepted';
 exception when invalid_parameter_value then null; end;
end $$;
ROLLBACK;
