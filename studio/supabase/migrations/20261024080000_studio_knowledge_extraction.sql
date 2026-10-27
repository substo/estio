-- Hosted, bounded source-text extraction. All target data is in Studio only.
begin;
alter table public.studio_idea_reviews drop constraint studio_idea_reviews_workflow_check;
alter table public.studio_idea_reviews add constraint studio_idea_reviews_workflow_check check(workflow in ('idea_review','script_brief','knowledge_extract'));
alter table public.studio_ai_attempts drop constraint studio_ai_attempt_subject;
alter table public.studio_ai_attempts add constraint studio_ai_attempt_subject check (
 (operation='transcribe_upload' and upload_id is not null and chunk_index is not null and duration_seconds is not null and idea_review_id is null and model='whisper-1') or
 (operation in ('idea_review','script_brief','knowledge_extract') and upload_id is null and chunk_index is null and duration_seconds is null and idea_review_id is not null and model='gpt-6-luna'));
drop index public.studio_ai_attempt_text_active_idx;
create unique index studio_ai_attempt_text_active_idx on public.studio_ai_attempts(idea_review_id)
 where operation in ('idea_review','script_brief','knowledge_extract') and status<>'rejected' and not replacement_authorized;
-- Citation/source writes go through reviewed security-definer RPCs, including
-- the existing importer/media RPCs; service reads remain unchanged.
revoke insert,update,delete,truncate,references,trigger on public.studio_knowledge_sources,public.studio_knowledge_evidence,
 public.studio_knowledge_source_units,public.studio_knowledge_source_unit_sidecars from service_role;

create function public.studio_build_knowledge_snapshot(p_location_id text,p_source_id uuid,p_expected_version bigint,p_mode text,p_input_id text,
 p_start_unit integer,p_unit_count integer,p_focus text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.studio_records%rowtype; full_text text; total integer; text_length integer; units jsonb; fingerprint text; selected integer;
begin
 if p_mode is null or p_mode not in ('record_text','source_units','upload_transcript') or p_input_id is null or length(p_input_id) not between 1 and 200
  or p_start_unit is null or p_start_unit not between 0 and 1000000 or p_unit_count is null or p_unit_count not between 1 and 8
  or p_focus is null or length(p_focus)>300 or p_expected_version is null or p_expected_version<1 then raise exception 'Invalid extraction range' using errcode='22023'; end if;
 select * into r from public.studio_records where location_id=p_location_id and id=p_source_id for share;
 if not found or r.version<>p_expected_version or r.archived or r.kind not in ('reference','content') then raise exception 'Source changed or unavailable' using errcode='40001'; end if;
 if char_length(r.source_url)>2000 then raise exception 'Source URL exceeds bounds' using errcode='22023'; end if;
 if p_mode='source_units' then
  perform 1 from public.studio_knowledge_source_units where location_id=p_location_id and source_id=p_source_id and transcription_id=p_input_id
    and unit_index>=p_start_unit and unit_index<p_start_unit+p_unit_count order by unit_index,id for share;
  select coalesce(max(unit_index)+1,0) into total from public.studio_knowledge_source_units where location_id=p_location_id and source_id=p_source_id and transcription_id=p_input_id;
  if exists(select 1 from public.studio_knowledge_source_units where location_id=p_location_id and source_id=p_source_id and transcription_id=p_input_id
    and unit_index>=p_start_unit and unit_index<p_start_unit+p_unit_count and (jsonb_typeof(payload#>'{unit,text}') is distinct from 'string' or length(payload#>>'{unit,text}')>16000)) then
    raise exception 'Selected source units require shorter saved text inputs' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',id::text,'unitIndex',unit_index,'text',payload#>>'{unit,text}','startChar',null,'endChar',null,
    'startSeconds',case when jsonb_typeof(payload#>'{unit,start}')='number' then payload#>'{unit,start}' else null end,
    'endSeconds',case when jsonb_typeof(payload#>'{unit,end}')='number' then payload#>'{unit,end}' else null end) order by unit_index,id),
    encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',id,'sidecar',sidecar_id,'index',unit_index,'payload',payload) order by unit_index,id)::text,''),'UTF8')),'hex'),count(*)
    into units,fingerprint,selected from public.studio_knowledge_source_units where location_id=p_location_id and source_id=p_source_id and transcription_id=p_input_id
      and unit_index>=p_start_unit and unit_index<p_start_unit+p_unit_count;
 else
  if p_mode='record_text' then
    if p_input_id not in ('transcript','notes','script') or jsonb_typeof(r.payload->p_input_id) is distinct from 'string' then raise exception 'Choose saved text' using errcode='22023'; end if;
    full_text := r.payload->>p_input_id;
  else
    select t.text into full_text from public.studio_transcripts t join public.studio_uploads u on u.id=t.upload_id and u.location_id=t.location_id
      where t.location_id=p_location_id and t.upload_id=p_input_id::uuid and u.record_id=p_source_id and u.status='uploaded' for share of t,u;
    if not found then raise exception 'Completed upload transcript not found for source' using errcode='22023'; end if;
  end if;
  text_length := char_length(full_text); total := ceil(text_length::numeric/2000)::integer;
  select jsonb_agg(jsonb_build_object('id',p_mode||':'||p_input_id||':'||i::text,'unitIndex',i,'text',substring(full_text from i*2000+1 for 2000),
    'startChar',i*2000,'endChar',least(text_length,(i+1)*2000),'startSeconds',null,'endSeconds',null) order by i),count(*) into units,selected
    from generate_series(p_start_unit,least(total-1,p_start_unit+p_unit_count-1)) i;
  fingerprint := encode(sha256(convert_to(full_text,'UTF8')),'hex');
 end if;
 if total<=p_start_unit or selected<>least(p_unit_count,total-p_start_unit) or units is null or not exists
  (select 1 from jsonb_array_elements(units) u where u->>'text' !~ '^[[:space:]]*$') then raise exception 'Select a range containing saved text' using errcode='22023'; end if;
 return jsonb_build_object('source',jsonb_build_object('id',r.id,'version',r.version,'title',left(r.title,180),'url',r.source_url),
  'mode',p_mode,'inputId',p_input_id,'startUnit',p_start_unit,'unitCount',p_unit_count,'focus',p_focus,'fingerprint',fingerprint,
  'coverage',jsonb_build_object('totalUnits',total,'selectedUnits',selected,'totalCharacters',text_length),'units',units);
end; $$;

create function public.studio_knowledge_snapshot_current(p_location_id text,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 return public.studio_build_knowledge_snapshot(p_location_id,(p_snapshot#>>'{source,id}')::uuid,(p_snapshot#>>'{source,version}')::bigint,
  p_snapshot->>'mode',p_snapshot->>'inputId',(p_snapshot->>'startUnit')::integer,(p_snapshot->>'unitCount')::integer,p_snapshot->>'focus')=p_snapshot;
exception when sqlstate '40001' or sqlstate '22023' or sqlstate '22P02' then return false;
end; $$;

create function public.studio_enqueue_knowledge_extraction(p_location_id text,p_actor_app text,p_clerk_user_id text,p_request_id uuid,
 p_source_id uuid,p_expected_version bigint,p_mode text,p_input_id text,p_start_unit integer,p_unit_count integer,p_focus text,p_confirm_paid boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.studio_idea_reviews%rowtype; v_request jsonb; snapshot jsonb; run_id uuid:=gen_random_uuid(); j public.studio_jobs%rowtype;
begin
 perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_request_id is null or p_confirm_paid is distinct from true then raise exception 'Explicit paid extraction authorization required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('idea-review:'||p_location_id::text,0));
 v_request := jsonb_build_object('sourceId',p_source_id,'version',p_expected_version,'mode',p_mode,'inputId',p_input_id,'startUnit',p_start_unit,'unitCount',p_unit_count,'focus',p_focus,'actor',p_clerk_user_id,'app',p_actor_app);
 select * into prior from public.studio_idea_reviews where location_id=p_location_id and request_id=p_request_id;
 if found then
  if prior.workflow<>'knowledge_extract' or prior.request is distinct from v_request then raise exception 'Extraction request reused' using errcode='23505'; end if;
  return jsonb_build_object('reviewId',prior.id,'jobId',prior.job_id);
 end if;
 if (select count(*) from public.studio_jobs where location_id=p_location_id and kind in ('studio.idea_review','studio.script_brief','studio.knowledge_extract') and status in ('queued','running'))>=5 then raise exception 'Too many active text runs' using errcode='40001'; end if;
 snapshot := public.studio_build_knowledge_snapshot(p_location_id,p_source_id,p_expected_version,p_mode,p_input_id,p_start_unit,p_unit_count,p_focus);
 if octet_length(snapshot::text)>24000 then raise exception 'Select fewer source units for this bounded extraction' using errcode='22023'; end if;
 j := public.studio_enqueue_job(p_location_id,'studio.knowledge_extract',jsonb_build_object('reviewId',run_id),'text-run:'||p_request_id::text,p_clerk_user_id,5);
 insert into public.studio_idea_reviews(id,location_id,request_id,created_by_clerk_user_id,actor_app,request,snapshot,job_id,workflow,prompt_version)
  values(run_id,p_location_id,p_request_id,p_clerk_user_id,p_actor_app,v_request,snapshot,j.id,'knowledge_extract','studio.knowledge-extract.v1');
 return jsonb_build_object('reviewId',run_id,'jobId',j.id);
end; $$;
create table public.studio_knowledge_extraction_applications (
 id uuid primary key default gen_random_uuid(),location_id text not null references public.studio_locations(location_id) on delete cascade,
 review_id uuid not null references public.studio_idea_reviews(id) on delete cascade,request_id uuid not null,
 actor_app text not null check(actor_app in ('estio','substo')),actor_clerk_user_id text not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(location_id,request_id)
);
create table public.studio_knowledge_extraction_findings (
 location_id text not null references public.studio_locations(location_id) on delete cascade,
 review_id uuid not null references public.studio_idea_reviews(id) on delete cascade,finding_index integer not null check(finding_index between 0 and 9),
 insight_id uuid not null,reused boolean not null,primary key(location_id,review_id,finding_index),
 foreign key(location_id,insight_id) references public.studio_knowledge_insights(location_id,id) on delete restrict
);
alter table public.studio_knowledge_extraction_applications enable row level security;
alter table public.studio_knowledge_extraction_findings enable row level security;
revoke all on public.studio_knowledge_extraction_applications,public.studio_knowledge_extraction_findings from public,anon,authenticated,service_role;
grant select on public.studio_knowledge_extraction_applications,public.studio_knowledge_extraction_findings to service_role;

create function public.studio_apply_knowledge_extraction(p_location_id text,p_actor_app text,p_clerk_user_id text,p_review_id uuid,
 p_request_id uuid,p_expected_version bigint,p_finding_indexes jsonb,p_confirm_pending boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.studio_idea_reviews%rowtype; prior public.studio_knowledge_extraction_applications%rowtype;
 mapping public.studio_knowledge_extraction_findings%rowtype; v_source_id uuid; finding jsonb; unit jsonb; idx integer; insight uuid; evidence_id uuid;
 is_reused boolean; request jsonb; result jsonb:='[]'; at_iso text; quote_offset integer; citation jsonb;
begin
 perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 if p_request_id is null or p_expected_version is null or p_expected_version<1 or p_confirm_pending is distinct from true
  or p_finding_indexes is null or jsonb_typeof(p_finding_indexes)<>'array' then raise exception 'Confirm selected pending findings' using errcode='22023'; end if;
 if jsonb_array_length(p_finding_indexes) not between 1 and 10 or exists(select 1 from jsonb_array_elements(p_finding_indexes) x where jsonb_typeof(x)<>'number' or x::text !~ '^[0-9]$')
  or (select count(distinct x) from jsonb_array_elements(p_finding_indexes) x)<>jsonb_array_length(p_finding_indexes) then raise exception 'Invalid finding selection' using errcode='22023'; end if;
 request:=jsonb_build_object('reviewId',p_review_id,'version',p_expected_version,'indexes',p_finding_indexes,'actor',p_clerk_user_id,'app',p_actor_app,'confirm',p_confirm_pending);
 select * into run from public.studio_idea_reviews where location_id=p_location_id and id=p_review_id and workflow='knowledge_extract' for update;
 if not found then raise exception 'Extraction not found' using errcode='22023'; end if;
 select * into prior from public.studio_knowledge_extraction_applications where location_id=p_location_id and request_id=p_request_id;
 if found then
  if prior.request is distinct from request then raise exception 'Finding application request reused' using errcode='23505'; end if;
  return prior.result;
 end if;
 v_source_id:=(run.snapshot#>>'{source,id}')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('knowledge-apply:'||p_location_id::text||':'||v_source_id::text,0));
 if run.result is null or run.stale_at_completion is distinct from false or p_expected_version<>(run.snapshot#>>'{source,version}')::bigint
  or not public.studio_knowledge_snapshot_current(p_location_id,run.snapshot) then raise exception 'Source changed; keep historical proposals and extract current text' using errcode='40001'; end if;
 perform public.studio_validate_text_run_result('knowledge_extract',run.result,run.snapshot);
 if exists(select 1 from jsonb_array_elements_text(p_finding_indexes) x where x::integer>=jsonb_array_length(run.result->'findings')) then raise exception 'Unknown proposed finding' using errcode='22023'; end if;
 at_iso:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 insert into public.studio_knowledge_sources(location_id,id,payload,total_units,covered_units)
  values(p_location_id,v_source_id,jsonb_build_object('id',v_source_id,'title',run.snapshot#>>'{source,title}','url',run.snapshot#>'{source,url}',
   'origin','hosted_extraction','coverage_origin','extraction_ranges','created_at',at_iso),(run.snapshot#>>'{coverage,totalUnits}')::integer,0) on conflict(location_id,id) do nothing;
 for idx in select x::integer from jsonb_array_elements_text(p_finding_indexes) x order by x::integer loop
  select * into mapping from public.studio_knowledge_extraction_findings where location_id=p_location_id and review_id=run.id and finding_index=idx;
  if found then
   result:=result||jsonb_build_array(jsonb_build_object('findingIndex',idx,'insightId',mapping.insight_id,'reused',mapping.reused));continue;
  end if;
  finding:=run.result->'findings'->idx;
  select u into unit from jsonb_array_elements(run.snapshot->'units') u where u->>'id'=finding->>'unitId';
  select i.id into insight from public.studio_knowledge_insights i where i.location_id=p_location_id and i.source_id=v_source_id
   and i.statement=finding->>'statement' and i.payload->>'kind'=finding->>'kind' order by i.id limit 1;
  is_reused:=found;
  if not is_reused then
   insight:=gen_random_uuid();evidence_id:=gen_random_uuid();
   insert into public.studio_knowledge_insights(location_id,id,source_id,topic_id,status,statement,payload)
    values(p_location_id,insight,v_source_id,null,'pending',finding->>'statement',jsonb_build_object('id',insight,'kind',finding->>'kind',
     'suggested_topic',finding->>'suggestedTopic','origin','hosted_extraction','extraction_id',run.id,'finding_index',idx,'created_at',at_iso));
   quote_offset:=strpos(unit->>'text',finding->>'quote')-1;
   citation:=jsonb_build_object('quote',finding->>'quote','source_url',run.snapshot#>'{source,url}','origin','hosted_extraction','extraction_id',run.id,
    'source_version',p_expected_version,'input_mode',run.snapshot->>'mode','input_id',run.snapshot->>'inputId','unit_id',unit->>'id','unit_index',unit->'unitIndex',
    'unit_char_start',quote_offset,'unit_char_end',quote_offset+char_length(finding->>'quote'),
    'char_start',case when unit->'startChar'<>'null'::jsonb then (unit->>'startChar')::integer+quote_offset else null end,
    'char_end',case when unit->'startChar'<>'null'::jsonb then (unit->>'startChar')::integer+quote_offset+char_length(finding->>'quote') else null end,
    'start_sec',unit->'startSeconds','end_sec',unit->'endSeconds','timing_precision','unit');
   insert into public.studio_knowledge_evidence(location_id,id,insight_id,source_id,payload) values(p_location_id,evidence_id,insight,v_source_id,citation);
   insert into public.studio_knowledge_reviews(location_id,id,insight_id,payload) values(p_location_id,gen_random_uuid(),insight,jsonb_build_object(
    'action','extracted','previous_status',null,'new_status','pending','at',at_iso,'actor_app',p_actor_app,'actor_clerk_user_id',p_clerk_user_id,
    'version',1,'origin','hosted_extraction','extraction_id',run.id));
  end if;
  insert into public.studio_knowledge_extraction_findings(location_id,review_id,finding_index,insight_id,reused) values(p_location_id,run.id,idx,insight,is_reused);
  result:=result||jsonb_build_array(jsonb_build_object('findingIndex',idx,'insightId',insight,'reused',is_reused));
 end loop;
 result:=jsonb_build_object('reviewId',run.id,'findings',result);
 insert into public.studio_knowledge_extraction_applications(location_id,review_id,request_id,actor_app,actor_clerk_user_id,request,result)
  values(p_location_id,run.id,p_request_id,p_actor_app,p_clerk_user_id,request,result);
 return result;
end; $$;

create function public.studio_knowledge_extraction_state(p_location_id text,p_actor_app text,p_clerk_user_id text,p_review_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; stale boolean;
begin
 perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 select r.snapshot,r.stale_at_completion into snapshot,stale from public.studio_idea_reviews r where r.id=p_review_id and r.location_id=p_location_id and r.workflow='knowledge_extract';
 if not found then raise exception 'Extraction not found' using errcode='22023'; end if;
 return jsonb_build_object('stale',coalesce(stale,false) or not public.studio_knowledge_snapshot_current(p_location_id,snapshot),
  'findings',coalesce((select jsonb_agg(jsonb_build_object('findingIndex',f.finding_index,'insightId',f.insight_id,'reused',f.reused,'status',i.status) order by f.finding_index)
   from public.studio_knowledge_extraction_findings f join public.studio_knowledge_insights i on i.location_id=f.location_id and i.id=f.insight_id
   where f.location_id=p_location_id and f.review_id=p_review_id),'[]'::jsonb));
end; $$;

create function public.studio_knowledge_extraction_inputs(p_location_id text,p_actor_app text,p_clerk_user_id text,p_source_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.studio_records%rowtype; inputs jsonb:='[]'; field text; item record;
begin
 perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 select * into r from public.studio_records where location_id=p_location_id and id=p_source_id;
 if not found or r.archived or r.kind not in ('reference','content') then raise exception 'Source unavailable' using errcode='22023'; end if;
 foreach field in array array['transcript','notes','script'] loop
  if jsonb_typeof(r.payload->field)='string' and r.payload->>field !~ '^[[:space:]]*$' then
   inputs:=inputs||jsonb_build_array(jsonb_build_object('mode','record_text','inputId',field,'label','Saved '||field,'totalUnits',ceil(char_length(r.payload->>field)::numeric/2000)::integer));
  end if;
 end loop;
 for item in select transcription_id,max(unit_index)+1 as n from public.studio_knowledge_source_units where location_id=p_location_id and source_id=p_source_id group by transcription_id order by transcription_id limit 20 loop
  inputs:=inputs||jsonb_build_array(jsonb_build_object('mode','source_units','inputId',item.transcription_id,'label','Imported units: '||item.transcription_id,'totalUnits',item.n));
 end loop;
 for item in select t.upload_id,ceil(char_length(t.text)::numeric/2000)::integer as n,u.original_filename from public.studio_transcripts t join public.studio_uploads u on u.id=t.upload_id and u.location_id=t.location_id
  where t.location_id=p_location_id and u.record_id=p_source_id and u.status='uploaded' and char_length(t.text)>0 order by t.created_at desc limit 20 loop
  inputs:=inputs||jsonb_build_array(jsonb_build_object('mode','upload_transcript','inputId',item.upload_id,'label','Upload transcript: '||item.original_filename,'totalUnits',item.n));
 end loop;
 return jsonb_build_object('source',jsonb_build_object('id',r.id,'version',r.version,'title',r.title),'inputs',inputs);
end; $$;
alter function public.studio_validate_text_run_result(text,jsonb,jsonb) rename to studio_validate_text_run_result_v19;
create function public.studio_validate_text_run_result(p_workflow text,p_result jsonb,snapshot jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare f jsonb; unit jsonb; key text;
begin
 if p_workflow<>'knowledge_extract' then perform public.studio_validate_text_run_result_v19(p_workflow,p_result,snapshot);return; end if;
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

create or replace function public.studio_lock_text_run_lease(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid)
returns public.studio_jobs language plpgsql security definer set search_path='' as $$
declare j public.studio_jobs%rowtype;
begin
  select * into j from public.studio_jobs where id=p_job_id for update;
  if j.id is null or j.location_id<>p_location_id or j.kind not in ('studio.idea_review','studio.script_brief','studio.knowledge_extract') or j.payload->>'reviewId' is distinct from p_review_id::text
    or j.status<>'running' or j.lease_owner is distinct from p_worker_id or j.lease_token is distinct from p_lease_token
    or j.lease_expires_at<=clock_timestamp() then raise exception 'Current idea-review lease required' using errcode='40001'; end if;
  if not exists(select 1 from public.studio_idea_reviews where id=p_review_id and location_id=p_location_id and job_id=p_job_id and 'studio.'||workflow=j.kind) then
    raise exception 'Review job mismatch' using errcode='22023'; end if;
  return j;
end; $$;

create or replace function public.studio_enqueue_text_run(p_location_id text, p_actor_app text, p_clerk_user_id text,
  p_request_id uuid, p_selection jsonb, p_focus text, p_confirm_paid boolean, p_workflow text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.studio_idea_reviews%rowtype; v_request jsonb; v_snapshot jsonb; v_ideas jsonb;
  v_review uuid := gen_random_uuid(); j public.studio_jobs%rowtype; ids uuid[];
begin
  perform public.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
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
  select * into prior from public.studio_idea_reviews where location_id=p_location_id and request_id=p_request_id;
  if found then
    if prior.workflow is distinct from p_workflow or prior.request is distinct from v_request then raise exception 'Review request reused' using errcode='23505'; end if;
    return jsonb_build_object('reviewId',prior.id,'jobId',prior.job_id);
  end if;
  if (select count(*) from public.studio_jobs where location_id=p_location_id and kind in ('studio.idea_review','studio.script_brief','studio.knowledge_extract') and status in ('queued','running'))>=5 then
    raise exception 'Too many active idea reviews' using errcode='40001'; end if;
  -- All selected records + their linked sources are locked in UUID order.
  -- Link edits increment/lock their source record version, so stale selection
  -- versions fail below rather than mixing snapshots across an edit.
  perform 1 from public.studio_records r where r.location_id=p_location_id and (r.id=any(ids) or r.id in
    (select target_id from public.studio_record_links where location_id=p_location_id and source_id=any(ids))) order by r.id for share;
  if exists(select 1 from jsonb_array_elements(p_selection) x where not exists(select 1 from public.studio_records r
    where r.location_id=p_location_id and r.id=(x->>'id')::uuid and r.version=(x->>'version')::bigint
      and r.kind='content' and not r.archived and r.payload->>'stage'='idea')) then
    raise exception 'An idea changed or is unavailable; reload' using errcode='40001'; end if;
  if exists(select 1 from public.studio_record_links where location_id=p_location_id and source_id=any(ids) group by source_id having count(*)>3) then
    raise exception 'Select ideas with at most three linked records for this bounded review' using errcode='22023'; end if;
  if exists(select 1 from public.studio_record_links l join public.studio_records s on s.location_id=l.location_id and s.id=l.target_id
    where l.location_id=p_location_id and l.source_id=any(ids) and char_length(s.source_url)>2000) then
    raise exception 'A linked source URL exceeds the review bound' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'title',left(r.title,180),
    'summary',left(coalesce(r.summary,''),700),'notes',left(coalesce(r.payload->>'notes',''),1000),
    'excerpted',char_length(r.title)>180 or char_length(coalesce(r.summary,''))>700 or char_length(coalesce(r.payload->>'notes',''))>1000,
    'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'title',left(s.title,180),
      'url',s.source_url,'excerpt',left(coalesce(nullif(s.payload->>'transcript',''),nullif(s.payload->>'notes',''),s.summary,''),600),
      'excerpted',char_length(s.title)>180 or char_length(coalesce(nullif(s.payload->>'transcript',''),nullif(s.payload->>'notes',''),s.summary,''))>600) order by s.id)
      from public.studio_record_links l join public.studio_records s on s.location_id=l.location_id and s.id=l.target_id
      where l.location_id=p_location_id and l.source_id=r.id),'[]'::jsonb)) order by r.id) into v_ideas
    from public.studio_records r where r.location_id=p_location_id and r.id=any(ids);
  v_snapshot := jsonb_build_object('focus',p_focus,'ideas',v_ideas);
  if octet_length(v_snapshot::text)>24000 then raise exception 'Selected research excerpts exceed review size; select fewer ideas' using errcode='22023'; end if;
  if p_workflow='script_brief' and not exists(select 1 from jsonb_array_elements(v_snapshot->'ideas'->0->'sources') s where btrim(s->>'excerpt')<>'') then
    raise exception 'Save supporting research text and link it to this idea before drafting' using errcode='22023'; end if;
  j := public.studio_enqueue_job(p_location_id,'studio.'||p_workflow,jsonb_build_object('reviewId',v_review),'text-run:'||p_request_id::text,p_clerk_user_id,5);
  insert into public.studio_idea_reviews(id,location_id,request_id,created_by_clerk_user_id,actor_app,request,snapshot,job_id,workflow,prompt_version)
    values(v_review,p_location_id,p_request_id,p_clerk_user_id,p_actor_app,v_request,v_snapshot,j.id,p_workflow,case when p_workflow='script_brief' then 'studio.script-brief.v1' else 'studio.idea-review.v1' end);
  return jsonb_build_object('reviewId',v_review,'jobId',j.id);
end; $$;

create or replace function public.studio_finish_text_run_attempt(p_location_id text,p_review_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,
  p_attempt_id uuid,p_result jsonb,p_input_tokens bigint,p_output_tokens bigint,p_response_id text,p_rate_version text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.studio_ai_attempts%rowtype; snapshot jsonb; v_workflow text; v_stale boolean;
begin
  perform public.studio_lock_text_run_lease(p_location_id,p_review_id,p_job_id,p_worker_id,p_lease_token);
  select * into a from public.studio_ai_attempts where id=p_attempt_id and idea_review_id=p_review_id and location_id=p_location_id
    and job_id=p_job_id and lease_token=p_lease_token for update;
  if a.id is null or a.status not in ('started','succeeded') then raise exception 'Attempt cannot finish' using errcode='40001'; end if;
  if a.status='succeeded' then return true; end if;
  select r.snapshot,r.workflow into snapshot,v_workflow from public.studio_idea_reviews r where id=p_review_id for update;
  if p_input_tokens is null or p_input_tokens not between 0 and 60000 or p_output_tokens is null
    or p_output_tokens not between 0 and (case when v_workflow in ('script_brief','knowledge_extract') then 6000 else 3000 end)
    or p_response_id is null or length(p_response_id) not between 1 and 200
    or p_rate_version is distinct from 'gpt-6-luna-standard-2026-10-23' then raise exception 'Invalid text usage' using errcode='22023'; end if;
  perform public.studio_validate_text_run_result(v_workflow,p_result,snapshot);
  if v_workflow='knowledge_extract' then
    v_stale := not public.studio_knowledge_snapshot_current(p_location_id,snapshot);
  else
  -- Preserve paid results even when content changed; never write back into ideas.
  perform 1 from public.studio_records r where r.location_id=p_location_id and r.id in
    (select (i->>'id')::uuid from jsonb_array_elements(snapshot->'ideas') i union
     select (s->>'id')::uuid from jsonb_array_elements(snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) order by r.id for share;
  select exists(select 1 from (select i from jsonb_array_elements(snapshot->'ideas') i union all
    select s from jsonb_array_elements(snapshot->'ideas') i,jsonb_array_elements(i->'sources') s) x where not exists
    (select 1 from public.studio_records r where r.location_id=p_location_id and r.id=(x.i->>'id')::uuid and r.version=(x.i->>'version')::bigint)) into v_stale;
  end if;
  perform public.studio_settle_ai_spend(p_location_id,a.usage_id,ceil((p_input_tokens::numeric+5*p_output_tokens)/10)::bigint,
    a.model,p_input_tokens,p_output_tokens,null);
  update public.studio_idea_reviews set result=p_result,stale_at_completion=v_stale,completed_at=clock_timestamp() where id=p_review_id;
  update public.studio_ai_attempts set status='succeeded',provider_response_id=p_response_id,rate_version=p_rate_version,updated_at=clock_timestamp() where id=a.id;
  return true;
end; $$;
revoke all on function public.studio_build_knowledge_snapshot(text,uuid,bigint,text,text,integer,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.studio_knowledge_snapshot_current(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.studio_validate_text_run_result(text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.studio_validate_text_run_result_v19(text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.studio_enqueue_knowledge_extraction(text,text,text,uuid,uuid,bigint,text,text,integer,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.studio_apply_knowledge_extraction(text,text,text,uuid,uuid,bigint,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.studio_knowledge_extraction_inputs(text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.studio_knowledge_extraction_state(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.studio_enqueue_knowledge_extraction(text,text,text,uuid,uuid,bigint,text,text,integer,integer,text,boolean) to service_role;
grant execute on function public.studio_apply_knowledge_extraction(text,text,text,uuid,uuid,bigint,jsonb,boolean) to service_role;
grant execute on function public.studio_knowledge_extraction_inputs(text,text,text,uuid) to service_role;
grant execute on function public.studio_knowledge_extraction_state(text,text,text,uuid) to service_role;
commit;
