-- Synthetic fixtures only. AI credential authority and atomic budget enforcement.
do $$
declare
  w text := '8f000000-0000-4000-8000-000000000001';
  e text := '8f000000-0000-4000-8000-000000000002';
  ct text := 'c2VjcmV0'; iv text := 'AAAAAAAAAAAAAAAA'; tag text := 'AAAAAAAAAAAAAAAAAAAAAA==';
  r1 uuid; r2 uuid; result jsonb; t text; op text;
begin
  foreach t in array array['studio_location_ai_credentials','studio_location_ai_settings','studio_ai_usage'] loop
    foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('service_role','public.'||t,op) then raise exception 'Unsafe direct write on %', t; end if;
    end loop;
    if has_table_privilege('authenticated','public.'||t,'SELECT') or has_table_privilege('anon','public.'||t,'SELECT') then raise exception 'Client can read %', t; end if;
  end loop;
  if has_function_privilege('authenticated','public.studio_reserve_ai_spend(text,text,text,bigint)','EXECUTE')
    or has_function_privilege('service_role','public.studio_lock_ai_manager(text,text,text)','EXECUTE') then raise exception 'Unsafe AI RPC grants'; end if;

  perform public.studio_create_substo_location(w,'AI fixture','ai-owner');
  insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role) values(w,'substo','ai-member','member'),(w,'substo','ai-admin','admin');
  insert into public.studio_locations(location_id,app,name) values(e,'estio','Estio AI');

  begin perform public.studio_set_ai_credential(w,'substo','ai-member','openai',ct,iv,tag,'v1','abcd'); raise exception 'Member set key';
  exception when sqlstate '42501' then null; end;
  begin perform public.studio_set_ai_credential(w,'estio','ai-owner','openai',ct,iv,tag,'v1','abcd'); raise exception 'Wrong app set key';
  exception when sqlstate '42501' then null; end;
  begin perform public.studio_set_ai_credential(w,'substo','ai-owner','openai','not base64!',iv,tag,'v1','abcd'); raise exception 'Bad ciphertext stored';
  exception when sqlstate '23514' then null; end;
  begin perform public.studio_set_ai_credential(w,'substo','ai-owner','anthropic',ct,iv,tag,'v1','abcd'); raise exception 'Unknown provider stored';
  exception when sqlstate '23514' then null; end;

  -- No key and no budget: nothing can be reserved.
  if public.studio_reserve_ai_spend(w,'openai','transcribe',1) is not null then raise exception 'Reserved without key or budget'; end if;
  result := public.studio_set_ai_credential(w,'substo','ai-admin','openai',ct,iv,tag,'v1','abcd');
  if result->>'keyHint' <> 'abcd' or (result->>'version')::int <> 1 then raise exception 'Unexpected credential %', result; end if;
  if (public.studio_set_ai_credential(w,'substo','ai-owner','openai',ct,iv,tag,'v1','wxyz'))->>'version' <> '2' then raise exception 'Key rotation not versioned'; end if;
  if public.studio_reserve_ai_spend(w,'openai','transcribe',1) is not null then raise exception 'Reserved with zero budget'; end if;
  begin perform public.studio_set_ai_budget(w,'substo','ai-member',5000000); raise exception 'Member set budget';
  exception when sqlstate '42501' then null; end;
  perform public.studio_set_ai_budget(w,'substo','ai-owner',1000000);

  r1 := public.studio_reserve_ai_spend(w,'openai','transcribe',600000);
  if r1 is null then raise exception 'Reservation within budget refused'; end if;
  if public.studio_reserve_ai_spend(w,'openai','transcribe',500000) is not null then raise exception 'Reservation over cap accepted'; end if;
  perform public.studio_settle_ai_spend(w,r1,200000,'whisper-1',null,null,60);
  r2 := public.studio_reserve_ai_spend(w,'openai','summarize',800000);
  if r2 is null then raise exception 'Settled lower cost did not free budget'; end if;
  if public.studio_reserve_ai_spend(w,'openai','x',1) is not null then raise exception 'Cap not enforced after settle'; end if;
  if not public.studio_release_ai_spend(w,r2) or public.studio_release_ai_spend(w,r2) then raise exception 'Release not single-shot'; end if;
  if (public.studio_settle_ai_spend(w,r1,200000,'whisper-1',null,null,60))->'replayed' <> 'true'::jsonb then raise exception 'Settle replay'; end if;
  begin perform public.studio_settle_ai_spend(w,r1,1,'whisper-1',null,null,60); raise exception 'Resettled differently';
  exception when sqlstate '23505' then null; end;
  begin perform public.studio_settle_ai_spend(e,r1,200000,'whisper-1',null,null,60); raise exception 'Cross-location settle';
  exception when sqlstate '22023' then null; end;

  if not public.studio_clear_ai_credential(w,'substo','ai-owner','openai') then raise exception 'Clear failed'; end if;
  if public.studio_reserve_ai_spend(w,'openai','transcribe',1) is not null then raise exception 'Reserved after key removed'; end if;

  -- Estio authority is decided by the server; the RPC enforces app only.
  perform public.studio_set_ai_budget(e,'estio','estio-admin',1);
end;
$$;
select 'Studio AI credential assertions passed' as result;
