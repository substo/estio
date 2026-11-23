BEGIN;
-- Voices studio: descriptions and facet tags for the library, designed voices, and a Mac job that previews on-device speakers.
-- The device kind studio.voice_preview must already be granted in studio_devices.allowed_kinds by the edit-loop migration (this migration never touches allowed_kinds).

-- 1. Library metadata and the designed kind.
ALTER TABLE studio.studio_voices
  ADD COLUMN description text CHECK (description IS NULL OR char_length(description) <= 300),
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(tags) <= 12 AND array_to_string(tags,',') ~ '^([a-z]+:[a-z0-9_]{1,32}(,|$))*$');
ALTER TABLE studio.studio_voices DROP CONSTRAINT studio_voices_kind_check;
ALTER TABLE studio.studio_voices ADD CONSTRAINT studio_voices_kind_check CHECK (kind IN ('preset','clone','designed'));
ALTER TABLE studio.studio_voice_events DROP CONSTRAINT studio_voice_events_event_check;
ALTER TABLE studio.studio_voice_events ADD CONSTRAINT studio_voice_events_event_check CHECK (event IN ('cloned','designed','set_default','deleted','synced'));

-- 2. The library read returns the metadata.
CREATE OR REPLACE FUNCTION studio.studio_list_voices(p_location_id text,p_actor_app text,p_clerk_user_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 return coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'provider',v.provider,'providerVoiceId',v.provider_voice_id,'name',v.name,'kind',v.kind,'language',v.language,'persona',v.persona,'isDefault',v.is_default,'cloned',v.consent is not null,
    'description',v.description,'tags',to_jsonb(v.tags))
   order by v.is_default desc,v.provider,v.name) from studio.studio_voices v where v.location_id=p_location_id),'[]'::jsonb);
end $$;

-- 3. Sync also mirrors a provider's descriptions and tags.
CREATE OR REPLACE FUNCTION studio.studio_sync_voices(p_location_id text,p_actor_app text,p_clerk_user_id text,p_provider text,p_voices jsonb,p_prune boolean) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare e jsonb; n integer:=0; tg text[]; ds text;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if p_provider not in ('fish','elevenlabs','local') or jsonb_typeof(p_voices)<>'array' or jsonb_array_length(p_voices)>500 then raise exception 'Invalid voices' using errcode='22023'; end if;
 for e in select * from jsonb_array_elements(p_voices) loop
  if jsonb_typeof(e)<>'object' or coalesce(e->>'providerVoiceId','') !~ '^[A-Za-z0-9_-]{2,64}$' or e->>'kind' not in ('preset','clone') or char_length(btrim(coalesce(e->>'name','')))=0 then raise exception 'Invalid voice' using errcode='22023'; end if;
  if e ? 'tags' and (jsonb_typeof(e->'tags')<>'array' or jsonb_array_length(e->'tags')>12 or exists(select 1 from jsonb_array_elements(e->'tags') t where jsonb_typeof(t)<>'string' or (t#>>'{}') !~ '^[a-z]+:[a-z0-9_]{1,32}$')) then raise exception 'Invalid voice tags' using errcode='22023'; end if;
  if e ? 'description' and e->'description' is distinct from 'null'::jsonb and (jsonb_typeof(e->'description')<>'string' or char_length(e->>'description')>300) then raise exception 'Invalid voice description' using errcode='22023'; end if;
  tg:=case when e ? 'tags' then array(select jsonb_array_elements_text(e->'tags')) else null end;
  ds:=nullif(btrim(coalesce(e->>'description','')),'');
  insert into studio.studio_voices(location_id,provider,provider_voice_id,name,kind,language,description,tags,created_by_clerk_user_id)
   values(p_location_id,p_provider,e->>'providerVoiceId',left(btrim(e->>'name'),80),e->>'kind',nullif(e->>'language',''),ds,coalesce(tg,'{}'::text[]),p_clerk_user_id)
   on conflict (location_id,provider,provider_voice_id) do update set name=excluded.name,language=coalesce(excluded.language,studio.studio_voices.language),
     description=coalesce(excluded.description,studio.studio_voices.description),tags=case when tg is null then studio.studio_voices.tags else excluded.tags end;
  n:=n+1;
 end loop;
 if p_prune then
  delete from studio.studio_voices v where v.location_id=p_location_id and v.provider=p_provider
   and not exists(select 1 from jsonb_array_elements(p_voices) x where x->>'providerVoiceId'=v.provider_voice_id);
 end if;
 insert into studio.studio_voice_events(location_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,'synced',p_actor_app,p_clerk_user_id,jsonb_build_object('provider',p_provider,'count',n));
 return n;
end $$;

-- 4. A voice designed from a text description (no recording, so no consent statement; the provider account owns it).
CREATE FUNCTION studio.studio_record_designed_voice(p_location_id text,p_actor_app text,p_clerk_user_id text,p_provider text,p_provider_voice_id text,p_name text,p_description text,p_tags text[],p_language text,p_persona text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare v studio.studio_voices%rowtype; first_voice boolean;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if p_provider not in ('fish','elevenlabs') or coalesce(p_provider_voice_id,'') !~ '^[A-Za-z0-9_-]{2,64}$' or char_length(btrim(coalesce(p_name,''))) not between 1 and 80
  or char_length(coalesce(p_description,''))>300 or cardinality(coalesce(p_tags,'{}'::text[]))>12 or array_to_string(coalesce(p_tags,'{}'::text[]),',') !~ '^([a-z]+:[a-z0-9_]{1,32}(,|$))*$' then raise exception 'Invalid designed voice' using errcode='22023'; end if;
 select not exists(select 1 from studio.studio_voices where location_id=p_location_id) into first_voice;
 insert into studio.studio_voices(location_id,provider,provider_voice_id,name,kind,language,persona,description,tags,is_default,created_by_clerk_user_id)
  values(p_location_id,p_provider,p_provider_voice_id,left(btrim(p_name),80),'designed',nullif(p_language,''),nullif(left(btrim(coalesce(p_persona,'')),80),''),nullif(btrim(coalesce(p_description,'')),''),coalesce(p_tags,'{}'::text[]),first_voice,p_clerk_user_id)
  on conflict (location_id,provider,provider_voice_id) do update set name=excluded.name,description=excluded.description,tags=excluded.tags,kind='designed'
  returning * into v;
 insert into studio.studio_voice_events(location_id,voice_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,v.id,'designed',p_actor_app,p_clerk_user_id,jsonb_build_object('provider',p_provider));
 return jsonb_build_object('id',v.id,'isDefault',v.is_default);
end $$;

-- A designed voice was created through Studio, so removing it here also removes it at the provider (like a clone).
CREATE OR REPLACE FUNCTION studio.studio_delete_voice(p_location_id text,p_actor_app text,p_clerk_user_id text,p_voice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare v studio.studio_voices%rowtype;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 select * into v from studio.studio_voices where location_id=p_location_id and id=p_voice_id for update;
 if not found then raise exception 'Voice not found' using errcode='VC002'; end if;
 if v.provider='local' then raise exception 'Built-in voices cannot be removed' using errcode='VC003'; end if;
 delete from studio.studio_voices where location_id=p_location_id and id=p_voice_id;
 if v.is_default then update studio.studio_voices set is_default=true where location_id=p_location_id and id=(select x.id from studio.studio_voices x where x.location_id=p_location_id order by x.created_at limit 1); end if;
 insert into studio.studio_voice_events(location_id,voice_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,p_voice_id,'deleted',p_actor_app,p_clerk_user_id,jsonb_build_object('provider',v.provider,'cloned',v.consent is not null,'kind',v.kind));
 return jsonb_build_object('provider',v.provider,'providerVoiceId',v.provider_voice_id,'removeAtProvider',v.consent is not null or v.kind='designed');
end $$;

-- 5. Preview an on-device speaker: a short sample generated on the requesting account's own Mac. One active job per voice.
CREATE FUNCTION studio.studio_request_voice_preview(p_location_id text,p_actor_app text,p_clerk_user_id text,p_voice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare v studio.studio_voices%rowtype; d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; why text;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 select * into v from studio.studio_voices where location_id=p_location_id and id=p_voice_id;
 if not found then raise exception 'Voice not found' using errcode='VP001'; end if;
 if v.provider<>'local' then raise exception 'Only on-device voices are previewed on the Mac' using errcode='VP002'; end if;
 select * into j from studio.studio_jobs where location_id=p_location_id and kind='studio.voice_preview' and payload->>'voiceId'=p_voice_id::text and created_by_clerk_user_id=p_clerk_user_id and status in ('queued','running') limit 1;
 if found then return jsonb_build_object('jobId',j.id,'status',j.status,'reused',true); end if;
 select * into d from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null
  and x.processing_enabled and 'studio.voice_preview'=any(x.allowed_kinds) and x.report->'handlers' ? 'studio.voice_preview'
  and x.report#>>'{voicePreview,ready}'='true' order by x.seen_at desc nulls last limit 1 for share;
 if not found then
  why:=case
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null) then 'VP011'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled) then 'VP012'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled and x.report->'handlers' ? 'studio.voice_preview') then 'VP014'
   else 'VP013' end;
  raise exception 'No ready Mac' using errcode=why;
 end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.voice_preview',jsonb_build_object('voiceId',p_voice_id,'speaker',v.provider_voice_id,'name',left(v.name,80)),'vpreview:'||p_voice_id::text||':'||gen_random_uuid()::text,p_clerk_user_id,1);
 if j.execution_target<>'device' then update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'reused',false);
end $$;

CREATE FUNCTION studio.studio_voice_preview_device_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 if new.revoked_at is not null or not new.processing_enabled then
  update studio.studio_jobs set status='cancelled',finished_at=clock_timestamp(),last_error_code='voice_mac_settings_changed',last_error_message='Mac settings changed. Preview again once the Mac is ready.'
   where device_id=new.id and kind='studio.voice_preview' and status='queued';
 end if; return null;
end $$;
REVOKE ALL ON FUNCTION studio.studio_voice_preview_device_release() FROM PUBLIC;
CREATE TRIGGER studio_voice_preview_device_release AFTER UPDATE OF revoked_at,processing_enabled ON studio.studio_devices FOR EACH ROW EXECUTE FUNCTION studio.studio_voice_preview_device_release();

-- 6. Device protocol: a wrapper in front of the video-assembly one. It owns claim/extend/complete/fail for this kind and passes everything else on.
CREATE FUNCTION studio.studio_voice_preview_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; r jsonb;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_operation not in ('claim','extend','complete','fail') then
  return studio.studio_video_assembly_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;

 if p_operation='claim' then
  if coalesce(p_body->>'leaseSeconds','') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 then raise exception 'Invalid lease' using errcode='22023'; end if;
  perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
  select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
  if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
  update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',last_error_message='The Mac stopped before finishing this preview.',finished_at=clock_timestamp(),updated_at=clock_timestamp()
   where device_id=d.id and kind='studio.voice_preview' and status='running' and lease_expires_at<=clock_timestamp();
  if not d.paused and d.processing_enabled and 'studio.voice_preview'=any(d.allowed_kinds) and p_body->>'previewReady'='true'
   and not exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind='studio.voice_preview' and execution_target='device' and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
  return studio.studio_video_assembly_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;

 if coalesce(p_body->>'jobId','') !~ '^[0-9a-f-]{36}$' then raise exception 'Invalid command' using errcode='22023'; end if;
 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and execution_target='device' and kind='studio.voice_preview' for update;
 if not found then return studio.studio_video_assembly_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then
  return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end;
 end if;
 if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
 if p_operation='fail' then
  return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,coalesce(nullif(p_body#>>'{failure,code}',''),'voice_preview_failed'),left(coalesce(p_body#>>'{failure,message}','The Mac could not generate the preview.'),300),false,null));
 end if;
 r:=p_body->'result';
 if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k<>'preview') or jsonb_typeof(r->'preview') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(r->'preview') k where k not in ('audioBase64','bytes','seconds','speaker'))
  or jsonb_typeof(r#>'{preview,audioBase64}') is distinct from 'string' or char_length(r#>>'{preview,audioBase64}') not between 400 and 24000 or (r#>>'{preview,audioBase64}') !~ '^[A-Za-z0-9+/=]+$'
  or coalesce(r#>>'{preview,speaker}','') !~ '^[A-Za-z0-9_-]{2,64}$' then raise exception 'Invalid voice preview result' using errcode='22023'; end if;
 return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,r));
end $$;

REVOKE ALL ON FUNCTION studio.studio_record_designed_voice(text,text,text,text,text,text,text,text[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_record_designed_voice(text,text,text,text,text,text,text,text[],text,text) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_request_voice_preview(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_voice_preview(text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_voice_preview_device_command(text,text,text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_voice_preview_device_command(text,text,text,jsonb,text,jsonb) TO service_role;
-- CREATE OR REPLACE keeps the existing grants on list/sync/delete; re-assert them.
REVOKE ALL ON FUNCTION studio.studio_list_voices(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_list_voices(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_sync_voices(text,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_sync_voices(text,text,text,text,jsonb,boolean) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_delete_voice(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_delete_voice(text,text,text,uuid) TO service_role;

COMMIT;
