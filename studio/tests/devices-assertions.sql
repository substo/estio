-- Synthetic paired devices only. No live credentials or network/provider calls.
-- Pair through the real browser-approved flow: start -> approve -> first poll issues the token.
create function pg_temp.pair_device(p_w text,p_app text,p_user text,p_code text,p_token_hash text) returns uuid language plpgsql as $$
declare r jsonb; v_hash text:=encode(sha256(convert_to(p_code||clock_timestamp()::text,'UTF8')),'hex');
begin
 r:=public.studio_device_pair_start(p_app,'Mac '||p_code,'macOS',v_hash,p_code);
 perform public.studio_device_pairing_action(p_w,p_app,p_user,'approve',p_code,gen_random_uuid());
 r:=public.studio_device_pair_poll(p_app,(r->>'pairingId')::uuid,v_hash,p_token_hash);
 if r->>'status'<>'approved' then raise exception 'Pairing failed %',r; end if;
 return (r->>'deviceId')::uuid;
end $$;

do $$
declare
 w text:='da000000-0000-4000-8000-000000000001'; w2 text:='da000000-0000-4000-8000-000000000002';
 d uuid; d2 uuid; j uuid; j2 uuid; lease uuid; oldlease uuid; r jsonb; body jsonb; v_count int;
begin
 perform public.studio_create_substo_location(w,'Mac tests','mac-owner');
 perform public.studio_create_substo_location(w2,'Other Mac tests','other-owner');
 if has_table_privilege('authenticated','public.studio_devices','SELECT') or has_column_privilege('service_role','public.studio_devices','token_hash','SELECT')
 or has_table_privilege('service_role','public.studio_device_pairings','SELECT') or has_table_privilege('authenticated','public.studio_device_commands','SELECT')
 or has_function_privilege('service_role','public.studio_claim_device_jobs(uuid,text,text,integer,integer)','EXECUTE')
 or has_function_privilege('anon','public.studio_device_command(text,text,text,jsonb,text)','EXECUTE')
 or has_function_privilege('anon','public.studio_device_pair_start(text,text,text,text,text)','EXECUTE') then raise exception 'Unsafe device privileges'; end if;
 d:=pg_temp.pair_device(w,'substo','mac-owner','AAAABBBB',repeat('a',64));
 d2:=pg_temp.pair_device(w2,'substo','other-owner','AAAACCCC',repeat('b',64));
 if (select app||created_by||processing_enabled::text||paused::text||config_status from public.studio_devices where id=d)<>'substomac-ownerfalsefalsenone' then raise exception 'Device defaults wrong'; end if;
 j:=(public.studio_manage_device(w,'substo','mac-owner','diagnostic','da000000-0000-4000-8000-000000000003',d,'codex','gpt-5')->>'jobId')::uuid;
 if (public.studio_manage_device(w,'substo','mac-owner','diagnostic','da000000-0000-4000-8000-000000000003',d,'codex','gpt-5')->>'jobId')::uuid<>j then raise exception 'Diagnostic not idempotent'; end if;
 if (select payload from public.studio_jobs where id=j)<>'{"provider":"codex","model":"gpt-5"}' then raise exception 'Selection lost'; end if;
 begin perform public.studio_manage_device(w,'substo','mac-owner','diagnostic',gen_random_uuid(),d,'other','model'); raise exception 'Invalid provider'; exception when sqlstate '22023' then null; end;
 begin perform public.studio_manage_device(w,'substo','other-owner','diagnostic',gen_random_uuid(),d); raise exception 'Cross Business manager accepted'; exception when sqlstate '42501' then null; end;
 begin perform public.studio_manage_device(w,'estio','mac-owner','diagnostic',gen_random_uuid(),d); raise exception 'Cross realm manager accepted'; exception when sqlstate '42501' then null; end;
 j2:=(public.studio_manage_device(w2,'substo','other-owner','diagnostic',gen_random_uuid(),d2)->>'jobId')::uuid;
 -- Offline indefinitely: hosted recovery never converts routing or claims the job.
 update public.studio_jobs set run_after=clock_timestamp()-interval '30 days' where id in(j,j2);
 perform public.studio_claim_jobs('hosted-test',50,60);
 if exists(select 1 from public.studio_jobs where id in(j,j2) and (status<>'queued' or attempts<>0 or execution_target<>'device')) then raise exception 'Hosted claimed offline work'; end if;
 begin perform public.studio_device_command(repeat('c',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}'); raise exception 'Bad token accepted'; exception when sqlstate '42501' then null; end;
 begin perform public.studio_device_command(repeat('a',64),'estio','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}'); raise exception 'Cross realm token accepted'; exception when sqlstate '42501' then null; end;
 r:=public.studio_device_command(repeat('a',64),'substo','heartbeat',jsonb_build_object('workerId','mac','release','test','startedAt',clock_timestamp(),'report','{}'::jsonb));
 if (select seen_at from public.studio_devices where id=d) is null or r<>'{"paused":false,"config":{"value":{},"version":0},"commands":[],"processingEnabled":false}' then raise exception 'No heartbeat %',r; end if;
 -- Paused stops every claim, diagnostics included, until resumed.
 perform public.studio_manage_device(w,'substo','mac-owner','set_paused',null,d,null,null,'true');
 if public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":50,"leaseSeconds":60}')<>'[]' then raise exception 'Paused device claimed'; end if;
 if (public.studio_device_command(repeat('a',64),'substo','heartbeat',jsonb_build_object('workerId','mac','startedAt',clock_timestamp()))->>'paused')<>'true' then raise exception 'Pause not reported'; end if;
 perform public.studio_manage_device(w,'substo','mac-owner','set_paused',null,d,null,null,'false');
 r:=public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":50,"leaseSeconds":60}');
 if jsonb_array_length(r)<>1 or r->0->>'id'<>j::text then raise exception 'Cross Business claim %',r; end if;
 lease:=(r->0->>'lease_token')::uuid;
 body:=jsonb_build_object('jobId',j,'workerId','mac','leaseToken',lease,'leaseSeconds',60,'result','{}'::jsonb,'failure',jsonb_build_object('code','test','message','safe','retryable',true));
 if public.studio_device_command(repeat('a',64),'substo','extend',body)<>'true' then raise exception 'Extend rejected'; end if;
 begin perform public.studio_device_command(repeat('b',64),'substo','complete',body); raise exception 'Cross Business complete'; exception when sqlstate '42501' then null; end;
 update public.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
 if public.studio_device_command(repeat('a',64),'substo','complete',body)<>'false' then raise exception 'Expired completion accepted'; end if;
 if public.studio_device_command(repeat('a',64),'substo','extend',body)<>'false' then raise exception 'Expired extension accepted'; end if;
 if public.studio_device_command(repeat('a',64),'substo','fail',body)<>'"lease_lost"' then raise exception 'Expired failure accepted'; end if;
 oldlease:=lease;
 r:=public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}');
 lease:=(r->0->>'lease_token')::uuid;
 if lease is null or lease=oldlease then raise exception 'Recovery did not fence lease'; end if;
 if public.studio_device_command(repeat('a',64),'substo','complete',body)<>'false' then raise exception 'Stale completion accepted'; end if;
 body:=jsonb_set(body,'{leaseToken}',to_jsonb(lease));
 if public.studio_device_command(repeat('a',64),'substo','fail',body)<>'"retry_scheduled"' then raise exception 'Retry semantics lost'; end if;
 update public.studio_jobs set run_after=clock_timestamp()-interval '1 second' where id=j;
 r:=public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}');
 body:=jsonb_set(body,'{leaseToken}',r->0->'lease_token');
 if public.studio_device_command(repeat('a',64),'substo','complete',body)<>'true' or public.studio_device_command(repeat('a',64),'substo','complete',body)<>'false' then raise exception 'Completion idempotency lost'; end if;
 if (select count(*) from public.studio_job_events where job_id=j and event='succeeded')<>1 then raise exception 'Duplicate event'; end if;
 -- Revoke while a valid running lease exists; every operation must be fenced.
 r:=public.studio_device_command(repeat('b',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}');
 body:=jsonb_build_object('jobId',j2,'workerId','mac','leaseToken',r->0->'lease_token','leaseSeconds',60,'result','{}'::jsonb,'commandId',gen_random_uuid(),'status','running');
 perform public.studio_manage_device(w2,'substo','other-owner','revoke',null,d2);
 for r in select to_jsonb(x) from unnest(array['heartbeat','claim','extend','complete','fail','command']) x loop
  begin perform public.studio_device_command(repeat('b',64),'substo',r#>>'{}',body); raise exception 'Revoked operation accepted'; exception when sqlstate '42501' then null; end;
 end loop;
 begin perform public.studio_manage_device(w2,'substo','other-owner','set_processing',null,d2,null,null,'true'); raise exception 'Revoked device changed'; exception when sqlstate '42501' then null; end;
 -- A previously paired manager who loses their role cannot keep operating.
 update public.studio_location_memberships set role='member' where location_id=w and clerk_user_id='mac-owner';
 begin perform public.studio_device_command(repeat('a',64),'substo','heartbeat',body); raise exception 'Former manager still authorized'; exception when sqlstate '42501' then null; end;
 delete from public.studio_location_memberships where location_id=w and clerk_user_id='mac-owner';
 begin perform public.studio_device_command(repeat('a',64),'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60}'); raise exception 'Removed creator still authorized'; exception when sqlstate '42501' then null; end;
 delete from public.studio_locations where location_id in(w,w2);
end $$;

-- Pairing lifecycle: one token, once; expired/denied/consumed codes cannot be approved.
do $$
declare
 w text:='da000000-0000-4000-8000-000000000020'; w2 text:='da000000-0000-4000-8000-000000000021'; e text:='da000000-0000-4000-8000-000000000022';
 p uuid; r jsonb; d uuid; req uuid:=gen_random_uuid(); h text:=repeat('1',64);
begin
 perform public.studio_create_substo_location(w,'Pairing Business','pair-owner');
 perform public.studio_create_substo_location(w2,'Other Business','pair-other');
 insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role) values(w,'substo','pair-member','member');
 insert into public.studio_locations(location_id,app,name) values(e,'estio','Estio Business');
 begin perform public.studio_device_pair_start('tenant','Mac','macOS',repeat('9',64),'ABCDEFGH'); raise exception 'Tenant pairing'; exception when sqlstate '22023' then null; end;
 begin perform public.studio_device_pair_start('substo','Mac','mac$(x)',repeat('9',64),'ABCDEFGH'); raise exception 'Unsafe platform'; exception when sqlstate '23514' then null; end;
 begin perform public.studio_device_pair_start('substo','Mac','macOS',repeat('9',64),'ABCDEFG0'); raise exception 'Ambiguous code'; exception when sqlstate '23514' then null; end;
 p:=(public.studio_device_pair_start('substo',' Studio Mac ','macOS',h,'ABCDEFGH')->>'pairingId')::uuid;
 begin perform public.studio_device_pair_start('substo','Mac','macOS',repeat('2',64),'ABCDEFGH'); raise exception 'Duplicate open code'; exception when sqlstate '23505' then null; end;
 if public.studio_device_pair_poll('substo',p,h,repeat('e',64))->>'status'<>'pending' then raise exception 'Not pending'; end if;
 begin perform public.studio_device_pair_poll('substo',p,repeat('3',64),repeat('e',64)); raise exception 'Wrong device code accepted'; exception when sqlstate '42501' then null; end;
 begin perform public.studio_device_pair_poll('estio',p,h,repeat('e',64)); raise exception 'Cross realm poll'; exception when sqlstate '42501' then null; end;
 r:=public.studio_device_pairing_action(w,'substo','pair-owner','lookup','ABCDEFGH');
 if r->>'name'<>'Studio Mac' or r->>'status'<>'pending' or r->>'platform'<>'macOS' then raise exception 'Lookup %',r; end if;
 begin perform public.studio_device_pairing_action(w,'substo','pair-member','approve','ABCDEFGH',req); raise exception 'Member approved'; exception when sqlstate '42501' then null; end;
 begin perform public.studio_device_pairing_action(w,'estio','pair-owner','approve','ABCDEFGH',req); raise exception 'Cross realm approval'; exception when sqlstate '42501' then null; end;
 begin perform public.studio_device_pairing_action(e,'estio','estio-admin','approve','ABCDEFGH',req); raise exception 'Other app code approved'; exception when sqlstate 'P0002' then null; end;
 r:=public.studio_device_pairing_action(w,'substo','pair-owner','approve','ABCDEFGH',req);
 d:=(r->>'deviceId')::uuid;
 if r->>'name'<>'Studio Mac' or (select location_id from public.studio_devices where id=d)<>w then raise exception 'Approval did not bind Business'; end if;
 if (public.studio_device_pairing_action(w,'substo','pair-owner','approve','ABCDEFGH',req)->>'deviceId')::uuid<>d then raise exception 'Approval not idempotent'; end if;
 begin perform public.studio_device_pairing_action(w,'substo','pair-owner','approve','ABCDEFGH',gen_random_uuid()); raise exception 'Double approval'; exception when sqlstate 'P0002' then null; end;
 begin perform public.studio_device_pairing_action(w2,'substo','pair-other','approve','ABCDEFGH',req); raise exception 'Other Business approval'; exception when sqlstate 'P0002' then null; end;
 begin perform public.studio_device_command(repeat('e',64),'substo','heartbeat','{"workerId":"mac","startedAt":"2026-01-01T00:00:00Z"}'); raise exception 'Token before poll'; exception when sqlstate '42501' then null; end;
 r:=public.studio_device_pair_poll('substo',p,h,repeat('e',64));
 if r->>'status'<>'approved' or (r->>'deviceId')::uuid<>d or r->>'businessName'<>'Pairing Business' then raise exception 'Poll %',r; end if;
 if public.studio_device_pair_poll('substo',p,h,repeat('f',64))->>'status'<>'consumed' then raise exception 'Token reissued'; end if;
 if exists(select 1 from public.studio_devices where token_hash=repeat('f',64)) then raise exception 'Second token stored'; end if;
 perform public.studio_device_command(repeat('e',64),'substo','heartbeat','{"workerId":"mac","startedAt":"2026-01-01T00:00:00Z"}');
 begin perform public.studio_device_pairing_action(w,'substo','pair-owner','approve','ABCDEFGH',gen_random_uuid()); raise exception 'Consumed approval'; exception when sqlstate 'P0002' then null; end;
 -- Denied
 p:=(public.studio_device_pair_start('substo','Mac','macOS',repeat('4',64),'DENYDENY')->>'pairingId')::uuid;
 perform public.studio_device_pairing_action(w,'substo','pair-owner','deny','DENYDENY');
 if public.studio_device_pair_poll('substo',p,repeat('4',64),repeat('5',64))->>'status'<>'denied' then raise exception 'Deny lost'; end if;
 begin perform public.studio_device_pairing_action(w,'substo','pair-owner','approve','DENYDENY',gen_random_uuid()); raise exception 'Denied approval'; exception when sqlstate 'P0002' then null; end;
 -- Expired
 p:=(public.studio_device_pair_start('substo','Mac','macOS',repeat('6',64),'XPRDXPRD')->>'pairingId')::uuid;
 update public.studio_device_pairings set expires_at=clock_timestamp()-interval '1 second' where id=p;
 if public.studio_device_pairing_action(w,'substo','pair-owner','lookup','XPRDXPRD')->>'status'<>'expired' then raise exception 'Expiry lookup'; end if;
 begin perform public.studio_device_pairing_action(w,'substo','pair-owner','approve','XPRDXPRD',gen_random_uuid()); raise exception 'Expired approval'; exception when sqlstate 'P0002' then null; end;
 if public.studio_device_pair_poll('substo',p,repeat('6',64),repeat('7',64))->>'status'<>'expired' then raise exception 'Expired poll'; end if;
 -- Approved but never collected: no usable device survives expiry.
 p:=(public.studio_device_pair_start('substo','Mac','macOS',repeat('8',64),'TARDYTAR')->>'pairingId')::uuid;
 d:=(public.studio_device_pairing_action(w,'substo','pair-owner','approve','TARDYTAR',gen_random_uuid())->>'deviceId')::uuid;
 update public.studio_device_pairings set expires_at=clock_timestamp()-interval '1 second' where id=p;
 r:=public.studio_device_pair_poll('substo',p,repeat('8',64),repeat('7',64));
 -- Separate statements: a single query would not see the poll's own writes.
 if r->>'status'<>'expired' or (select revoked_at from public.studio_devices where id=d) is null
  or exists(select 1 from public.studio_devices where token_hash=repeat('7',64)) then raise exception 'Late token issued'; end if;
 -- Estio: SQL requires the server's per-request ADMIN check for this exact approver.
 p:=(public.studio_device_pair_start('estio','Estio Mac','macOS',repeat('a',63)||'0','ESTMACZZ')->>'pairingId')::uuid;
 d:=(public.studio_device_pairing_action(e,'estio','estio-admin','approve','ESTMACZZ',gen_random_uuid())->>'deviceId')::uuid;
 if public.studio_device_pair_poll('estio',p,repeat('a',63)||'0',repeat('c',63)||'0')->>'businessName'<>'Estio Business' then raise exception 'Estio pairing'; end if;
 if public.studio_device_identity(repeat('c',63)||'0','estio')<>jsonb_build_object('locationId',e,'approvedBy','estio-admin') then raise exception 'Estio identity'; end if;
 begin perform public.studio_device_command(repeat('c',63)||'0','estio','heartbeat','{"workerId":"mac","startedAt":"2026-01-01T00:00:00Z"}'); raise exception 'Unchecked Estio device'; exception when sqlstate '42501' then null; end;
 begin perform public.studio_device_command(repeat('c',63)||'0','estio','heartbeat','{"workerId":"mac","startedAt":"2026-01-01T00:00:00Z"}','someone-else'); raise exception 'Wrong Estio approver'; exception when sqlstate '42501' then null; end;
 perform public.studio_device_command(repeat('c',63)||'0','estio','heartbeat','{"workerId":"mac","startedAt":"2026-01-01T00:00:00Z"}','estio-admin');
 if public.studio_device_identity(repeat('c',63)||'0','substo') is not null then raise exception 'Cross realm identity'; end if;
 delete from public.studio_locations where location_id in(w,w2,e);
end $$;

-- Setup: consent, config versions/acks, provider sign-in commands.
do $$
declare w text:='da000000-0000-4000-8000-000000000030'; d uuid; c uuid; c2 uuid; r jsonb; req uuid:=gen_random_uuid(); t text:=repeat('d',63)||'1';
 hb jsonb:=jsonb_build_object('workerId','mac','startedAt','2026-01-01T00:00:00Z');
begin
 perform public.studio_create_substo_location(w,'Setup Business','setup-owner');
 insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role) values(w,'substo','setup-member','member');
 d:=pg_temp.pair_device(w,'substo','setup-owner','SETUPMAC',t);
 begin perform public.studio_manage_device(w,'substo','setup-member','set_processing',null,d,null,null,'true'); raise exception 'Member consented'; exception when sqlstate '42501' then null; end;
 begin perform public.studio_manage_device(w,'substo','setup-owner','set_processing',null,d,null,null,'"yes"'); raise exception 'Bad consent'; exception when sqlstate '22023' then null; end;
 perform public.studio_manage_device(w,'substo','setup-owner','set_processing',null,d,null,null,'true');
 if (public.studio_manage_device(w,'substo','setup-owner','save_config',null,d,null,null,'{"preference":"speed"}',0)->>'version')<>'1' then raise exception 'Config version'; end if;
 begin perform public.studio_manage_device(w,'substo','setup-owner','save_config',null,d,null,null,'{"preference":"quality"}',0); raise exception 'Stale config saved'; exception when sqlstate '40001' then null; end;
 begin perform public.studio_manage_device(w,'substo','setup-owner','save_config',null,d,null,null,'[]',1); raise exception 'Non-object config'; exception when sqlstate '22023' then null; end;
 r:=public.studio_device_command(t,'substo','heartbeat',hb||'{"configAck":{"version":0,"status":"applied"}}');
 if r->>'processingEnabled'<>'true' or r->'config'<>'{"version":1,"value":{"preference":"speed"}}' then raise exception 'Heartbeat setup %',r; end if;
 if (select config_status||applied_config_version from public.studio_devices where id=d)<>'pending0' then raise exception 'Stale ack applied'; end if;
 perform public.studio_device_command(t,'substo','heartbeat',hb||'{"configAck":{"version":1,"status":"applied","unsupported":{"resources.launchAtLogin":"Needs the installed Mac app (not built yet)"}}}');
 if (select config_status||applied_config_version||(config_report->'unsupported'->>'resources.launchAtLogin') from public.studio_devices where id=d)<>'applied1Needs the installed Mac app (not built yet)' then raise exception 'Ack lost'; end if;
 -- Provider sign-in commands: idempotent per request, one open command per provider.
 begin perform public.studio_manage_device(w,'substo','setup-member','provider_login',req,d,'codex'); raise exception 'Member login'; exception when sqlstate '42501' then null; end;
 c:=(public.studio_manage_device(w,'substo','setup-owner','provider_login',req,d,'codex')->>'commandId')::uuid;
 if (public.studio_manage_device(w,'substo','setup-owner','provider_login',req,d,'codex')->>'commandId')::uuid<>c then raise exception 'Login not idempotent'; end if;
 begin perform public.studio_manage_device(w,'substo','setup-owner','provider_logout',req,d,'codex'); raise exception 'Request reused'; exception when sqlstate '23505' then null; end;
 begin perform public.studio_manage_device(w,'substo','setup-owner','provider_logout',gen_random_uuid(),d,'codex'); raise exception 'Second open command'; exception when sqlstate '23505' then null; end;
 c2:=(public.studio_manage_device(w,'substo','setup-owner','provider_login',gen_random_uuid(),d,'claude')->>'commandId')::uuid;
 r:=public.studio_device_command(t,'substo','heartbeat',hb);
 if jsonb_array_length(r->'commands')<>2 or r->'commands'->0<>jsonb_build_object('id',c,'kind','provider_login','provider','codex') then raise exception 'Commands %',r; end if;
 begin perform public.studio_device_command(t,'substo','command',jsonb_build_object('workerId','mac','commandId',c,'status','running','display',jsonb_build_object('verificationUrl','https://auth.openai.com/codex/device','userCode','ABCD-1234'))); raise exception 'Display before waiting'; exception when sqlstate '22023' then null; end;
 begin perform public.studio_device_command(t,'substo','command',jsonb_build_object('workerId','mac','commandId',c,'status','waiting_for_user','display',jsonb_build_object('verificationUrl','https://x','token','secret'))); raise exception 'Unsafe display'; exception when sqlstate '22023' then null; end;
 begin perform public.studio_device_command(t,'substo','command',jsonb_build_object('workerId','mac','commandId',c,'status','waiting_for_user','display',jsonb_build_object('verificationUrl','http://auth.openai.com'))); raise exception 'Plain HTTP display'; exception when sqlstate '22023' then null; end;
 if public.studio_device_command(t,'substo','command',jsonb_build_object('workerId','mac','commandId',c,'status','running'))->>'status'<>'running' then raise exception 'Running'; end if;
 perform public.studio_device_command(t,'substo','command',jsonb_build_object('workerId','mac','commandId',c,'status','waiting_for_user','display',jsonb_build_object('verificationUrl','https://auth.openai.com/codex/device','userCode','ABCD-1234')));
 if (select display->>'userCode' from public.studio_device_commands where id=c)<>'ABCD-1234' then raise exception 'Display lost'; end if;
 r:=public.studio_device_command(t,'substo','heartbeat',hb);
 if jsonb_array_length(r->'commands')<>1 then raise exception 'Non-pending command listed'; end if;
 perform public.studio_device_command(t,'substo','command',jsonb_build_object('workerId','mac','commandId',c,'status','succeeded'));
 if (select status||display::text||(finished_at is not null)::text from public.studio_device_commands where id=c)<>'succeeded{}true' then raise exception 'Success not final'; end if;
 if public.studio_device_command(t,'substo','command',jsonb_build_object('workerId','mac','commandId',c,'status','failed','error','late'))->>'status'<>'succeeded' then raise exception 'Final overwritten'; end if;
 perform public.studio_manage_device(w,'substo','setup-owner','cancel_command',null,null,null,null,null,null,c2);
 if public.studio_device_command(t,'substo','command',jsonb_build_object('workerId','mac','commandId',c2,'status','running'))->>'status'<>'cancelled' then raise exception 'Cancel ignored'; end if;
 -- Abandoned commands time out instead of blocking new sign-ins.
 c:=(public.studio_manage_device(w,'substo','setup-owner','provider_logout',gen_random_uuid(),d,'codex')->>'commandId')::uuid;
 update public.studio_device_commands set created_at=clock_timestamp()-interval '21 minutes' where id=c;
 perform public.studio_device_command(t,'substo','heartbeat',hb);
 if (select status from public.studio_device_commands where id=c)<>'failed' then raise exception 'Stale command kept'; end if;
 c:=(public.studio_manage_device(w,'substo','setup-owner','provider_login',gen_random_uuid(),d,'codex')->>'commandId')::uuid;
 perform public.studio_manage_device(w,'substo','setup-owner','revoke',null,d);
 if (select status from public.studio_device_commands where id=c)<>'cancelled' then raise exception 'Revoke left command open'; end if;
 delete from public.studio_locations where location_id=w;
end $$;

-- Manual retries must not let a member spend a paired manager's subscription.
do $$
declare
 w text:='da000000-0000-4000-8000-000000000010';
 d uuid; j uuid; hosted public.studio_jobs%rowtype; retried public.studio_jobs%rowtype;
begin
 perform public.studio_create_substo_location(w,'Device retry tests','retry-owner');
 insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role)
 values(w,'substo','retry-member','member'),(w,'substo','retry-admin','admin');
 d:=pg_temp.pair_device(w,'substo','retry-owner','RETRYMAC',repeat('d',64));
 j:=(public.studio_manage_device(w,'substo','retry-owner','diagnostic',gen_random_uuid(),d)->>'jobId')::uuid;
 update public.studio_jobs set status='failed',attempts=max_attempts,finished_at=clock_timestamp() where id=j;
 begin
  perform public.studio_member_job_action(w,'substo','retry-member',j,'retry');
  raise exception 'Member retried device job';
 exception when sqlstate '42501' then null; end;
 if exists(select 1 from public.studio_jobs where id=j and (status<>'failed' or attempts<>max_attempts))
  or exists(select 1 from public.studio_job_events where job_id=j and event='requeued') then
  raise exception 'Forbidden retry changed job or events';
 end if;
 retried:=public.studio_member_job_action(w,'substo','retry-admin',j,'retry');
 if retried.status<>'queued' or retried.attempts<>0 or retried.finished_at is not null
  or retried.execution_target<>'device' or retried.device_id<>d
  or (select count(*) from public.studio_job_events where job_id=j and event='requeued' and actor_clerk_user_id='retry-admin')<>1 then
  raise exception 'Admin device retry lost existing semantics';
 end if;
 -- Cancel remains a member action, including for device jobs.
 retried:=public.studio_member_job_action(w,'substo','retry-member',j,'cancel');
 if retried.status<>'cancelled' then raise exception 'Member device cancel regressed'; end if;
 update public.studio_jobs set status='failed',attempts=max_attempts,finished_at=clock_timestamp() where id=j;
 perform public.studio_manage_device(w,'substo','retry-owner','revoke',null,d);
 begin
  perform public.studio_member_job_action(w,'substo','retry-admin',j,'retry');
  raise exception 'Admin retried revoked device job';
 exception when sqlstate '42501' then null; end;
 if exists(select 1 from public.studio_jobs where id=j and (status<>'failed' or attempts<>max_attempts))
  or (select count(*) from public.studio_job_events where job_id=j and event='requeued')<>1 then
  raise exception 'Revoked retry changed job or events';
 end if;
 hosted:=public.studio_enqueue_job(w,'studio.diagnostic','{}',null,'retry-member',3);
 update public.studio_jobs set status='failed',attempts=max_attempts,finished_at=clock_timestamp() where id=hosted.id;
 hosted:=public.studio_member_job_action(w,'substo','retry-member',hosted.id,'retry');
 if hosted.status<>'queued' or hosted.attempts<>0 or hosted.finished_at is not null or hosted.execution_target<>'hosted' then
  raise exception 'Member hosted retry regressed';
 end if;
 hosted:=public.studio_member_job_action(w,'substo','retry-member',hosted.id,'cancel');
 if hosted.status<>'cancelled' then raise exception 'Member hosted cancel regressed'; end if;
 delete from public.studio_locations where location_id=w;
end $$;
