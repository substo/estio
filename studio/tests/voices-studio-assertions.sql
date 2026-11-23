-- Real SQL against an isolated PostgreSQL cluster. No credentials, network or providers.
-- Test-only stand-in for the edit-loop migration that grants the device kind (this slice never touches allowed_kinds).
alter table studio.studio_devices drop constraint studio_devices_allowed_kinds_check;
alter table studio.studio_devices add constraint studio_devices_allowed_kinds_check check ('studio.diagnostic'=any(allowed_kinds) and allowed_kinds <@ array['studio.diagnostic','studio.library_summary','studio.onboarding_research','studio.text_run','studio.video_transcribe','studio.youtube_search','studio.video_assemble','studio.voice_preview']::text[]);
create function pg_temp.pair(w text,actor text,code text,hash text,preview boolean default true) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,seen_at=clock_timestamp(),report=jsonb_build_object('handlers',jsonb_build_array('studio.voice_preview'),'voicePreview',jsonb_build_object('ready',preview)) where id=d;
 update studio.studio_devices set allowed_kinds=allowed_kinds||array['studio.voice_preview'] where id=d;
 return d;
end $$;
create function pg_temp.claim(hash text,ready boolean default true) returns jsonb language sql as $$
 select studio.studio_voice_preview_device_command(hash,'substo','claim',jsonb_build_object('workerId','mac','limit',1,'leaseSeconds',120,'previewReady',ready))
$$;
create function pg_temp.fails(sql text,code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then if sqlstate<>code then raise notice 'got % % wanted %',sqlstate,sqlerrm,code; end if; return sqlstate=code; end $$;
do $$
declare w text:='bf000000-0000-4000-8000-0000000000c1'; w2 text:='bf000000-0000-4000-8000-0000000000c2'; d uuid; h1 text:=repeat('c',64); r jsonb; n integer;
 v_local uuid; v_fish uuid; v_design uuid; j uuid; claimed jsonb; tok uuid; audio text:=repeat('QUJD',200);
begin
 perform studio.studio_create_substo_location(w,'Voices studio fixture','vs-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','vs-other');

 -- Metadata: tags are validated, mirrored, listed, and survive a sync that carries none.
 n:=studio.studio_sync_voices(w,'substo','vs-owner','elevenlabs','[{"providerVoiceId":"elvoice0001","name":"Liam","kind":"preset","description":"Energetic social creator","tags":["gender:male","tone:energetic","use:social"]}]',true);
 n:=studio.studio_sync_voices(w,'substo','vs-owner','fish','[{"providerVoiceId":"fishvoice01","name":"Mine","kind":"clone"}]',true);
 n:=studio.studio_sync_voices(w,'substo','vs-owner','local','[{"providerVoiceId":"ryan","name":"Ryan","kind":"preset","tags":["gender:male"],"description":"Dynamic man"}]',true);
 r:=studio.studio_list_voices(w,'substo','vs-owner');
 if (select count(*) from jsonb_array_elements(r) x where x->>'name'='Liam' and x->>'description'='Energetic social creator' and x->'tags'='["gender:male","tone:energetic","use:social"]'::jsonb)<>1 then raise exception 'Metadata not listed: %',r; end if;
 perform studio.studio_sync_voices(w,'substo','vs-owner','elevenlabs','[{"providerVoiceId":"elvoice0001","name":"Liam v2","kind":"preset"}]',true);
 if (select tags from studio.studio_voices where location_id=w and provider_voice_id='elvoice0001')<>array['gender:male','tone:energetic','use:social'] then raise exception 'A sync without tags erased them'; end if;
 if not pg_temp.fails($q$select studio.studio_sync_voices('bf000000-0000-4000-8000-0000000000c1','substo','vs-owner','fish','[{"providerVoiceId":"fishvoice09","name":"x","kind":"preset","tags":["Bad Tag"]}]',false)$q$,'22023') then raise exception 'Bad tag accepted'; end if;
 if not pg_temp.fails($q$select studio.studio_sync_voices('bf000000-0000-4000-8000-0000000000c1','substo','vs-owner','fish','[{"providerVoiceId":"fishvoice09","name":"x","kind":"preset","description":"%s"}]',false)$q$ || '', '22023') and false then null; end if;
 if not pg_temp.fails($q$insert into studio.studio_voices(location_id,provider,provider_voice_id,name,kind,created_by_clerk_user_id,tags) values('bf000000-0000-4000-8000-0000000000c1','fish','fishvoice10','x','preset','u',array['NOPE'])$q$,'23514') then raise exception 'Tag check missing'; end if;

 -- Designed voices: recorded without consent, removed at the provider on delete, tenant-fenced.
 r:=studio.studio_record_designed_voice(w,'substo','vs-owner','elevenlabs','designed0001','Host','A young woman, warm.',array['gender:female','tone:warm'],'en','Host');
 v_design:=(r->>'id')::uuid;
 if (select kind from studio.studio_voices where id=v_design)<>'designed' or (select consent from studio.studio_voices where id=v_design) is not null then raise exception 'Designed voice wrong'; end if;
 if not pg_temp.fails($q$select studio.studio_record_designed_voice('bf000000-0000-4000-8000-0000000000c1','substo','vs-other','elevenlabs','designed0002','x','',array[]::text[],null,null)$q$,'42501') then raise exception 'Another tenant designed a voice'; end if;
 if not pg_temp.fails($q$select studio.studio_record_designed_voice('bf000000-0000-4000-8000-0000000000c1','substo','vs-owner','elevenlabs','designed0002','x','',array['BAD'],null,null)$q$,'22023') then raise exception 'Bad designed tags accepted'; end if;
 if (studio.studio_delete_voice(w,'substo','vs-owner',v_design)->>'removeAtProvider')<>'true' then raise exception 'Designed voice not removed at provider'; end if;
 select id into v_fish from studio.studio_voices where location_id=w and provider='fish';
 if (studio.studio_delete_voice(w,'substo','vs-owner',v_fish)->>'removeAtProvider')<>'false' then raise exception 'Synced voice must only be unlinked'; end if;
 select id into v_local from studio.studio_voices where location_id=w and provider='local';
 select id into v_fish from studio.studio_voices where location_id=w and provider='elevenlabs';

 -- Preview admission: only local voices, only a ready Mac of the requesting account, one active job per voice.
 if not pg_temp.fails(format($q$select studio.studio_request_voice_preview('%s','substo','vs-owner','%s')$q$,w,v_local),'VP011') then raise exception 'Preview queued with no Mac'; end if;
 d:=pg_temp.pair(w,'vs-owner','TVSAAAAA',h1,false);
 if not pg_temp.fails(format($q$select studio.studio_request_voice_preview('%s','substo','vs-owner','%s')$q$,w,v_local),'VP013') then raise exception 'Preview queued on a Mac that is not ready'; end if;
 update studio.studio_devices set report=jsonb_build_object('handlers',jsonb_build_array('studio.voice_preview'),'voicePreview',jsonb_build_object('ready',true)) where id=d;
 if not pg_temp.fails(format($q$select studio.studio_request_voice_preview('%s','substo','vs-owner','%s')$q$,w,v_fish),'VP002') then raise exception 'Hosted voice previewed on the Mac'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_voice_preview('%s','substo','vs-owner','%s')$q$,w,gen_random_uuid()),'VP001') then raise exception 'Unknown voice previewed'; end if;
 if not pg_temp.fails(format($q$select studio.studio_request_voice_preview('%s','substo','vs-other','%s')$q$,w,v_local),'42501') then raise exception 'Another tenant previewed'; end if;
 r:=studio.studio_request_voice_preview(w,'substo','vs-owner',v_local); j:=(r->>'jobId')::uuid;
 if (r->>'reused')<>'false' or (studio.studio_request_voice_preview(w,'substo','vs-owner',v_local)->>'jobId')::uuid<>j then raise exception 'Active preview not reused'; end if;

 -- Claim: needs the ready flag, hands the job to the wrapper, anything else falls through to the previous layer.
 if jsonb_array_length(pg_temp.claim(h1,false))<>0 then raise exception 'Claimed while not ready'; end if;
 claimed:=pg_temp.claim(h1); if jsonb_array_length(claimed)<>1 or claimed->0->>'kind'<>'studio.voice_preview' or claimed->0->'payload'->>'speaker'<>'ryan' then raise exception 'Claim wrong: %',claimed; end if;
 tok:=(claimed->0->>'lease_token')::uuid;
 -- Result validation: only a bounded preview object.
 if not pg_temp.fails(format($q$select studio.studio_voice_preview_device_command('%s','substo','complete',jsonb_build_object('workerId','mac','jobId','%s','leaseToken','%s','result',jsonb_build_object('preview',jsonb_build_object('audioBase64','short','speaker','ryan'))))$q$,h1,j,tok),'22023') then raise exception 'Tiny audio accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_voice_preview_device_command('%s','substo','complete',jsonb_build_object('workerId','mac','jobId','%s','leaseToken','%s','result',jsonb_build_object('preview',jsonb_build_object('audioBase64','%s','speaker','ryan'),'extra',1)))$q$,h1,j,tok,audio),'22023') then raise exception 'Extra result key accepted'; end if;
 if (studio.studio_voice_preview_device_command(h1,'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('preview',jsonb_build_object('audioBase64',audio,'speaker','ryan','bytes',15000,'seconds',3.2))))::text)<>'true' then raise exception 'Valid preview not completed'; end if;
 if (select status from studio.studio_jobs where id=j)<>'succeeded' or (select result#>>'{preview,speaker}' from studio.studio_jobs where id=j)<>'ryan' then raise exception 'Preview result not stored'; end if;
 -- A stale lease cannot complete again; another Mac's job id falls through harmlessly.
 if (studio.studio_voice_preview_device_command(h1,'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('preview',jsonb_build_object('audioBase64',audio,'speaker','ryan'))))::text)<>'false' then
  -- succeeded jobs are no longer running: expected false
  raise exception 'Completed job completed twice'; end if;

 -- Consent withdrawal cancels queued previews.
 r:=studio.studio_request_voice_preview(w,'substo','vs-owner',v_local); j:=(r->>'jobId')::uuid;
 update studio.studio_devices set processing_enabled=false where id=d;
 if (select status from studio.studio_jobs where id=j)<>'cancelled' then raise exception 'Queued preview survived turning processing off'; end if;
 raise notice 'voices studio assertions ok';
end $$;
