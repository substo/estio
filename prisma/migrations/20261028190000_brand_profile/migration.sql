BEGIN;

ALTER TABLE studio.studio_idea_reviews DROP CONSTRAINT studio_idea_reviews_workflow_check;

ALTER TABLE studio.studio_idea_reviews ADD CONSTRAINT studio_idea_reviews_workflow_check CHECK(workflow in ('idea_review','script_brief','knowledge_extract','brand_profile'));

CREATE OR REPLACE FUNCTION studio.studio_lock_text_run_lease(p_location_id text, p_review_id uuid, p_job_id uuid, p_worker_id text, p_lease_token uuid) RETURNS studio.studio_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare j studio.studio_jobs%rowtype;
begin
  select * into j from studio.studio_jobs where id=p_job_id for update;
  if j.id is null or j.location_id<>p_location_id or j.kind not in ('studio.idea_review','studio.script_brief','studio.knowledge_extract','studio.brand_profile') or j.payload->>'reviewId' is distinct from p_review_id::text
    or j.status<>'running' or j.lease_owner is distinct from p_worker_id or j.lease_token is distinct from p_lease_token
    or j.lease_expires_at<=clock_timestamp() then raise exception 'Current idea-review lease required' using errcode='40001'; end if;
  if not exists(select 1 from studio.studio_idea_reviews where id=p_review_id and location_id=p_location_id and job_id=p_job_id and 'studio.'||workflow=j.kind) then
    raise exception 'Review job mismatch' using errcode='22023'; end if;
  return j;
end; $$;

CREATE OR REPLACE FUNCTION studio.studio_finish_text_run_attempt(p_location_id text, p_review_id uuid, p_job_id uuid, p_worker_id text, p_lease_token uuid, p_attempt_id uuid, p_result jsonb, p_input_tokens bigint, p_output_tokens bigint, p_response_id text, p_rate_version text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare a studio.studio_ai_attempts%rowtype; snapshot jsonb; v_workflow text; v_stale boolean;
begin
  perform studio.studio_lock_text_run_lease(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
  select * into a from studio.studio_ai_attempts where id=p_attempt_id and idea_review_id=p_review_id and location_id=p_location_id
    and job_id=p_job_id and lease_token=p_lease_token for update;
  if a.id is null or a.status not in ('started','succeeded') then raise exception 'Attempt cannot finish' using errcode='40001'; end if;
  if a.status='succeeded' then return true; end if;
  select r.snapshot,r.workflow into snapshot,v_workflow from studio.studio_idea_reviews r where id=p_review_id for update;
  if p_input_tokens is null or p_input_tokens not between 0 and 60000 or p_output_tokens is null
    or p_output_tokens not between 0 and (case when v_workflow in ('script_brief','knowledge_extract','brand_profile') then 6000 else 3000 end)
    or p_response_id is null or length(p_response_id) not between 1 and 200
    or p_rate_version is distinct from 'gpt-6-luna-standard-2026-10-23' then raise exception 'Invalid text usage' using errcode='22023'; end if;
  perform studio.studio_validate_text_run_result(v_workflow,p_result,snapshot);
  if v_workflow='brand_profile' then v_stale := false;
  elsif v_workflow='knowledge_extract' then
    v_stale := not studio.studio_knowledge_snapshot_current(p_location_id,snapshot);
  else
  -- Preserve paid results even when content changed; never write back into ideas.
  perform 1 from studio.studio_records r where r.location_id=p_location_id and r.id in
    (select (i->>'id')::uuid from jsonb_array_elements(snapshot->'ideas') i union
     select (s->>'id')::uuid from jsonb_array_elements(snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) order by r.id for share;
  select exists(select 1 from (select i from jsonb_array_elements(snapshot->'ideas') i union all
    select s from jsonb_array_elements(snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) x where not exists
    (select 1 from studio.studio_records r where r.location_id=p_location_id and r.id=(x.i->>'id')::uuid and r.version=(x.i->>'version')::bigint)) into v_stale;
  end if;
  perform studio.studio_settle_ai_spend(p_location_id,a.usage_id,ceil((p_input_tokens::numeric+5*p_output_tokens)/10)::bigint,
    a.model,p_input_tokens,p_output_tokens,null);
  update studio.studio_idea_reviews set result=p_result,stale_at_completion=v_stale,completed_at=clock_timestamp() where id=p_review_id;
  update studio.studio_ai_attempts set status='succeeded',provider_response_id=p_response_id,rate_version=p_rate_version,updated_at=clock_timestamp() where id=a.id;
  return true;
end; $$;

CREATE OR REPLACE FUNCTION studio.studio_validate_text_run_result(p_workflow text, p_result jsonb, snapshot jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare f jsonb; unit jsonb; key text;
begin
 if p_workflow='brand_profile' then
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>18000 then raise exception 'Invalid profile result' using errcode='22023'; end if;
  foreach key in array array['summary','audience','offer','tone'] loop
   if jsonb_typeof(p_result->key) is distinct from 'string' or length(p_result->>key)>4000 then raise exception 'Invalid profile field' using errcode='22023'; end if;
  end loop;
  foreach key in array array['useWords','avoidWords','pillars'] loop
   if jsonb_typeof(p_result->key) is distinct from 'array' or jsonb_array_length(p_result->key)>30 then raise exception 'Invalid profile list' using errcode='22023'; end if;
  end loop;
  return;
 end if;
 if p_workflow<>'knowledge_extract' then perform studio.studio_validate_text_run_result_v19(p_workflow,p_result,snapshot);return; end if;
 if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>24000 or jsonb_typeof(p_result->'findings') is distinct from 'array' then raise exception 'Invalid extraction result' using errcode='22023'; end if;
 if jsonb_array_length(p_result->'findings')>10 or (select count(distinct jsonb_build_array(x->>'kind',x->>'statement')) from jsonb_array_elements(p_result->'findings') x)<>jsonb_array_length(p_result->'findings') then raise exception 'Duplicate or excessive findings' using errcode='22023'; end if;
 for f in select * from jsonb_array_elements(p_result->'findings') loop
  if f->>'kind' is null or f->>'kind' not in ('claim','method','example','question','objection','content_pattern') then raise exception 'Invalid finding kind' using errcode='22023'; end if;
  foreach key in array array['unitId','statement','suggestedTopic','quote'] loop
   if jsonb_typeof(f->key) is distinct from 'string' or coalesce(char_length(btrim(f->>key)),0) not between 1 and
    (case key when 'statement' then 1000 when 'suggestedTopic' then 120 when 'quote' then 600 else 300 end) then raise exception 'Invalid finding text' using errcode='22023'; end if;
  end loop;
  select u into unit from jsonb_array_elements(snapshot->'units') u where u->>'id'=f->>'unitId';
  if not found or strpos(unit->>'text',f->>'quote')=0 then raise exception 'Quote must match its selected source unit exactly' using errcode='22023'; end if;
 end loop;
end; $$;

CREATE FUNCTION studio.studio_enqueue_brand_profile(p_location_id text,p_actor_app text,p_clerk_user_id text,p_request_id uuid,p_snapshot jsonb,p_confirm_paid boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
declare prior studio.studio_idea_reviews%rowtype; run_id uuid:=gen_random_uuid(); j studio.studio_jobs%rowtype;
begin
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if not exists(select 1 from studio.studio_location_members where location_id=p_location_id and location_app=p_actor_app and clerk_user_id=p_clerk_user_id and role='owner') then raise exception 'Admin required' using errcode='42501'; end if;
 if p_request_id is null or p_confirm_paid is distinct from true or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>24000 then raise exception 'Bounded profile and paid confirmation required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location_id,0));
 select * into prior from studio.studio_idea_reviews where location_id=p_location_id and request_id=p_request_id;
 if found then
  if prior.workflow<>'brand_profile' or prior.snapshot is distinct from p_snapshot or prior.created_by_clerk_user_id<>p_clerk_user_id then raise exception 'Request reused' using errcode='23505'; end if;
  return jsonb_build_object('reviewId',prior.id,'jobId',prior.job_id);
 end if;
 if (select count(*) from studio.studio_jobs where location_id=p_location_id and kind like 'studio.%' and status in ('queued','running'))>=5 then raise exception 'Too many active jobs' using errcode='40001'; end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.brand_profile',jsonb_build_object('reviewId',run_id),'text-run:'||p_request_id::text,p_clerk_user_id,5);
 insert into studio.studio_idea_reviews(id,location_id,request_id,created_by_clerk_user_id,actor_app,request,snapshot,job_id,workflow,prompt_version)
 values(run_id,p_location_id,p_request_id,p_clerk_user_id,p_actor_app,p_snapshot,p_snapshot,j.id,'brand_profile','studio.brand-profile.v1');
 return jsonb_build_object('reviewId',run_id,'jobId',j.id);
end; $$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_brand_profile(text,text,text,uuid,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_brand_profile(text,text,text,uuid,jsonb,boolean) TO service_role;
CREATE OR REPLACE FUNCTION studio.studio_build_selected_text_snapshot(p_location_id text, p_selection jsonb, p_focus text, p_workflow text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare ids uuid[]; v_ideas jsonb; v_snapshot jsonb;
begin
  if p_workflow is null or p_workflow not in ('idea_review','script_brief') or p_focus is null or char_length(p_focus)>300
    or p_selection is null or jsonb_typeof(p_selection)<>'array' or jsonb_array_length(p_selection) not between 1 and 5
    or (p_workflow='script_brief' and jsonb_array_length(p_selection)<>1) then raise exception 'Invalid recurring inputs' using errcode='22023'; end if;
  select array_agg((x->>'id')::uuid order by x->>'id') into ids from jsonb_array_elements(p_selection) x;
  if (select count(distinct id) from unnest(ids) id) <> jsonb_array_length(p_selection)
    or exists(select 1 from jsonb_array_elements(p_selection) x where x->>'version' is null or (x->>'version') !~ '^[1-9][0-9]{0,14}$') then
    raise exception 'Invalid idea selection' using errcode='22023'; end if;
  -- All selected records + their linked sources are locked in UUID order.
  -- Link edits increment/lock their source record version, so stale selection
  -- versions fail below rather than mixing snapshots across an edit.
  perform 1 from studio.studio_records r where r.location_id=p_location_id and (r.id=any(ids) or r.id in
    (select target_id from studio.studio_record_links where location_id=p_location_id and source_id=any(ids))) order by r.id for share;
  if exists(select 1 from jsonb_array_elements(p_selection) x where not exists(select 1 from studio.studio_records r
    where r.location_id=p_location_id and r.id=(x->>'id')::uuid and r.version=(x->>'version')::bigint
      and r.kind='content' and not r.archived and r.payload->>'stage'='idea')) then
    raise exception 'An idea changed or is unavailable; reload' using errcode='40001'; end if;
  if exists(select 1 from studio.studio_record_links where location_id=p_location_id and source_id=any(ids) group by source_id having count(*)>3) then
    raise exception 'Select ideas with at most three linked records for this bounded review' using errcode='22023'; end if;
  if exists(select 1 from studio.studio_record_links l join studio.studio_records s on s.location_id=l.location_id and s.id=l.target_id
    where l.location_id=p_location_id and l.source_id=any(ids) and char_length(s.source_url)>2000) then
    raise exception 'A linked source URL exceeds the review bound' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'title',left(r.title,180),
    'summary',left(coalesce(r.summary,''),700),'notes',left(coalesce(r.payload->>'notes',''),1000),
    'excerpted',char_length(r.title)>180 or char_length(coalesce(r.summary,''))>700 or char_length(coalesce(r.payload->>'notes',''))>1000,
    'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'title',left(s.title,180),
      'url',s.source_url,'excerpt',left(coalesce(nullif(s.payload->>'transcript',''),nullif(s.payload->>'notes',''),s.summary,''),600),
      'excerpted',char_length(s.title)>180 or char_length(coalesce(nullif(s.payload->>'transcript',''),nullif(s.payload->>'notes',''),s.summary,''))>600) order by s.id)
      from studio.studio_record_links l join studio.studio_records s on s.location_id=l.location_id and s.id=l.target_id
      where l.location_id=p_location_id and l.source_id=r.id),'[]'::jsonb)) order by r.id) into v_ideas
    from studio.studio_records r where r.location_id=p_location_id and r.id=any(ids);
  v_snapshot := jsonb_build_object('focus',p_focus,'ideas',v_ideas);
  -- One bounded profile from the same canonical Location settings as CRM drafts.
  v_snapshot := v_snapshot || jsonb_build_object('brandProfile',coalesce((select left(payload->>'brandVoice',4000) from public.settings_documents where scope_type='LOCATION' and scope_id=p_location_id and domain='location.ai'),''));

  if octet_length(v_snapshot::text)>24000 then raise exception 'Selected research excerpts exceed review size; select fewer ideas' using errcode='22023'; end if;
  if p_workflow='script_brief' and not exists(select 1 from jsonb_array_elements(v_snapshot->'ideas'->0->'sources') s where btrim(s->>'excerpt')<>'') then
    raise exception 'Save supporting research text and link it to this idea before drafting' using errcode='22023'; end if;
  return v_snapshot;
end; $_$;

CREATE OR REPLACE FUNCTION studio.studio_enqueue_text_run(p_location_id text, p_actor_app text, p_clerk_user_id text, p_request_id uuid, p_selection jsonb, p_focus text, p_confirm_paid boolean, p_workflow text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare prior studio.studio_idea_reviews%rowtype; v_request jsonb; v_snapshot jsonb; v_ideas jsonb;
  v_review uuid := gen_random_uuid(); j studio.studio_jobs%rowtype; ids uuid[];
begin
  perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  if p_workflow is null or p_workflow not in ('idea_review','script_brief') then raise exception 'Invalid text workflow' using errcode='22023'; end if;
  if p_workflow='script_brief' and jsonb_array_length(p_selection)<>1 then raise exception 'Select exactly one idea' using errcode='22023'; end if;
  if p_request_id is null or p_confirm_paid is distinct from true or p_focus is null or char_length(p_focus)>300
    or p_selection is null or jsonb_typeof(p_selection)<>'array' or jsonb_array_length(p_selection) not between 1 and 5 then
    raise exception 'Select one to five ideas and authorize the review' using errcode='22023'; end if;
  -- Serialize per-location enqueue requests without conflicting with FK locks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idea-review:'||p_location_id::text,0));
  select array_agg((x->>'id')::uuid order by x->>'id') into ids from jsonb_array_elements(p_selection) x;
  if (select count(distinct id) from unnest(ids) id) <> jsonb_array_length(p_selection)
    or exists(select 1 from jsonb_array_elements(p_selection) x where x->>'version' is null or (x->>'version') !~ '^[1-9][0-9]{0,14}$') then
    raise exception 'Invalid idea selection' using errcode='22023'; end if;
  v_request := jsonb_build_object('selection',p_selection,'focus',p_focus,'actor',p_clerk_user_id,'app',p_actor_app);
  select * into prior from studio.studio_idea_reviews where location_id=p_location_id and request_id=p_request_id;
  if found then
    if prior.workflow is distinct from p_workflow or prior.request is distinct from v_request then raise exception 'Review request reused' using errcode='23505'; end if;
    return jsonb_build_object('reviewId',prior.id,'jobId',prior.job_id);
  end if;
  if (select count(*) from studio.studio_jobs where location_id=p_location_id and kind in ('studio.idea_review','studio.script_brief','studio.knowledge_extract') and status in ('queued','running'))>=5 then
    raise exception 'Too many active idea reviews' using errcode='40001'; end if;
  v_snapshot := studio.studio_build_selected_text_snapshot(p_location_id,p_selection,p_focus,p_workflow);
  j := studio.studio_enqueue_job(p_location_id,'studio.'||p_workflow,jsonb_build_object('reviewId',v_review),'text-run:'||p_request_id::text,p_clerk_user_id,5);
  insert into studio.studio_idea_reviews(id,location_id,request_id,created_by_clerk_user_id,actor_app,request,snapshot,job_id,workflow,prompt_version)
    values(v_review,p_location_id,p_request_id,p_clerk_user_id,p_actor_app,v_request,v_snapshot,j.id,p_workflow,case when p_workflow='script_brief' then 'studio.script-brief.v2' else 'studio.idea-review.v2' end);
  return jsonb_build_object('reviewId',v_review,'jobId',j.id);
end; $_$;

CREATE OR REPLACE FUNCTION studio.studio_apply_script_brief(p_location_id text, p_actor_app text, p_clerk_user_id text, p_review_id uuid, p_request_id uuid, p_expected_version bigint, p_confirm_replace boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare run studio.studio_idea_reviews%rowtype; application studio.studio_script_brief_applications%rowtype;
  r studio.studio_records%rowtype; v_request jsonb; v_result jsonb; item jsonb;
begin
  perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
  if p_review_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1 or p_confirm_replace is distinct from true then
    raise exception 'Explicit script replacement confirmation required' using errcode='22023'; end if;
  v_request := jsonb_build_object('reviewId',p_review_id,'version',p_expected_version,'confirm',p_confirm_replace,'app',p_actor_app,'actor',p_clerk_user_id);
  select * into run from studio.studio_idea_reviews where id=p_review_id and location_id=p_location_id and workflow='script_brief' for update;
  if not found then raise exception 'Script brief not found' using errcode='22023'; end if;
  select * into application from studio.studio_script_brief_applications where location_id=p_location_id and request_id=p_request_id;
  if found then
    if application.request is distinct from v_request then raise exception 'Application request already used' using errcode='23505'; end if;
    return application.result;
  end if;
  if exists(select 1 from studio.studio_script_brief_applications where review_id=run.id) then
    raise exception 'This brief was already applied' using errcode='40001'; end if;
  if run.result is null or run.stale_at_completion is distinct from false or run.prompt_version not in ('studio.script-brief.v1','studio.script-brief.v2')
    or jsonb_array_length(run.snapshot->'ideas')<>1 then raise exception 'A current completed brief is required' using errcode='40001'; end if;
  perform studio.studio_validate_text_run_result('script_brief',run.result,run.snapshot);
  -- Lock every input in UUID order; any changed/deleted source blocks application.
  perform 1 from studio.studio_records rec where rec.location_id=p_location_id and rec.id in
    (select (i->>'id')::uuid from jsonb_array_elements(run.snapshot->'ideas') i union
     select (s->>'id')::uuid from jsonb_array_elements(run.snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) order by rec.id for update;
  for item in select i from jsonb_array_elements(run.snapshot->'ideas') i union all
    select s from jsonb_array_elements(run.snapshot->'ideas') i,jsonb_array_elements(i->'sources') s loop
    if not exists(select 1 from studio.studio_records rec where rec.location_id=p_location_id and rec.id=(item->>'id')::uuid
      and rec.version=(item->>'version')::bigint) then raise exception 'An input changed; keep this historical draft and generate a fresh brief before applying' using errcode='40001'; end if;
  end loop;
  select * into r from studio.studio_records where location_id=p_location_id and id=(run.snapshot->'ideas'->0->>'id')::uuid;
  if r.kind<>'content' or r.archived or r.version<>p_expected_version or r.version<>(run.snapshot->'ideas'->0->>'version')::bigint
    or r.payload->>'stage' is distinct from 'idea' then raise exception 'Content changed; reload before applying' using errcode='40001'; end if;
  update studio.studio_records set payload=payload||jsonb_build_object('script',run.result->>'script','stage','script','approved',false),
    version=version+1,updated_at=clock_timestamp() where location_id=p_location_id and id=r.id;
  v_result := jsonb_build_object('reviewId',run.id,'recordId',r.id,'recordVersion',r.version+1);
  insert into studio.studio_script_brief_applications(location_id,review_id,record_id,request_id,actor_app,actor_clerk_user_id,
    previous_version,record_version,previous_script,previous_stage,previous_approved,request,result)
    values(p_location_id,run.id,r.id,p_request_id,p_actor_app,p_clerk_user_id,r.version,r.version+1,r.payload->'script',r.payload->'stage',r.payload->'approved',v_request,v_result);
  return v_result;
end; $$;

COMMIT;
