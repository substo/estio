-- Real SQL against an isolated PostgreSQL cluster. On-device voice clones: recorded with consent, never pruned by the built-in sync, removable, tenant-isolated.
create function pg_temp.fails(sql text,code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then if sqlstate<>code then raise notice 'got % % wanted %',sqlstate,sqlerrm,code; end if; return sqlstate=code; end $$;
do $$
declare w text:='bf000000-0000-4000-8000-0000000000f1'; w2 text:='bf000000-0000-4000-8000-0000000000f2'; r jsonb; c uuid; c2 uuid;
 sha text:=repeat('e',64); statement text:='This is my own voice, or the speaker has given me permission to clone it and use it in this workspace''s videos.';
begin
 perform studio.studio_create_substo_location(w,'Clone fixture','lc-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','lc-other');

 -- Grants: service role only.
 if has_function_privilege('authenticated','studio.studio_record_local_clone(text,text,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('anon','studio.studio_record_local_clone(text,text,text,text,text,text,text,text)','EXECUTE')
  or not has_function_privilege('service_role','studio.studio_record_local_clone(text,text,text,text,text,text,text,text)','EXECUTE') then raise exception 'Unsafe local clone grants'; end if;

 -- Consent is required, the name is bounded, another tenant's member cannot record one.
 if not pg_temp.fails(format($q$select studio.studio_record_local_clone(%L,'substo','lc-owner','Me','en',null,'ok',%L)$q$,w,sha),'VC001') then raise exception 'Local clone without consent accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_record_local_clone(%L,'substo','lc-owner','','en',null,%L,%L)$q$,w,statement,sha),'22023') then raise exception 'Empty name accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_record_local_clone(%L,'substo','lc-owner','Me','en',null,%L,'nothex')$q$,w,statement),'22023') then raise exception 'Bad digest accepted'; end if;
 if not pg_temp.fails(format($q$select studio.studio_record_local_clone(%L,'substo','lc-other','Me','en',null,%L,%L)$q$,w,statement,sha),'42501') then raise exception 'Another tenant recorded a clone'; end if;

 -- A recorded clone is an on-device voice named after its own id, with who/when/digest and where it lives.
 r:=studio.studio_record_local_clone(w,'substo','lc-owner','My voice','en','Host',statement,sha); c:=(r->>'id')::uuid;
 if r->>'providerVoiceId'<>'clone-'||c::text or (select provider from studio.studio_voices where id=c)<>'local' or (select kind from studio.studio_voices where id=c)<>'clone'
  or (select consent->>'attestedBy' from studio.studio_voices where id=c)<>'lc-owner' or (select consent->>'sampleSha256' from studio.studio_voices where id=c)<>sha or (select consent->>'where' from studio.studio_voices where id=c)<>'on-device'
  or (select persona from studio.studio_voices where id=c)<>'Host' or not (select is_default from studio.studio_voices where id=c)
  or not exists(select 1 from studio.studio_voice_events where voice_id=c and event='cloned') then raise exception 'Local clone not recorded correctly'; end if;
 r:=studio.studio_record_local_clone(w,'substo','lc-owner','Second','en',null,statement,sha); c2:=(r->>'id')::uuid;
 if (select is_default from studio.studio_voices where id=c2) or (select count(*) from studio.studio_voices where location_id=w and is_default)<>1 then raise exception 'Second clone took the default'; end if;

 -- Syncing the built-in speakers (with prune) keeps both clones and still prunes stale built-ins; other tenants are untouched.
 perform studio.studio_sync_voices(w,'substo','lc-owner','local','[{"providerVoiceId":"ryan","name":"Ryan","kind":"preset"},{"providerVoiceId":"serena","name":"Serena","kind":"preset"}]',true);
 perform studio.studio_sync_voices(w,'substo','lc-owner','local','[{"providerVoiceId":"ryan","name":"Ryan","kind":"preset"}]',true);
 if (select count(*) from studio.studio_voices where location_id=w and provider='local' and kind='clone')<>2 or exists(select 1 from studio.studio_voices where location_id=w and provider_voice_id='serena')
  or not exists(select 1 from studio.studio_voices where location_id=w and provider_voice_id='ryan') then raise exception 'Sync pruned a clone or kept a stale built-in'; end if;

 -- Built-in speakers still cannot be removed.
 if not pg_temp.fails(format($q$select studio.studio_delete_voice(%L,'substo','lc-owner',%L)$q$,w,(select id from studio.studio_voices where location_id=w and provider_voice_id='ryan')),'VC003') then raise exception 'Built-in voice deleted'; end if;

 -- Deleting a clone removes it, reports that its stored reference must go, never asks the provider, and promotes another default.
 r:=studio.studio_delete_voice(w,'substo','lc-owner',c);
 if (r->>'removeReference')::boolean is not true or (r->>'removeAtProvider')::boolean is not false or exists(select 1 from studio.studio_voices where id=c)
  or (select count(*) from studio.studio_voices where location_id=w and is_default)<>1 then raise exception 'Clone delete wrong'; end if;
 if not pg_temp.fails(format($q$select studio.studio_delete_voice(%L,'substo','lc-other',%L)$q$,w,c2),'42501') then raise exception 'Another tenant deleted a clone'; end if;
end $$;
