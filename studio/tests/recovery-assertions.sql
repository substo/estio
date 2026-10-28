-- Assertions on the restored disposable DB. Do not start web/worker/cron or release any holds.
do $$ begin
 if (select count(*) from studio.studio_ai_attempts where status='uncertain')<>1
 or (select count(*) from studio.studio_ai_usage where status='reserved')<>1
 or (select count(*) from studio.studio_jobs where status='queued')<>1
 or (select count(*) from studio.platform_google_youtube_connections where clerk_user_id='user_recovery_fixture')<>2
 or (select count(*) from studio.platform_profile_deletions where clerk_user_id='user_recovery_deleted')<>1
 or (select payload->>'script' from studio.studio_records limit 1)<>'Preserve exact human text'
 then raise exception 'Restore lost ledger, profile realm, deletion fence or human content'; end if;
 if has_table_privilege('authenticated','studio.studio_records','select')
 or has_table_privilege('service_role','studio.studio_ai_attempts','insert')
 or has_function_privilege('authenticated','studio.studio_readiness_snapshot()','execute')
 or not (select relrowsecurity from pg_class where oid='studio.platform_google_youtube_connections'::regclass)
 then raise exception 'Restore lost private grants/RLS'; end if;
 if exists(select 1 from studio.studio_worker_heartbeats where healthy) then raise exception 'Quarantined restore has a ready worker'; end if;
end $$;
select 'Studio isolated database/media/key recovery assertions passed' as result;
