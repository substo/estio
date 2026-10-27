-- Studio data is keyed by the CRM Location ID (`location_id text`); there is
-- no separate Studio workspace. Production databases created before this
-- change are converted once by
-- studio/supabase/conversions/20261027000000_studio_location_key.sql, which
-- ends in the same schema as applying every migration including this one.
begin;

-- Standalone Studio invitations were replaced by Location team invitations in
-- the CRM database; nothing calls these any more.
drop function public.studio_accept_substo_invitation(text, text, text);
drop table public.studio_location_invitations;

-- R2 object keys start with the owner's ID. Objects stored before the re-key
-- keep their original key, whose first segment is the retired workspace UUID.
alter table public.studio_media_objects add column legacy_key_prefix uuid;
alter table public.studio_media_objects drop constraint studio_media_objects_location_prefix_check;
alter table public.studio_media_objects add constraint studio_media_objects_location_prefix_check
  check (split_part(object_key, '/', 1) = coalesce(legacy_key_prefix::text, location_id) and btrim(object_key) <> '');

alter table public.studio_knowledge_media_links add column legacy_key_prefix uuid;
alter table public.studio_knowledge_media_links drop constraint studio_knowledge_media_links_check;
alter table public.studio_knowledge_media_links add constraint studio_knowledge_media_links_object_key_check
  check (object_key = coalesce(legacy_key_prefix::text, location_id) || '/legacy-knowledge/' || ref_kind || '/' || ref_id::text || '/' || sha256);

-- Schema 28: Location-keyed. Code for this schema refuses to run on an older one.
create or replace function public.studio_readiness_snapshot()
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object('schema',28,'protocol',1,'checkedAt',pg_catalog.statement_timestamp(),
  'keyIds',coalesce((select jsonb_agg(k) from (
   select key_id k from public.studio_location_ai_credentials union
   select refresh_cipher->>'keyId' from public.platform_google_youtube_connections
  ) keys),'[]'::jsonb),
  'queue',pg_catalog.jsonb_build_object(
   'due',(select count(*) from public.studio_jobs where status='queued' and run_after<=pg_catalog.statement_timestamp()),
   'oldestDueAt',(select min(run_after) from public.studio_jobs where status='queued' and run_after<=pg_catalog.statement_timestamp()),
   'expiredLeases',(select count(*) from public.studio_jobs where status='running' and lease_expires_at<=pg_catalog.statement_timestamp()),
   'uncertainAttempts',(select count(*) from public.studio_ai_attempts where status='uncertain')),
  'workers',coalesce((select jsonb_agg(row_to_json(w)) from (
   select release,instance_id,protocol,handlers,healthy,draining,seen_at,started_at
   from public.studio_worker_heartbeats where seen_at>pg_catalog.statement_timestamp()-interval '5 minutes'
   order by seen_at desc limit 100
  ) w),'[]'::jsonb));
$$;

commit;
