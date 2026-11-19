BEGIN;
-- Related videos: model-planned queries, model relevance ranking, and a stored trace of every run (additive; replaces the Mac search admission/protocol functions).
CREATE OR REPLACE FUNCTION studio.studio_enqueue_youtube_search(p_location_id text,p_actor_app text,p_clerk_user_id text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare q text:=btrim(coalesce(p_command->>'query','')); k text:=p_command->>'requestKey'; lim integer; mode text:=coalesce(p_command->>'mode','search'); d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; why text;
 rank_ok boolean; src jsonb:=p_command->'source'; ctx jsonb:=p_command->'context'; cands jsonb:=p_command->'candidates';
begin
 if jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>40000 or char_length(q) not between 1 and 160 or k is null or k !~ '^[A-Za-z0-9:._-]{1,120}$'
  or coalesce(p_command->>'limit','5') !~ '^[0-9]{1,2}$' or mode not in ('search','plan_search_rank','rank')
  or (mode in ('plan_search_rank','rank') and (jsonb_typeof(src) is distinct from 'object' or jsonb_typeof(ctx) is distinct from 'object'))
  or (mode='rank' and (jsonb_typeof(cands) is distinct from 'array' or jsonb_array_length(cands) not between 1 and 24))
  or (mode<>'rank' and cands is not null) then raise exception 'Invalid YouTube search' using errcode='22023'; end if;
 lim:=coalesce(p_command->>'limit','5')::integer;
 if lim not between 3 and 12 then raise exception 'Invalid YouTube search' using errcode='22023'; end if;
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if (select count(*) from studio.studio_jobs where location_id=p_location_id and kind='studio.youtube_search' and created_by_clerk_user_id=p_clerk_user_id and created_at>clock_timestamp()-interval '1 minute')>=20
  then raise exception 'Too many searches' using errcode='YS005'; end if;
 select * into d from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null
  and x.processing_enabled and 'studio.youtube_search'=any(x.allowed_kinds) and x.report->'handlers' ? 'studio.youtube_search'
  and (case when mode='rank' then x.report#>>'{youtubeSearch,rank}'='true' else x.report#>>'{youtubeSearch,ready}'='true' end) order by x.seen_at desc nulls last limit 1 for share;
 if not found then
  why:=case
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null) then 'YS001'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled) then 'YS002'
   when not exists(select 1 from studio.studio_devices x where x.location_id=p_location_id and x.app=p_actor_app and x.created_by=p_clerk_user_id and x.revoked_at is null and x.processing_enabled and x.report->'handlers' ? 'studio.youtube_search') then 'YS004'
   when mode='rank' then 'YS006'
   else 'YS003' end;
  raise exception 'No ready Mac' using errcode=why;
 end if;
 -- Ranking needs a signed-in Codex/Claude subscription with capacity; without it the search still runs and is reported as unchecked.
 rank_ok:=coalesce(d.report#>>'{youtubeSearch,rank}','')='true';
 if mode='plan_search_rank' and not rank_ok then mode:='search'; src:=null; ctx:=null; end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.youtube_search',jsonb_strip_nulls(jsonb_build_object('query',q,'limit',lim,'mode',case when mode='search' then null else mode end,'source',src,'context',ctx,'candidates',cands)),'ytsearch:'||k,p_clerk_user_id,1);
 if j.execution_target<>'device' then update studio.studio_jobs set execution_target='device',device_id=d.id where id=j.id returning * into j; end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'mode',mode);
end $$;

CREATE OR REPLACE FUNCTION studio.studio_youtube_search_device_command(p_token_hash text,p_app text,p_operation text,p_body jsonb,p_estio_authorized_by text DEFAULT NULL,p_observed jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare d studio.studio_devices%rowtype; j studio.studio_jobs%rowtype; r jsonb; v jsonb;
begin
 select * into d from studio.studio_devices where token_hash=p_token_hash and app=p_app and revoked_at is null;
 if not found or (d.app='estio' and p_estio_authorized_by is distinct from d.created_by) then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_operation not in ('claim','extend','complete','fail') then return studio.studio_video_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 perform studio.studio_lock_ai_manager(d.location_id,d.app,d.created_by);
 select * into d from studio.studio_devices where id=d.id and revoked_at is null for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768 or coalesce(p_body->>'workerId','') !~ '^[A-Za-z0-9:._-]{1,100}$' then raise exception 'Invalid command' using errcode='22023'; end if;

 if p_operation='claim' then
  if coalesce(p_body->>'leaseSeconds','') !~ '^[0-9]{2,4}$' or (p_body->>'leaseSeconds')::integer not between 10 and 3600 then raise exception 'Invalid lease' using errcode='22023'; end if;
  if exists(select 1 from studio.studio_jobs where device_id=d.id and status='running' and lease_expires_at>clock_timestamp()) then return '[]'::jsonb; end if;
  -- A search whose Mac stopped is not replayed automatically; the page offers Search again.
  update studio.studio_jobs set status='failed',lease_owner=null,lease_expires_at=null,last_error_code='worker_lease_expired',last_error_message='The Mac stopped before finishing this search.',finished_at=clock_timestamp(),updated_at=clock_timestamp()
   where device_id=d.id and kind='studio.youtube_search' and status='running' and lease_expires_at<=clock_timestamp();
  if not d.paused and d.processing_enabled and 'studio.youtube_search'=any(d.allowed_kinds) and p_body->>'youtubeReady'='true' then
   select * into j from studio.studio_jobs where location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and kind='studio.youtube_search' and execution_target='device' and status='queued' and run_after<=clock_timestamp() order by created_at limit 1 for update skip locked;
   if found then
    update studio.studio_jobs set status='running',attempts=attempts+1,lease_owner=p_body->>'workerId',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=clock_timestamp() where id=j.id returning * into j;
    insert into studio.studio_job_events(job_id,location_id,attempt,event,worker_id) values(j.id,j.location_id,j.attempts,'started',j.lease_owner);
    return jsonb_build_array(to_jsonb(j));
   end if;
  end if;
  return studio.studio_video_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed);
 end if;

 select * into j from studio.studio_jobs where id=(p_body->>'jobId')::uuid and location_id=d.location_id and device_id=d.id and created_by_clerk_user_id=d.created_by and execution_target='device' and kind='studio.youtube_search' for update;
 if not found then return studio.studio_video_device_command(p_token_hash,p_app,p_operation,p_body,p_estio_authorized_by,p_observed); end if;
 if j.status<>'running' or j.lease_owner is distinct from p_body->>'workerId' or j.lease_token is distinct from (p_body->>'leaseToken')::uuid or j.lease_expires_at<=clock_timestamp() then
  return case when p_operation='fail' then to_jsonb('lease_lost'::text) else 'false'::jsonb end;
 end if;
 if p_operation='extend' then return to_jsonb(studio.studio_extend_job_lease(j.id,j.lease_owner,j.lease_token,(p_body->>'leaseSeconds')::integer)); end if;
 if p_operation='fail' then
  return to_jsonb(studio.studio_fail_job(j.id,j.lease_owner,j.lease_token,coalesce(nullif(p_body#>>'{failure,code}',''),'youtube_search_failed'),left(coalesce(p_body#>>'{failure,message}','YouTube search failed on the Mac.'),300),false,null));
 end if;
 -- complete: a bounded list of public video facts, optional model scores and a bounded trace.
 r:=p_body->'result';
 if jsonb_typeof(r) is distinct from 'object' or octet_length(r::text)>30000 or exists(select 1 from jsonb_object_keys(r) k where k not in ('videos','signedIn','trace'))
  or jsonb_typeof(r->'videos') is distinct from 'array' or jsonb_array_length(r->'videos')>24
  or (r ? 'signedIn' and jsonb_typeof(r->'signedIn') is distinct from 'boolean')
  or (r ? 'trace' and (jsonb_typeof(r->'trace') is distinct from 'object' or exists(select 1 from jsonb_object_keys(r->'trace') k where k not in ('version','route','mode','focus','queries','planner','ranker','notes','candidates')))) then raise exception 'Invalid YouTube search result' using errcode='22023'; end if;
 for v in select value from jsonb_array_elements(r->'videos') loop
  if jsonb_typeof(v) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v) k where k not in ('id','title','channelId','channelTitle','publishedText','viewsText','description','score','reason','band'))
   or coalesce(v->>'id','') !~ '^[A-Za-z0-9_-]{11}$' or jsonb_typeof(v->'title') is distinct from 'string' or char_length(v->>'title') not between 1 and 300
   or (v ? 'channelId' and coalesce(v->>'channelId','') !~ '^UC[A-Za-z0-9_-]{22}$')
   or (v ? 'channelTitle' and (jsonb_typeof(v->'channelTitle') is distinct from 'string' or char_length(v->>'channelTitle')>200))
   or (v ? 'publishedText' and (jsonb_typeof(v->'publishedText') is distinct from 'string' or char_length(v->>'publishedText')>80))
   or (v ? 'viewsText' and (jsonb_typeof(v->'viewsText') is distinct from 'string' or char_length(v->>'viewsText')>80))
   or (v ? 'description' and (jsonb_typeof(v->'description') is distinct from 'string' or char_length(v->>'description')>400))
   or (v ? 'score' and jsonb_typeof(v->'score') not in ('number','null'))
   or (v ? 'score' and jsonb_typeof(v->'score')='number' and (v->>'score')::numeric not between 0 and 100)
   or (v ? 'reason' and (jsonb_typeof(v->'reason') is distinct from 'string' or char_length(v->>'reason')>240))
   or (v ? 'band' and coalesce(v->>'band','') not in ('relevant','maybe','off_topic','unranked')) then raise exception 'Invalid YouTube search video' using errcode='22023'; end if;
 end loop;
 return to_jsonb(studio.studio_complete_job(j.id,j.lease_owner,j.lease_token,r));
end $$;

-- Every Related-video run keeps its reasoning: route, queries, the exact prompts, model and per-video scores.
CREATE TABLE studio.studio_related_runs (
 location_id text NOT NULL REFERENCES public."Location"(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 anchor_id uuid NOT NULL,
 actor_app text NOT NULL CHECK (actor_app IN ('estio','substo')),
 actor_id text NOT NULL CHECK (btrim(actor_id)<>''),
 job_id uuid,
 route text NOT NULL CHECK (route IN ('mac_browser','device_network','api')),
 mode text NOT NULL CHECK (mode IN ('search','plan_search_rank','rank','heuristic')),
 trace jsonb NOT NULL CHECK (jsonb_typeof(trace)='object' AND octet_length(trace::text)<=60000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (location_id,id),
 FOREIGN KEY (location_id,anchor_id) REFERENCES studio.studio_records(location_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX studio_related_runs_job ON studio.studio_related_runs(location_id,job_id) WHERE job_id IS NOT NULL;
CREATE INDEX studio_related_runs_anchor ON studio.studio_related_runs(location_id,anchor_id,created_at DESC);
ALTER TABLE studio.studio_related_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON studio.studio_related_runs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON studio.studio_related_runs TO service_role;
CREATE FUNCTION studio.studio_record_related_run(p_location_id text,p_actor_app text,p_clerk_user_id text,p_anchor uuid,p_job uuid,p_route text,p_mode text,p_trace jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare rid uuid;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if jsonb_typeof(p_trace) is distinct from 'object' or octet_length(p_trace::text)>60000 then raise exception 'Invalid trace' using errcode='22023'; end if;
 if not exists(select 1 from studio.studio_records where location_id=p_location_id and id=p_anchor) then raise exception 'Source unavailable' using errcode='22023'; end if;
 insert into studio.studio_related_runs(location_id,anchor_id,actor_app,actor_id,job_id,route,mode,trace) values(p_location_id,p_anchor,p_actor_app,p_clerk_user_id,p_job,p_route,p_mode,p_trace)
  on conflict (location_id,job_id) where job_id is not null do nothing returning id into rid;
 return coalesce(rid,(select id from studio.studio_related_runs where location_id=p_location_id and job_id=p_job));
end $$;
REVOKE ALL ON FUNCTION studio.studio_record_related_run(text,text,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_record_related_run(text,text,text,uuid,uuid,text,text,jsonb) TO service_role;

COMMIT;
