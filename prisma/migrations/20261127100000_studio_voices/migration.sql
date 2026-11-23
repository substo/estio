BEGIN;
-- Voice library, provider keys stay in encrypted Location secrets (not here). Hosted narration is rendered on the server and handed to the Mac as private media.

CREATE TABLE studio.studio_voices (
  location_id text NOT NULL REFERENCES public."Location"(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('fish','elevenlabs','local')),
  provider_voice_id text NOT NULL CHECK (provider_voice_id ~ '^[A-Za-z0-9_-]{2,64}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('preset','clone')),
  language text CHECK (language IS NULL OR language ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$'),
  persona text CHECK (persona IS NULL OR char_length(btrim(persona)) BETWEEN 1 AND 80),
  is_default boolean NOT NULL DEFAULT false,
  consent jsonb,
  created_by_clerk_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, id),
  UNIQUE (location_id, provider, provider_voice_id),
  CHECK (consent IS NULL OR (jsonb_typeof(consent)='object' AND octet_length(consent::text) <= 2000))
);
CREATE UNIQUE INDEX studio_voices_one_default_idx ON studio.studio_voices (location_id) WHERE is_default;
CREATE TABLE studio.studio_voice_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id text NOT NULL REFERENCES public."Location"(id) ON DELETE CASCADE,
  voice_id uuid,
  event text NOT NULL CHECK (event IN ('cloned','set_default','deleted','synced')),
  actor_app text NOT NULL,
  actor_clerk_user_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE studio.studio_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.studio_voice_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON studio.studio_voices FROM PUBLIC;
REVOKE ALL ON studio.studio_voice_events FROM PUBLIC;

-- Any workspace member may see the library; owners/admins change it (same authority as AI settings).
CREATE FUNCTION studio.studio_list_voices(p_location_id text,p_actor_app text,p_clerk_user_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 return coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'provider',v.provider,'providerVoiceId',v.provider_voice_id,'name',v.name,'kind',v.kind,'language',v.language,'persona',v.persona,'isDefault',v.is_default,'cloned',v.consent is not null)
   order by v.is_default desc,v.provider,v.name) from studio.studio_voices v where v.location_id=p_location_id),'[]'::jsonb);
end $$;

-- Mirror a provider's voice list. Existing rows keep their consent, persona and default; names and languages refresh. prune removes this provider's rows that vanished upstream.
CREATE FUNCTION studio.studio_sync_voices(p_location_id text,p_actor_app text,p_clerk_user_id text,p_provider text,p_voices jsonb,p_prune boolean) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare e jsonb; n integer:=0;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if p_provider not in ('fish','elevenlabs','local') or jsonb_typeof(p_voices)<>'array' or jsonb_array_length(p_voices)>500 then raise exception 'Invalid voices' using errcode='22023'; end if;
 for e in select * from jsonb_array_elements(p_voices) loop
  if jsonb_typeof(e)<>'object' or coalesce(e->>'providerVoiceId','') !~ '^[A-Za-z0-9_-]{2,64}$' or e->>'kind' not in ('preset','clone') or char_length(btrim(coalesce(e->>'name','')))=0 then raise exception 'Invalid voice' using errcode='22023'; end if;
  insert into studio.studio_voices(location_id,provider,provider_voice_id,name,kind,language,created_by_clerk_user_id)
   values(p_location_id,p_provider,e->>'providerVoiceId',left(btrim(e->>'name'),80),e->>'kind',nullif(e->>'language',''),p_clerk_user_id)
   on conflict (location_id,provider,provider_voice_id) do update set name=excluded.name,language=coalesce(excluded.language,studio.studio_voices.language);
  n:=n+1;
 end loop;
 if p_prune then
  delete from studio.studio_voices v where v.location_id=p_location_id and v.provider=p_provider
   and not exists(select 1 from jsonb_array_elements(p_voices) x where x->>'providerVoiceId'=v.provider_voice_id);
 end if;
 insert into studio.studio_voice_events(location_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,'synced',p_actor_app,p_clerk_user_id,jsonb_build_object('provider',p_provider,'count',n));
 return n;
end $$;

-- A clone made through Studio. The attestation is mandatory and kept verbatim with who and when; the sample itself is never stored, only its digest.
CREATE FUNCTION studio.studio_record_voice_clone(p_location_id text,p_actor_app text,p_clerk_user_id text,p_provider text,p_provider_voice_id text,p_name text,p_language text,p_persona text,p_statement text,p_sample_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare v studio.studio_voices%rowtype; first_voice boolean;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if p_provider not in ('fish','elevenlabs') or coalesce(p_provider_voice_id,'') !~ '^[A-Za-z0-9_-]{2,64}$' or char_length(btrim(coalesce(p_name,''))) not between 1 and 80
  or coalesce(p_sample_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid clone' using errcode='22023'; end if;
 if p_statement is null or char_length(btrim(p_statement)) < 30 then raise exception 'Consent is required to clone a voice' using errcode='VC001'; end if;
 select not exists(select 1 from studio.studio_voices where location_id=p_location_id) into first_voice;
 insert into studio.studio_voices(location_id,provider,provider_voice_id,name,kind,language,persona,is_default,consent,created_by_clerk_user_id)
  values(p_location_id,p_provider,p_provider_voice_id,left(btrim(p_name),80),'clone',nullif(p_language,''),nullif(left(btrim(coalesce(p_persona,'')),80),''),first_voice,
   jsonb_build_object('statement',left(btrim(p_statement),400),'attestedByApp',p_actor_app,'attestedBy',p_clerk_user_id,'attestedAt',clock_timestamp(),'sampleSha256',p_sample_sha256),p_clerk_user_id)
  on conflict (location_id,provider,provider_voice_id) do update set name=excluded.name,persona=excluded.persona,consent=excluded.consent,kind='clone'
  returning * into v;
 insert into studio.studio_voice_events(location_id,voice_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,v.id,'cloned',p_actor_app,p_clerk_user_id,jsonb_build_object('provider',p_provider,'sampleSha256',p_sample_sha256));
 return jsonb_build_object('id',v.id,'isDefault',v.is_default);
end $$;

CREATE FUNCTION studio.studio_set_default_voice(p_location_id text,p_actor_app text,p_clerk_user_id text,p_voice_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if not exists(select 1 from studio.studio_voices where location_id=p_location_id and id=p_voice_id) then raise exception 'Voice not found' using errcode='VC002'; end if;
 update studio.studio_voices set is_default=false where location_id=p_location_id and is_default and id<>p_voice_id;
 update studio.studio_voices set is_default=true where location_id=p_location_id and id=p_voice_id;
 insert into studio.studio_voice_events(location_id,voice_id,event,actor_app,actor_clerk_user_id) values(p_location_id,p_voice_id,'set_default',p_actor_app,p_clerk_user_id);
end $$;

-- Returns what the caller must also remove at the provider: only clones made through Studio (they carry consent). Unlinking never deletes a voice made in the provider's own account.
CREATE FUNCTION studio.studio_delete_voice(p_location_id text,p_actor_app text,p_clerk_user_id text,p_voice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare v studio.studio_voices%rowtype;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 select * into v from studio.studio_voices where location_id=p_location_id and id=p_voice_id for update;
 if not found then raise exception 'Voice not found' using errcode='VC002'; end if;
 if v.provider='local' then raise exception 'Built-in voices cannot be removed' using errcode='VC003'; end if;
 delete from studio.studio_voices where location_id=p_location_id and id=p_voice_id;
 if v.is_default then update studio.studio_voices set is_default=true where location_id=p_location_id and id=(select x.id from studio.studio_voices x where x.location_id=p_location_id order by x.created_at limit 1); end if;
 insert into studio.studio_voice_events(location_id,voice_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,p_voice_id,'deleted',p_actor_app,p_clerk_user_id,jsonb_build_object('provider',v.provider,'cloned',v.consent is not null));
 return jsonb_build_object('provider',v.provider,'providerVoiceId',v.provider_voice_id,'removeAtProvider',v.consent is not null);
end $$;

-- Narration beats rendered on the server: private media saved as uploads on the content piece, named "Narration ...", kept out of the footage list.
CREATE FUNCTION studio.studio_save_narration(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid,p_upload_id uuid,p_filename text,p_byte_size bigint,p_sha256 text,p_bucket text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare mo uuid; key text;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if not exists(select 1 from studio.studio_records where location_id=p_location_id and id=p_record_id and kind='content') then raise exception 'Content not found' using errcode='VA001'; end if;
 if p_upload_id is null or coalesce(p_filename,'') !~ '^Narration [A-Za-z0-9 :._-]{1,200}\.mp3$' or p_byte_size not between 1000 and 100000000 or coalesce(p_sha256,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_bucket,'') !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' then raise exception 'Invalid narration' using errcode='22023'; end if;
 key:=p_location_id||'/uploads/'||p_upload_id::text||'/original';
 insert into studio.studio_media_objects(location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
  values(p_location_id,p_bucket,key,p_filename,'audio/mpeg',p_byte_size,p_sha256,p_clerk_user_id) on conflict (bucket_id,object_key) do update set byte_size=excluded.byte_size returning id into mo;
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,media_object_id,uploaded_at,created_by_clerk_user_id)
  values(p_upload_id,p_location_id,p_record_id,p_filename,'audio/mpeg',p_byte_size,p_bucket,key,'uploaded',mo,clock_timestamp(),p_clerk_user_id);
 return p_upload_id;
end $$;

CREATE OR REPLACE FUNCTION studio.studio_request_video_assembly(p_location_id text,p_actor_app text,p_clerk_user_id text,p_record_id uuid,p_options jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare rec studio.studio_records%rowtype; d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; script text; media jsonb; vo boolean; mu boolean; po boolean; why text; v studio.studio_voices%rowtype; vj jsonb; vids uuid[]; vopt jsonb; vcount integer;
begin
 if p_options is null or jsonb_typeof(p_options)<>'object' or exists(select 1 from jsonb_object_keys(p_options) k where k not in ('voiceover','music','portrait','voice'))
  or exists(select 1 from jsonb_each(p_options) e where e.key<>'voice' and jsonb_typeof(e.value)<>'boolean')
  or (p_options ? 'voice' and (jsonb_typeof(p_options->'voice')<>'object' or exists(select 1 from jsonb_object_keys(p_options->'voice') k where k not in ('voiceId','uploadIds'))
      or coalesce(p_options#>>'{voice,voiceId}','') !~ '^[0-9a-f-]{36}$'
      or (p_options->'voice' ? 'uploadIds' and (jsonb_typeof(p_options#>'{voice,uploadIds}')<>'array' or jsonb_array_length(p_options#>'{voice,uploadIds}')>200
          or exists(select 1 from jsonb_array_elements(p_options#>'{voice,uploadIds}') e where jsonb_typeof(e)<>'string' or e#>>'{}' !~ '^[0-9a-f-]{36}$'))))) then raise exception 'Invalid video options' using errcode='22023'; end if;
 vo:=coalesce((p_options->>'voiceover')::boolean,false); mu:=coalesce((p_options->>'music')::boolean,false); po:=coalesce((p_options->>'portrait')::boolean,false);
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 select * into rec from studio.studio_records where location_id=p_location_id and id=p_record_id and kind='content' for update;
 if not found then raise exception 'Content not found' using errcode='VA001'; end if;
 script:=btrim(coalesce(rec.payload->>'script',''));
 if char_length(script)<1 then raise exception 'No saved script' using errcode='VA002'; end if;
 if char_length(script)>20000 then raise exception 'Script too long' using errcode='VA003'; end if;
 select * into j from studio.studio_jobs where location_id=p_location_id and kind='studio.video_assemble' and payload->>'recordId'=p_record_id::text and status in ('queued','running') limit 1;
  if found then return jsonb_build_object('jobId',j.id,'status',j.status,'reused',true); end if;
 vj:=null;
 if vo then
  if not p_options ? 'voice' then raise exception 'Choose a voice' using errcode='VA006'; end if;
  select * into v from studio.studio_voices x where x.location_id=p_location_id and x.id=(p_options#>>'{voice,voiceId}')::uuid;
  if not found then raise exception 'Voice not found' using errcode='VA006'; end if;
  if v.provider='local' then
   vj:=jsonb_build_object('engine','local','model','mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit','speaker',v.provider_voice_id);
  else
   select coalesce(array_agg(x::uuid),'{}') into vids from jsonb_array_elements_text(coalesce(p_options#>'{voice,uploadIds}','[]'::jsonb)) x;
   select count(*) into vcount from studio.studio_uploads u where u.location_id=p_location_id and u.record_id=p_record_id and u.status='uploaded' and u.id=any(vids) and u.original_filename ~ '^Narration ';
   if coalesce(array_length(vids,1),0)=0 or vcount<>array_length(vids,1) then raise exception 'Narration is not ready' using errcode='VA007'; end if;
   vj:=jsonb_build_object('engine','hosted','provider',v.provider,'name',left(v.name,80),'uploadIds',to_jsonb(vids));
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('uploadId',u.id,'name',u.original_filename,'contentType',u.content_type,'byteSize',u.byte_size) order by u.created_at),'[]'::jsonb) into media
  from (select * from studio.studio_uploads x where x.location_id=p_location_id and x.record_id=p_record_id and x.status='uploaded' and x.media_object_id is not null
         and (x.content_type like 'video/%' or x.content_type like 'audio/%') and x.original_filename !~ '^Edited video ' and x.original_filename !~ '^Narration ' order by x.created_at limit 40) u;
 if jsonb_array_length(media)=0 and not vo then raise exception 'No footage' using errcode='VA004'; end if;
 if (select coalesce(sum((m->>'byteSize')::bigint),0) from jsonb_array_elements(media) m)>21474836480 then raise exception 'Footage too large' using errcode='VA005'; end if;
 select * into d from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null
  and x.processing_enabled and 'studio.video_assemble'=any(x.allowed_kinds) and x.report->'handlers' ? 'studio.video_assemble'
  and x.report#>>'{videoAssembly,ready}'='true' order by x.seen_at desc nulls last limit 1 for share;
 if not found then
  why:=case
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null) then 'VA011'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled) then 'VA012'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled and x.report->'handlers' ? 'studio.video_assemble') then 'VA014'
   else 'VA013' end;
  raise exception 'No ready Mac' using errcode=why;
 end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.video_assemble',
   jsonb_build_object('recordId',p_record_id,'recordVersion',rec.version,'title',left(rec.title,200),'script',script,'options',jsonb_build_object('voiceover',vo,'music',mu,'portrait',po),'media',media)||case when vj is null then '{}'::jsonb else jsonb_build_object('voice',vj) end,
   'vassemble:'||p_record_id::text||':'||gen_random_uuid()::text,p_clerk_user_id,1);
 if j.execution_target<>'device' then update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'reused',false);
end $$;
REVOKE ALL ON FUNCTION studio.studio_request_video_assembly(text,text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_request_video_assembly(text,text,text,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_list_voices(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_list_voices(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_sync_voices(text,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_sync_voices(text,text,text,text,jsonb,boolean) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_record_voice_clone(text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_record_voice_clone(text,text,text,text,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_set_default_voice(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_set_default_voice(text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_delete_voice(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_delete_voice(text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_save_narration(text,text,text,uuid,uuid,text,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_save_narration(text,text,text,uuid,uuid,text,bigint,text,text) TO service_role;

COMMIT;
