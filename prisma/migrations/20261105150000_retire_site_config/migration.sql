-- Phase 6 of the business-data consolidation (documentation/business-data.md).
-- 1. SiteConfig ("SearchConfig") is retired: every value lives in Location, the settings documents or the Business
--    profile, copied by scripts/settings/retire-site-config.ts before this migration is deployed.
DROP TABLE IF EXISTS "SearchConfig";

-- 2. Studio's own OpenAI key table is unused since phase 4 (Studio uses the Location's encrypted key in settings).
--    Readiness no longer lists its key ids; its set/clear functions go with it.
CREATE OR REPLACE FUNCTION studio.studio_readiness_snapshot() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select pg_catalog.jsonb_build_object('schema',29,'protocol',1,'checkedAt',pg_catalog.statement_timestamp(),
  'keyIds',coalesce((select jsonb_agg(k) from (
   select refresh_cipher->>'keyId' from studio.platform_google_youtube_connections
  ) keys),'[]'::jsonb),
  'queue',pg_catalog.jsonb_build_object(
   'due',(select count(*) from studio.studio_jobs where status='queued' and run_after<=pg_catalog.statement_timestamp()),
   'oldestDueAt',(select min(run_after) from studio.studio_jobs where status='queued' and run_after<=pg_catalog.statement_timestamp()),
   'expiredLeases',(select count(*) from studio.studio_jobs where status='running' and lease_expires_at<=pg_catalog.statement_timestamp()),
   'uncertainAttempts',(select count(*) from studio.studio_ai_attempts where status='uncertain')),
  'workers',coalesce((select jsonb_agg(row_to_json(w)) from (
   select release,instance_id,protocol,handlers,healthy,draining,seen_at,started_at
   from studio.studio_worker_heartbeats where seen_at>pg_catalog.statement_timestamp()-interval '5 minutes'
   order by seen_at desc limit 100
  ) w),'[]'::jsonb));
$$;

DROP FUNCTION IF EXISTS studio.studio_set_ai_credential(text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS studio.studio_clear_ai_credential(text, text, text, text);
DROP TABLE IF EXISTS studio.studio_location_ai_credentials;
