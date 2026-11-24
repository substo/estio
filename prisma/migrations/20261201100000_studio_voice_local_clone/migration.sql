-- On-device voice clones: the reference recording and its transcript stay in Studio's private storage only long enough for the owner's Mac to fetch them;
-- the voice is a studio_voices row (provider 'local', kind 'clone') with the same consent record as a hosted clone. Nothing is sent to a voice provider.
BEGIN;

-- 1. Record a local clone. The row id is minted here so the storage keys and the on-device voice name can be derived from it.
CREATE FUNCTION studio.studio_record_local_clone(p_location_id text,p_actor_app text,p_clerk_user_id text,p_name text,p_language text,p_persona text,p_statement text,p_sample_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare v studio.studio_voices%rowtype; first_voice boolean; vid uuid:=gen_random_uuid();
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if char_length(btrim(coalesce(p_name,''))) not between 1 and 80 or coalesce(p_sample_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid clone' using errcode='22023'; end if;
 if p_statement is null or char_length(btrim(p_statement)) < 30 then raise exception 'Consent is required to clone a voice' using errcode='VC001'; end if;
 select not exists(select 1 from studio.studio_voices where location_id=p_location_id) into first_voice;
 insert into studio.studio_voices(id,location_id,provider,provider_voice_id,name,kind,language,persona,is_default,consent,created_by_clerk_user_id)
  values(vid,p_location_id,'local','clone-'||vid::text,left(btrim(p_name),80),'clone',nullif(p_language,''),nullif(left(btrim(coalesce(p_persona,'')),80),''),first_voice,
   jsonb_build_object('statement',left(btrim(p_statement),400),'attestedByApp',p_actor_app,'attestedBy',p_clerk_user_id,'attestedAt',clock_timestamp(),'sampleSha256',p_sample_sha256,'where','on-device'),p_clerk_user_id)
  returning * into v;
 insert into studio.studio_voice_events(location_id,voice_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,v.id,'cloned',p_actor_app,p_clerk_user_id,jsonb_build_object('provider','local','sampleSha256',p_sample_sha256));
 return jsonb_build_object('id',v.id,'providerVoiceId',v.provider_voice_id,'isDefault',v.is_default);
end $$;

-- 2. Built-in speakers cannot be removed; an on-device clone can (the caller also deletes the stored reference).
CREATE OR REPLACE FUNCTION studio.studio_delete_voice(p_location_id text,p_actor_app text,p_clerk_user_id text,p_voice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare v studio.studio_voices%rowtype;
begin
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 select * into v from studio.studio_voices where location_id=p_location_id and id=p_voice_id for update;
 if not found then raise exception 'Voice not found' using errcode='VC002'; end if;
 if v.provider='local' and v.kind<>'clone' then raise exception 'Built-in voices cannot be removed' using errcode='VC003'; end if;
 delete from studio.studio_voices where location_id=p_location_id and id=p_voice_id;
 if v.is_default then update studio.studio_voices set is_default=true where location_id=p_location_id and id=(select x.id from studio.studio_voices x where x.location_id=p_location_id order by x.created_at limit 1); end if;
 insert into studio.studio_voice_events(location_id,voice_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,p_voice_id,'deleted',p_actor_app,p_clerk_user_id,jsonb_build_object('provider',v.provider,'cloned',v.consent is not null,'kind',v.kind));
 return jsonb_build_object('provider',v.provider,'providerVoiceId',v.provider_voice_id,'removeAtProvider',v.provider<>'local' and (v.consent is not null or v.kind='designed'),'removeReference',v.provider='local' and v.kind='clone');
end $$;

-- 3. Syncing the built-in speakers must never prune an on-device clone (it is not in the built-in list).
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
  delete from studio.studio_voices v where v.location_id=p_location_id and v.provider=p_provider and not (v.provider='local' and v.kind='clone')
   and not exists(select 1 from jsonb_array_elements(p_voices) x where x->>'providerVoiceId'=v.provider_voice_id);
 end if;
 insert into studio.studio_voice_events(location_id,event,actor_app,actor_clerk_user_id,detail) values(p_location_id,'synced',p_actor_app,p_clerk_user_id,jsonb_build_object('provider',p_provider,'count',n));
 return n;
end $$;

REVOKE ALL ON FUNCTION studio.studio_record_local_clone(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_record_local_clone(text,text,text,text,text,text,text,text) TO service_role;

COMMIT;
