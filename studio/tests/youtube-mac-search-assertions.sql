-- Real SQL against an isolated PostgreSQL cluster. No credentials, network or providers.
create function pg_temp.pair(w text,actor text,code text,hash text,ready boolean default true) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,seen_at=clock_timestamp(),
  report=jsonb_build_object('handlers',jsonb_build_array('studio.youtube_search'),'youtubeSearch',jsonb_build_object('ready',ready)) where id=d;
 return d;
end $$;
create function pg_temp.enq(w text,actor text,q text,k text) returns jsonb language sql as $$
 select studio.studio_enqueue_youtube_search(w,'substo',actor,jsonb_build_object('query',q,'requestKey',k,'limit',5))
$$;
create function pg_temp.claim(hash text,ready boolean default true) returns jsonb language sql as $$
 select studio.studio_youtube_search_device_command(hash,'substo','claim',jsonb_build_object('workerId','mac','limit',1,'leaseSeconds',120,'youtubeReady',ready))
$$;
do $$
declare w text:='ae000000-0000-4000-8000-000000000001'; w2 text:='ae000000-0000-4000-8000-000000000002';
 d uuid; d2 uuid; r jsonb; c jsonb; j uuid; tok uuid; rows int; vid jsonb;
begin
 perform studio.studio_create_substo_location(w,'YT fixture','yt-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','yt-other');
 insert into studio.studio_location_members(location_id,location_app,clerk_user_id,role) values(w,'substo','yt-member','member') on conflict do nothing;
 d:=pg_temp.pair(w,'yt-owner','TYTAAAAA',repeat('1',64));
 d2:=pg_temp.pair(w2,'yt-other','TYTBBBBB',repeat('2',64));
 if not exists(select 1 from studio.studio_devices where id=d and 'studio.youtube_search'=any(allowed_kinds)) then raise exception 'Processing On did not grant YouTube search'; end if;
 if has_function_privilege('authenticated','studio.studio_youtube_search_device_command(text,text,text,jsonb,text,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','studio.studio_enqueue_youtube_search(text,text,text,jsonb)','EXECUTE')
  or not has_function_privilege('service_role','studio.studio_enqueue_youtube_search(text,text,text,jsonb)','EXECUTE') then raise exception 'Unsafe YouTube search grants'; end if;

 -- Authority and validation.
 begin perform pg_temp.enq(w,'yt-other','ads','k0');raise exception 'Cross tenant accepted';exception when sqlstate '42501' then null;end;
 begin perform pg_temp.enq(w,'yt-member','ads','k0');raise exception 'Member without Mac authority enqueued';exception when sqlstate '42501' then null;end;
 begin perform pg_temp.enq(w,'yt-owner','   ','k0');raise exception 'Empty query accepted';exception when sqlstate '22023' then null;end;
 begin perform pg_temp.enq(w,'yt-owner',repeat('x',161),'k0');raise exception 'Long query accepted';exception when sqlstate '22023' then null;end;
 begin perform pg_temp.enq(w,'yt-owner','ads','bad key!');raise exception 'Bad key accepted';exception when sqlstate '22023' then null;end;
 -- A teammate's Mac is never borrowed.
 update studio.studio_devices set created_by='yt-teammate' where id=d;
 begin perform pg_temp.enq(w,'yt-owner','ads','k0');raise exception 'Teammate Mac borrowed';exception when sqlstate 'YS001' then null;end;
 update studio.studio_devices set created_by='yt-owner',processing_enabled=false where id=d;
 begin perform pg_temp.enq(w,'yt-owner','ads','k0');raise exception 'Processing off accepted';exception when sqlstate 'YS002' then null;end;
 update studio.studio_devices set processing_enabled=true where id=d;
 update studio.studio_devices set report=jsonb_build_object('handlers',jsonb_build_array('studio.diagnostic')) where id=d;
 begin perform pg_temp.enq(w,'yt-owner','ads','k0');raise exception 'Outdated companion accepted';exception when sqlstate 'YS004' then null;end;
 update studio.studio_devices set report=jsonb_build_object('handlers',jsonb_build_array('studio.youtube_search'),'youtubeSearch',jsonb_build_object('ready',false)) where id=d;
 begin perform pg_temp.enq(w,'yt-owner','ads','k0');raise exception 'Browser missing accepted';exception when sqlstate 'YS003' then null;end;
 update studio.studio_devices set report=jsonb_build_object('handlers',jsonb_build_array('studio.youtube_search'),'youtubeSearch',jsonb_build_object('ready',true)) where id=d;

 -- Enqueue, idempotency and device-only execution.
 r:=pg_temp.enq(w,'yt-owner','ads that convert','k1'); j:=(r->>'jobId')::uuid;
 if r->>'status'<>'queued' or pg_temp.enq(w,'yt-owner','ads that convert','k1')->>'jobId'<>j::text then raise exception 'Enqueue not idempotent'; end if;
 if not exists(select 1 from studio.studio_jobs where id=j and execution_target='device' and device_id=d and kind='studio.youtube_search' and max_attempts=1) then raise exception 'Job is not device-only'; end if;
 -- Another Mac cannot claim it; an unready Mac claims nothing.
 if jsonb_array_length(pg_temp.claim(repeat('2',64)))<>0 then raise exception 'Other tenant claimed the job'; end if;
 if jsonb_array_length(pg_temp.claim(repeat('1',64),false))<>0 then raise exception 'Unready Mac claimed the job'; end if;
 c:=pg_temp.claim(repeat('1',64));
 if jsonb_array_length(c)<>1 or c->0->>'kind'<>'studio.youtube_search' then raise exception 'Mac did not claim the search: %',c; end if;
 tok:=(c->0->>'lease_token')::uuid;
 if jsonb_array_length(pg_temp.claim(repeat('1',64)))<>0 then raise exception 'Second claim while leased'; end if;
 -- Result validation.
 begin perform studio.studio_youtube_search_device_command(repeat('1',64),'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('videos',jsonb_build_array(jsonb_build_object('id','short','title','x')))));raise exception 'Bad id accepted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_youtube_search_device_command(repeat('1',64),'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',jsonb_build_object('videos',jsonb_build_array(jsonb_build_object('id','aaaaaaaaaaa','title','x','url','http://evil')))));raise exception 'Extra key accepted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_youtube_search_device_command(repeat('1',64),'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',gen_random_uuid(),'result',jsonb_build_object('videos','[]'::jsonb)));exception when others then raise exception 'Wrong lease should return false, not raise'; end;
 if (studio.studio_youtube_search_device_command(repeat('1',64),'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',gen_random_uuid(),'result',jsonb_build_object('videos','[]'::jsonb))))::text<>'false' then raise exception 'Wrong lease completed'; end if;
 vid:=jsonb_build_object('videos',jsonb_build_array(jsonb_build_object('id','aaaaaaaaaaa','title','Facebook ads','channelId','UC'||repeat('a',22),'channelTitle','Think Media','publishedText','2 years ago','viewsText','1.2M views')),'signedIn',true);
 if (studio.studio_youtube_search_device_command(repeat('1',64),'substo','complete',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'result',vid)))::text<>'true' then raise exception 'Complete failed'; end if;
 if not exists(select 1 from studio.studio_jobs where id=j and status='succeeded' and result->'videos'->0->>'id'='aaaaaaaaaaa') then raise exception 'Result not stored'; end if;

 -- Failure is not retried; an abandoned lease fails rather than replays.
 r:=pg_temp.enq(w,'yt-owner','second','k2'); c:=pg_temp.claim(repeat('1',64)); tok:=(c->0->>'lease_token')::uuid; j:=(r->>'jobId')::uuid;
 if (studio.studio_youtube_search_device_command(repeat('1',64),'substo','fail',jsonb_build_object('workerId','mac','jobId',j,'leaseToken',tok,'failure',jsonb_build_object('code','youtube_blocked','message','Captcha','retryable',true))))::text<>'"failed"' then raise exception 'Search was retried'; end if;
 r:=pg_temp.enq(w,'yt-owner','third','k3'); c:=pg_temp.claim(repeat('1',64)); j:=(r->>'jobId')::uuid;
 update studio.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
 perform pg_temp.claim(repeat('1',64));
 if not exists(select 1 from studio.studio_jobs where id=j and status='failed' and last_error_code='worker_lease_expired') then raise exception 'Abandoned search was replayed'; end if;

 -- Consent withdrawal cancels queued searches.
 r:=pg_temp.enq(w,'yt-owner','fourth','k4'); j:=(r->>'jobId')::uuid;
 update studio.studio_devices set processing_enabled=false where id=d;
 if not exists(select 1 from studio.studio_jobs where id=j and status='cancelled') then raise exception 'Queued search survived consent withdrawal'; end if;
 -- Non-youtube operations pass through to the existing protocol.
 update studio.studio_devices set processing_enabled=true where id=d;
 if jsonb_typeof(studio.studio_youtube_search_device_command(repeat('1',64),'substo','claim',jsonb_build_object('workerId','mac','limit',1,'leaseSeconds',120)))<>'array' then raise exception 'Fallthrough claim broken'; end if;
end $$;

-- Tier 2: hosted egress search admission.
do $$
declare w text:='ae000000-0000-4000-8000-000000000001'; r jsonb; j uuid; n int;
begin
 if has_function_privilege('authenticated','studio.studio_enqueue_youtube_search_egress(text,text,text,jsonb)','EXECUTE')
  or not has_function_privilege('service_role','studio.studio_enqueue_youtube_search_egress(text,text,text,jsonb)','EXECUTE') then raise exception 'Unsafe egress grants'; end if;
 begin perform studio.studio_enqueue_youtube_search_egress(w,'substo','yt-other',jsonb_build_object('query','ads','requestKey','e0','limit',5));raise exception 'Cross tenant accepted';exception when sqlstate '42501' then null;end;
 begin perform studio.studio_enqueue_youtube_search_egress(w,'substo','yt-member',jsonb_build_object('query','ads','requestKey','e0','limit',5));raise exception 'Member without authority enqueued';exception when sqlstate '42501' then null;end;
 begin perform studio.studio_enqueue_youtube_search_egress(w,'substo','yt-owner',jsonb_build_object('query','','requestKey','e0','limit',5));raise exception 'Empty query accepted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_enqueue_youtube_search_egress(w,'substo','yt-owner',jsonb_build_object('query','ads','requestKey','e0','limit',99));raise exception 'Big limit accepted';exception when sqlstate '22023' then null;end;
 begin perform studio.studio_enqueue_youtube_search_egress(w,'substo','yt-owner',jsonb_build_object('query','ads','requestKey','e0','limit',5,'macReason','bad reason!'));raise exception 'Bad reason accepted';exception when sqlstate '22023' then null;end;
 r:=studio.studio_enqueue_youtube_search_egress(w,'substo','yt-owner',jsonb_build_object('query','ads that convert','requestKey','e1','limit',6,'macReason','YS001')); j:=(r->>'jobId')::uuid;
 if studio.studio_enqueue_youtube_search_egress(w,'substo','yt-owner',jsonb_build_object('query','ads that convert','requestKey','e1','limit',6,'macReason','YS001'))->>'jobId'<>j::text then raise exception 'Egress enqueue not idempotent'; end if;
 if not exists(select 1 from studio.studio_jobs where id=j and execution_target='hosted' and device_id is null and kind='studio.youtube_search_egress' and max_attempts=1 and payload->>'macReason'='YS001') then raise exception 'Egress job shape wrong'; end if;
 -- A hosted worker, not a paired Mac, claims it.
 select count(*) into n from studio.studio_claim_jobs('hosted-test',5,60) x where x.id=j;
 if n<>1 then raise exception 'Hosted worker did not claim the egress job'; end if;
end $$;
