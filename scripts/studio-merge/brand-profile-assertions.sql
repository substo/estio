-- Disposable database only; no worker/provider is started. All rows roll back.
BEGIN;
DO $$
declare m record; a jsonb; b jsonb; request_id uuid:=gen_random_uuid(); job studio.studio_jobs%rowtype; outcome jsonb; usage_id uuid; snapshot jsonb:='{"answers":{"offer":"Synthetic fixture"},"excerpts":[],"scriptVersion":"v1"}';
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
 insert into studio.studio_location_ai_credentials(location_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
 values(m.location_id,'openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','fixture','test',m.clerk_user_id) on conflict(location_id,provider) do nothing;
 insert into studio.studio_location_ai_settings(location_id,monthly_budget_micros,updated_by_clerk_user_id) values(m.location_id,1000000,m.clerk_user_id)
 on conflict(location_id) do update set monthly_budget_micros=1000000;
 select * into job from studio.studio_claim_jobs('fixture:profile',1,120);
 outcome:=studio.studio_begin_text_run_attempt(m.location_id,(a->>'reviewId')::uuid,job.id,'fixture:profile',job.lease_token);
 if outcome->>'outcome'<>'started' then raise exception 'Expected reserved attempt'; end if;
 perform studio.studio_finish_text_run_attempt(m.location_id,(a->>'reviewId')::uuid,job.id,'fixture:profile',job.lease_token,(outcome->>'attempt_id')::uuid,
 '{"summary":"Fixture","audience":"Creators","offer":"Editing","tone":"Clear","useWords":[],"avoidWords":[],"pillars":[]}',100,200,'fixture_response','gpt-6-luna-standard-2026-10-23');
 if not exists(select 1 from studio.studio_ai_usage u join studio.studio_ai_attempts t on t.usage_id=u.id
 where t.id=(outcome->>'attempt_id')::uuid and u.status='settled' and u.cost_micros=110 and u.location_id=m.location_id) then raise exception 'Settlement failed'; end if;
 usage_id:=studio.studio_reserve_ai_spend(m.location_id,'openai','brand_profile',10000);
 perform studio.studio_release_ai_spend(m.location_id,usage_id);
 if not exists(select 1 from studio.studio_ai_usage where id=usage_id and status='released') then raise exception 'Release failed'; end if;
 perform studio.studio_validate_text_run_result('brand_profile','{"summary":"Fixture","audience":"Creators","offer":"Editing","tone":"Clear","useWords":[],"avoidWords":[],"pillars":[]}',snapshot);
 begin
  perform studio.studio_validate_text_run_result('brand_profile','{}',snapshot);
  raise exception 'Malformed result accepted';
 exception when invalid_parameter_value then null; end;
end $$;
ROLLBACK;
