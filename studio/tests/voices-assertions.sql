-- Real SQL against an isolated PostgreSQL cluster. No credentials, network or providers.
create function pg_temp.pair(w text,actor text,code text,hash text,ready boolean default true) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,seen_at=clock_timestamp(),
  report=jsonb_build_object('handlers',jsonb_build_array('studio.video_assemble'),'videoAssembly',jsonb_build_object('ready',ready)) where id=d;
 return d;
end $$;
create function pg_temp.claim(hash text,ready boolean default true) returns jsonb language sql as $$
 select studio.studio_video_assembly_device_command(hash,'substo','claim',jsonb_build_object('workerId','mac','limit',1,'leaseSeconds',120,'assembleReady',ready))
$$;
create function pg_temp.fails(sql text,code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then if sqlstate<>code then raise notice 'got % % wanted %',sqlstate,sqlerrm,code; end if; return sqlstate=code; end $$;
do $$
declare w text:='bf000000-0000-4000-8000-0000000000b1'; w2 text:='bf000000-0000-4000-8000-0000000000b2'; d uuid; rec uuid:=gen_random_uuid(); r jsonb; j uuid; n integer;
 v_fish uuid; v_local uuid; v_clone uuid; up1 uuid:=gen_random_uuid(); up2 uuid:=gen_random_uuid(); up3 uuid:=gen_random_uuid(); mo uuid; shot uuid:=gen_random_uuid();
 h1 text:=repeat('a',64); sha text:=repeat('d',64); bucket text:='studio-test-bucket'; statement text:='This is my own voice, or the speaker has given me permission to clone it and use it in this workspace''s videos.';
begin
 perform studio.studio_create_substo_location(w,'Voices fixture','vo-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','vo-other');
 d:=pg_temp.pair(w,'vo-owner','TVMAAAAA',h1);
 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,rec,'content','Voiced','{"script":"One.\n\nTwo."}');

 -- Grants: service role only.
 if has_function_privilege('authenticated','studio.studio_sync_voices(text,text,text,text,jsonb,boolean)','EXECUTE') or has_function_privilege('authenticated','studio.studio_record_voice_clone(text,text,text,text,text,text,text,text,text,text)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_save_narration(text,text,text,uuid,uuid,text,bigint,text,text)','EXECUTE') or has_table_privilege('authenticated','studio.studio_voices','SELECT')
  or not has_function_privilege('service_role','studio.studio_list_voices(text,text,text)','EXECUTE') then raise exception 'Unsafe voice grants'; end if;

 -- Sync mirrors a provider, refreshes names, prunes what vanished, and never crosses providers or tenants.
 n:=studio.studio_sync_voices(w,'substo','vo-owner','fish','[{"providerVoiceId":"fishvoice01","name":"Mine","kind":"clone","language":"en"},{"providerVoiceId":"fishvoice02","name":"Other","kind":"preset"}]',true);
 if n<>2 then raise exception 'Sync count wrong'; end if;
 perform studio.studio_sync_voices(w,'substo','vo-owner','local','[{"providerVoiceId":"ryan","name":"Ryan","kind":"preset"}]',true);
 perform studio.studio_sync_voices(w,'substo','vo-owner','fish','[{"providerVoiceId":"fishvoice01","name":"Mine renamed","kind":"clone"}]',true);
 if (select count(*) from studio.studio_voices where location_id=w and provider='fish')<>1 or (select name from studio.studio_voices where location_id=w and provider_voice_id='fishvoice01')<>'Mine renamed'
  or (select count(*) from studio.studio_voices where location_id=w and provider='local')<>1 then raise exception 'Sync did not mirror/prune correctly'; end if;
 if not pg_temp.fails($q$select studio.studio_sync_voices('bf000000-0000-4000-8000-0000000000b1','substo','vo-other','fish','[]',true)$q$,'42501') then raise exception 'Another tenant synced voices'; end if;
 if not pg_temp.fails($q$select studio.studio_sync_voices('bf000000-0000-4000-8000-0000000000b1','substo','vo-owner','fish','[{"providerVoiceId":"../x","name":"x","kind":"preset"}]',false)$q$,'22023') then raise exception 'Bad provider id accepted'; end if;
 select id into v_fish from studio.studio_voices where location_id=w and provider='fish'; select id into v_local from studio.studio_voices where location_id=w and provider='local';

 -- Clone needs the attestation and records who/when/digest; the sample is never stored.
 if not pg_temp.fails(format($q$select studio.studio_record_voice_clone(%L,'substo','vo-owner','fish','clonevoice01','Me','en',null,'ok',%L)$q$,w,sha),'VC001') then raise exception 'Clone without consent accepted'; end if;
 r:=studio.studio_record_voice_clone(w,'substo','vo-owner','elevenlabs','clonevoice01','Me','en','Host',statement,sha); v_clone:=(r->>'id')::uuid;
 if (select consent->>'attestedBy' from studio.studio_voices where id=v_clone)<>'vo-owner' or (select consent->>'sampleSha256' from studio.studio_voices where id=v_clone)<>sha
  or (select consent->>'statement' from studio.studio_voices where id=v_clone) not like 'This is my own voice%' or (select persona from studio.studio_voices where id=v_clone)<>'Host'
  or not exists(select 1 from studio.studio_voice_events where voice_id=v_clone and event='cloned') then raise exception 'Clone consent not recorded'; end if;

 -- One default per Location; deleting the default promotes another; clones report provider removal, synced voices do not, built-ins refuse.
 perform studio.studio_set_default_voice(w,'substo','vo-owner',v_fish);
 perform studio.studio_set_default_voice(w,'substo','vo-owner',v_clone);
 if (select count(*) from studio.studio_voices where location_id=w and is_default)<>1 or not (select is_default from studio.studio_voices where id=v_clone) then raise exception 'Default not unique'; end if;
 if not pg_temp.fails(format($q$select studio.studio_set_default_voice(%L,'substo','vo-owner',gen_random_uuid())$q$,w),'VC002') then raise exception 'Unknown voice set as default'; end if;
 if not pg_temp.fails(format($q$select studio.studio_delete_voice(%L,'substo','vo-owner',%L)$q$,w,v_local),'VC003') then raise exception 'Built-in voice deleted'; end if;
 r:=studio.studio_delete_voice(w,'substo','vo-owner',v_clone);
 if r->>'removeAtProvider'<>'true' or (select count(*) from studio.studio_voices where location_id=w and is_default)<>1 then raise exception 'Clone delete or default promotion wrong'; end if;
 r:=studio.studio_delete_voice(w,'substo','vo-owner',v_fish);
 if r->>'removeAtProvider'<>'false' then raise exception 'Synced voice would be deleted at the provider'; end if;
 perform studio.studio_sync_voices(w,'substo','vo-owner','fish','[{"providerVoiceId":"fishvoice01","name":"Mine","kind":"clone"}]',false);
 select id into v_fish from studio.studio_voices where location_id=w and provider='fish';

 -- Narration uploads: valid name only, attached to the content piece, kept out of the footage list.
 if not pg_temp.fails(format($q$select studio.studio_save_narration(%L,'substo','vo-owner',%L,gen_random_uuid(),'voice-01.mp3',5000,%L,%L)$q$,w,rec,sha,bucket),'22023') then raise exception 'Bad narration name accepted'; end if;
 perform studio.studio_save_narration(w,'substo','vo-owner',rec,up1,'Narration 2026-11-27 0900 01.mp3',5000,sha,bucket);
 perform studio.studio_save_narration(w,'substo','vo-owner',rec,up2,'Narration 2026-11-27 0900 02.mp3',6000,sha,bucket);
 if (select count(*) from studio.studio_uploads where record_id=rec and status='uploaded')<>2 then raise exception 'Narration not saved as uploads'; end if;
 insert into studio.studio_media_objects(id,location_id,bucket_id,object_key,original_filename,content_type,byte_size,sha256,created_by_clerk_user_id)
  values(gen_random_uuid(),w,bucket,w||'/uploads/'||shot::text||'/original','shot.mp4','video/mp4',5000,repeat('1',64),'vo-owner') returning id into mo;
 insert into studio.studio_uploads(id,location_id,record_id,original_filename,content_type,byte_size,bucket_id,object_key,status,media_object_id,uploaded_at,created_by_clerk_user_id)
  values(shot,w,rec,'shot.mp4','video/mp4',5000,bucket,w||'/uploads/'||shot::text||'/original','uploaded',mo,now(),'vo-owner');

 -- Admission: voiceover needs a chosen voice; hosted needs ready narration; local needs nothing more; narration never counts as footage.
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','vo-owner',%L,'{"voiceover":true}')$q$,w,rec),'VA006') then raise exception 'Voiceover without a voice queued'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','vo-owner',%L,%L)$q$,w,rec,jsonb_build_object('voiceover',true,'voice',jsonb_build_object('voiceId',v_fish))),'VA007') then raise exception 'Hosted voice without narration queued'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','vo-owner',%L,%L)$q$,w,rec,jsonb_build_object('voiceover',true,'voice',jsonb_build_object('voiceId',v_fish,'uploadIds',jsonb_build_array(shot)))),'VA007') then raise exception 'Footage accepted as narration'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_video_assembly(%L,'substo','vo-owner',%L,%L)$q$,w,rec,'{"voiceover":true,"voice":{"voiceId":"nope"}}'::jsonb),'22023') then raise exception 'Bad voice id accepted'; end if;
 r:=studio.studio_request_video_assembly(w,'substo','vo-owner',rec,jsonb_build_object('voiceover',true,'music',false,'portrait',false,'voice',jsonb_build_object('voiceId',v_fish,'uploadIds',jsonb_build_array(up1,up2))));
 j:=(r->>'jobId')::uuid;
 if (select payload#>>'{voice,engine}' from studio.studio_jobs where id=j)<>'hosted' or jsonb_array_length((select payload#>'{voice,uploadIds}' from studio.studio_jobs where id=j))<>2
  or jsonb_array_length((select payload->'media' from studio.studio_jobs where id=j))<>1 or (select payload#>>'{media,0,name}' from studio.studio_jobs where id=j)<>'shot.mp4' then raise exception 'Hosted voice payload wrong'; end if;
 update studio.studio_jobs set status='cancelled',finished_at=now() where id=j;
 r:=studio.studio_request_video_assembly(w,'substo','vo-owner',rec,jsonb_build_object('voiceover',true,'voice',jsonb_build_object('voiceId',v_local)));
 if (select payload#>>'{voice,engine}' from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'local' or (select payload#>>'{voice,speaker}' from studio.studio_jobs where id=(r->>'jobId')::uuid)<>'ryan' then raise exception 'Local voice payload wrong'; end if;
end $$;
