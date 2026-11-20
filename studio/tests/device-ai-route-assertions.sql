-- Real device leases with synthetic results; no model/provider calls.
create table if not exists public.settings_documents(scope_type text,scope_id text,domain text,payload jsonb);
create table if not exists public.settings_secrets(scope_type text,scope_id text,domain text,secret_key text);
do $$
declare
 w text:='dab10000-0000-4000-8000-000000000001'; src uuid:=gen_random_uuid(); vid uuid:=gen_random_uuid(); expired_vid uuid:=gen_random_uuid(); d uuid; j uuid;
 h text:=repeat('8e',32); c text:=encode(sha256(convert_to('DARXAAAA','UTF8')),'hex');
 r jsonb; body jsonb; claim jsonb; research_payload jsonb:='{"batch":"batch","topic":"contact","input":{},"pages":[],"app":"substo"}';
begin
 perform studio.studio_create_substo_location(w,'Device route fixtures','dev-route-owner');
 r:=studio.studio_device_pair_start('substo','Route Mac','macOS',c,'DARXAAAA');
 perform studio.studio_device_pairing_action(w,'substo','dev-route-owner','approve','DARXAAAA',gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,c,h);
 d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,desired_config='{"features":{"text":true,"transcription":true},"textProvider":"codex","textModel":"gpt-5.5"}',
  config_version=2,applied_config_version=2,config_status='applied',seen_at=clock_timestamp(),
  report='{"textRouteVersion":1,"deviceAiRouteVersion":1,"handlers":["studio.library_summary","studio.onboarding_research","studio.youtube_search","studio.video_transcribe"],
   "video":{"ready":true},"youtubeSearch":{"ready":true,"rank":true},"capacity":{"codex":true,"claude":true},
   "codex":{"ready":true,"authenticated":true,"loginMethod":"chatgpt","models":["gpt-5.5"]},
   "claude":{"ready":true,"authenticated":true,"loginMethod":"claudeai","models":["opus","haiku"]}}'
  where id=d;
 insert into public.settings_documents values('LOCATION',w,'location.ai',
  '{"aiRouting":{"chain":[{"kind":"device_claude","model":"opus"},{"kind":"chatgpt_subscription"},{"kind":"device_codex"}],
   "taskDefaults":{"summaries":{"device_claude":"haiku"}}}}');

 insert into studio.studio_records(location_id,id,kind,title,payload) values(w,src,'reference','Source','{"description":"Synthetic evidence."}');
 perform studio.studio_request_library_summary(w,'substo','dev-route-owner',src);
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"summaryReady":true}');
 if claim#>>'{0,kind}' is distinct from 'studio.library_summary' or claim#>>'{0,route,candidates,0,model}' is distinct from 'haiku'
  or claim#>>'{0,route,candidates,1,kind}' is distinct from 'device_codex' or jsonb_array_length(claim#>'{0,route,candidates}')<>2
  then raise exception 'Summary did not pin supported steps %',claim; end if;
 j:=(claim#>>'{0,id}')::uuid;
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim#>>'{0,lease_token}');
 begin
  perform studio.studio_routed_device_command(h,'substo','complete',body||'{"result":{"summary":"Fiction","provider":"claude","model":"opus"}}');
  raise exception 'Unadmitted summary model accepted';
 exception when sqlstate '22023' then null; end;
 if studio.studio_routed_device_command(h,'substo','complete',body||'{"result":{"summary":"Synthetic summary","provider":"codex","model":"gpt-5.5"}}') is distinct from 'true'::jsonb
  then raise exception 'Allowed summary fallback did not complete'; end if;
 if (select route#>>'{actual,model}' from studio.studio_jobs where id=j) is distinct from 'gpt-5.5'
  or (select payload->>'summaryProvider' from studio.studio_records where id=src) is distinct from 'codex'
  then raise exception 'Summary attribution did not persist'; end if;

 if studio.studio_onboarding_mac_routes(w,'substo','other-account')<>'[]' or studio.studio_onboarding_mac_routes(w,'estio','dev-route-owner')<>'[]'
  then raise exception 'Unowned onboarding Mac was exposed'; end if;
 if studio.studio_onboarding_mac_routes(w,'substo','dev-route-owner')#>>'{0,model}' is distinct from 'opus'
  then raise exception 'Onboarding did not use the Location step model'; end if;
 r:=studio.studio_enqueue_routed_onboarding_research(w,'substo','dev-route-owner',d,research_payload,'device-ai-success',
  array['device_claude'],array['chatgpt_subscription','device_codex'],'{"kind":"device_claude","model":"opus"}',null);
 j:=(r->>'jobId')::uuid;
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}');
 if claim#>>'{0,id}' is distinct from j::text or claim#>>'{0,route,candidates,0,model}' is distinct from 'opus'
  then raise exception 'Onboarding lost the pinned route %',claim; end if;
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim#>>'{0,lease_token}');
 if studio.studio_routed_device_command(h,'substo','complete',body||'{"result":{"research":{"businessName":"Fiction","fields":[]},"provider":"claude","model":"opus"}}')
  is distinct from 'true'::jsonb then raise exception 'Named onboarding model failed'; end if;
 if (select result->>'model' from studio.studio_jobs where id=j) is distinct from 'opus'
  or exists(select 1 from studio.studio_jobs where kind='studio.onboarding_apply' and payload->>'jobId'=j::text and payload ? 'continuation')
  then raise exception 'Onboarding completion attribution or replay is wrong'; end if;

 r:=studio.studio_enqueue_routed_onboarding_research(w,'substo','dev-route-owner',d,research_payload,'device-ai-wait',
  array['device_claude'],array['chatgpt_subscription','device_codex'],'{"kind":"device_claude","model":"opus"}',null);
 j:=(r->>'jobId')::uuid;
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim#>>'{0,lease_token}');
 perform studio.studio_routed_device_command(h,'substo','fail',body||'{"failure":{"code":"onboarding_route_wait","message":"Before generation","retryable":false}}');
 if not exists(select 1 from studio.studio_jobs where kind='studio.onboarding_apply' and payload->>'jobId'=j::text
   and payload#>>'{continuation,remainingKinds,0}'='chatgpt_subscription' and payload#>>'{continuation,createdBy}'='dev-route-owner')
  then raise exception 'Confirmed pre-generation wait did not continue safely'; end if;

 r:=studio.studio_enqueue_routed_onboarding_research(w,'substo','dev-route-owner',d,research_payload,'device-ai-uncertain',
  array['device_claude'],array['chatgpt_subscription'],'{"kind":"device_claude","model":"opus"}',null);
 j:=(r->>'jobId')::uuid;
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}');
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim#>>'{0,lease_token}');
 perform studio.studio_routed_device_command(h,'substo','fail',body||'{"failure":{"code":"research_failed","message":"After dispatch","retryable":false}}');
 if exists(select 1 from studio.studio_jobs where kind='studio.onboarding_apply' and payload->>'jobId'=j::text and payload ? 'continuation')
  then raise exception 'Uncertain onboarding would replay on another provider'; end if;

 r:=studio.studio_enqueue_youtube_search(w,'substo','dev-route-owner',
  '{"query":"fixture","requestKey":"device-ai-search","mode":"plan_search_rank","source":{},"context":{}}');
 j:=(r->>'jobId')::uuid;
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"youtubeReady":true}');
 if claim#>>'{0,id}' is distinct from j::text or claim#>>'{0,route,candidates,0,model}' is distinct from 'opus'
  then raise exception 'Related-video search lost Location model order %',claim; end if;
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim#>>'{0,lease_token}');
 if studio.studio_routed_device_command(h,'substo','complete',body||'{"result":{"videos":[],"trace":{"planner":{"provider":"claude","model":"opus"}}}}')
  is distinct from 'true'::jsonb then raise exception 'Related-video attribution was rejected'; end if;
 if (select route#>>'{actual,model}' from studio.studio_jobs where id=j) is distinct from 'opus' then
  raise exception 'Related-video actual model was not recorded'; end if;
 -- The same queued route is recorded in gated video relevance, and expiry cannot replay it.
 insert into studio.studio_records(location_id,id,kind,title,payload) values
  (w,vid,'reference','Video A','{"url":"https://www.youtube.com/watch?v=aaaaaaaaaaa"}');
 r:=studio.studio_video_enqueue_core(w,'substo','dev-route-owner',vid,'approved_channel','device-ai-video',
  studio.studio_video_gate('{}'),false);
 j:=(r->>'jobId')::uuid;
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"videoReady":true}');
 if claim#>>'{0,id}' is distinct from j::text or claim#>>'{0,route,candidates,0,model}' is distinct from 'opus'
  then raise exception 'Gated relevance lost the research model % / %',r,claim; end if;
 body:=jsonb_build_object('workerId','mac','jobId',j,'leaseToken',claim#>>'{0,lease_token}');
 if studio.studio_routed_device_command(h,'substo','complete',body||
   '{"result":{"outcome":"relevance_skipped","relevance":{"relevant":false,"score":20,"reason":"Synthetic reason","matches":[]}},"routeActual":{"provider":"claude","model":"opus"}}')
  is distinct from 'true'::jsonb then raise exception 'Gated relevance attribution rejected'; end if;
 if (select route#>>'{actual,model}' from studio.studio_jobs where id=j) is distinct from 'opus' then raise exception 'Gated relevance attribution lost'; end if;

 insert into studio.studio_records(location_id,id,kind,title,payload) values
  (w,expired_vid,'reference','Video B','{"url":"https://www.youtube.com/watch?v=bbbbbbbbbbb"}');
 r:=studio.studio_video_enqueue_core(w,'substo','dev-route-owner',expired_vid,'approved_channel','device-ai-expired-video',
  studio.studio_video_gate('{}'),false);
 j:=(r->>'jobId')::uuid;
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"videoReady":true}');
 if claim#>>'{0,id}' is distinct from j::text then raise exception 'Video did not claim for lease fence test %',claim; end if;
 update studio.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"videoReady":true}');
 if claim<>'[]' or (select last_error_code from studio.studio_jobs where id=j) is distinct from 'video_relevance_execution_uncertain'
  or (select status from studio.studio_video_transcriptions where job_id=j) is distinct from 'failed'
  then raise exception 'Gated video was replayed or left pending after expiry %',claim; end if;

 r:=studio.studio_enqueue_routed_onboarding_research(w,'substo','dev-route-owner',d,research_payload,'device-ai-expired',
  array['device_claude'],array['chatgpt_subscription'],'{"kind":"device_claude","model":"opus"}',null);
 j:=(r->>'jobId')::uuid;
 claim:=studio.studio_routed_device_command(h,'substo','claim','{"workerId":"mac","limit":1,"leaseSeconds":60,"researchReady":true}');
 if claim#>>'{0,id}' is distinct from j::text then raise exception 'Onboarding did not claim for lease fence test %',claim; end if;
 update studio.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
 perform studio.studio_claim_jobs('hosted-fixture',1,60);
 if (select last_error_code from studio.studio_jobs where id=j) is distinct from 'research_execution_uncertain'
  or exists(select 1 from studio.studio_jobs where kind='studio.onboarding_apply' and payload->>'jobId'=j::text and payload ? 'continuation')
  then raise exception 'Expired device lease replayed onboarding generation'; end if;
 if exists(select 1 from studio.studio_ai_usage where location_id=w) then raise exception 'Mac AI incorrectly reserved paid usage'; end if;
end $$;
