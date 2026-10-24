begin;
-- Imported topic IDs/payloads are never merged or rewritten. Hosted name claims
-- are lazy and conservative: ASCII case + repeated spaces, no punctuation or
-- Unicode normalization. Ambiguous imported names require an explicit ID.
revoke all on public.studio_knowledge_topics from service_role;
grant select on public.studio_knowledge_topics to service_role;
create table public.studio_knowledge_topic_names (
 workspace_id uuid not null, name_key text not null, topic_id uuid not null,
 primary key(workspace_id,name_key),
 foreign key(workspace_id,topic_id) references public.studio_knowledge_topics(workspace_id,id)
);
create table public.studio_knowledge_commands (
 workspace_id uuid not null references public.studio_workspaces(id),request_id uuid not null,
 insight_id uuid not null,request jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,request_id),
 foreign key(workspace_id,insight_id) references public.studio_knowledge_insights(workspace_id,id)
);
alter table public.studio_knowledge_topic_names enable row level security;
alter table public.studio_knowledge_commands enable row level security;
revoke all on public.studio_knowledge_topic_names,public.studio_knowledge_commands from public,anon,authenticated,service_role;
grant select on public.studio_knowledge_topic_names,public.studio_knowledge_commands to service_role;
create function public.studio_knowledge_topic_key(p_name text) returns text language sql immutable set search_path='' as $$
 select translate(btrim(regexp_replace(p_name,' +',' ','g')),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
$$;
revoke all on function public.studio_knowledge_topic_key(text) from public,anon,authenticated,service_role;
create function public.studio_resolve_knowledge_topic(p_workspace uuid,p_name text,p_brand text,p_user text)
returns uuid language plpgsql security definer set search_path='' as $$
declare k text; topic uuid; matches uuid[]; at_iso text;
begin
 if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_name ~ '[[:cntrl:]]' then raise exception 'Topic name required' using errcode='22023'; end if;
 k:=public.studio_knowledge_topic_key(p_name);
 perform pg_advisory_xact_lock(hashtextextended('knowledge-topic:'||p_workspace::text||':'||k,0));
 select topic_id into topic from public.studio_knowledge_topic_names where workspace_id=p_workspace and name_key=k;
 if found then return topic; end if;
 select array_agg(id order by id) into matches from public.studio_knowledge_topics where workspace_id=p_workspace
  and jsonb_typeof(payload->'name')='string' and public.studio_knowledge_topic_key(payload->>'name')=k;
 if cardinality(matches)>1 then raise exception 'Multiple existing topics match; select an existing ID' using errcode='22023'; end if;
 topic:=matches[1];
 if topic is null then
  topic:=gen_random_uuid();at_iso:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.studio_knowledge_topics(workspace_id,id,payload) values(p_workspace,topic,jsonb_build_object('id',topic,'name',btrim(p_name),
   'created_at',at_iso,'origin','hosted','created_by_clerk_user_id',p_user,'actor_brand',p_brand));
 end if;
 insert into public.studio_knowledge_topic_names(workspace_id,name_key,topic_id) values(p_workspace,k,topic);
 return topic;
end; $$;
revoke all on function public.studio_resolve_knowledge_topic(uuid,text,text,text) from public,anon,authenticated,service_role;

create function public.studio_mutate_knowledge_insight(p_workspace uuid,p_brand text,p_user text,p_insight uuid,p_request uuid,p_version bigint,
 p_action text,p_statement text,p_topic jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.studio_knowledge_insights%rowtype; prior public.studio_knowledge_commands%rowtype;
 command jsonb; v_result jsonb; v_statement text; v_status text; v_topic uuid; v_topic_name text; old_topic_name text;
 v_source uuid; v_review uuid:=gen_random_uuid(); at_iso text;
begin
 perform public.studio_lock_workspace_member(p_workspace,p_brand,p_user);
 if p_insight is null or p_request is null or p_version is null or p_version<1 or p_action is null or p_action not in ('edit','approve','reject','reopen')
 or p_reason is null or char_length(p_reason)>2000 or jsonb_typeof(p_topic) is distinct from 'object'
 or p_topic->>'mode' is null or p_topic->>'mode' not in ('keep','existing','create')
 or (p_action<>'approve' and p_topic<>'{"mode":"keep"}'::jsonb)
 or (p_statement is not null and (char_length(p_statement) not between 1 and 4000 or p_statement ~ '^[[:space:]]*$'))
 or (p_action='edit' and p_statement is null) then raise exception 'Invalid knowledge command' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('knowledge-command:'||p_workspace::text||':'||p_request::text,0));
 command:=jsonb_build_object('insightId',p_insight,'actor',p_user,'brand',p_brand,'version',p_version,'action',p_action,'statement',p_statement,'topic',p_topic,'reason',p_reason);
 select * into prior from public.studio_knowledge_commands where workspace_id=p_workspace and request_id=p_request;
 if found then
  if prior.request is distinct from command then raise exception 'Knowledge request reused' using errcode='23505'; end if;
  return prior.result;
 end if;
 select source_id into v_source from public.studio_knowledge_insights where workspace_id=p_workspace and id=p_insight;
 if not found then raise exception 'Finding unavailable' using errcode='P0002'; end if;
 -- Shares extraction's source fence: edits cannot race exact-match application.
 perform pg_advisory_xact_lock(hashtextextended('knowledge-apply:'||p_workspace::text||':'||v_source::text,0));
 select * into old from public.studio_knowledge_insights where workspace_id=p_workspace and id=p_insight for update;
 if old.id is null then raise exception 'Finding unavailable' using errcode='P0002'; end if;
 if old.version<>p_version then raise exception 'Finding changed' using errcode='40001'; end if;
 if (p_action in ('approve','reject') and old.status<>'pending') or (p_action='reopen' and old.status='pending') then raise exception 'Invalid status transition' using errcode='22023'; end if;
 v_statement:=coalesce(p_statement,old.statement);
 if v_statement ~ '^[[:space:]]*$' then raise exception 'Enter a nonempty statement' using errcode='22023'; end if;
 if p_action='edit' and v_statement=old.statement then raise exception 'Statement is unchanged' using errcode='22023'; end if;
 if v_statement<>old.statement and exists(select 1 from public.studio_knowledge_insights i where i.workspace_id=p_workspace and i.source_id=old.source_id
  and i.id<>old.id and i.statement=v_statement and i.payload->>'kind' is not distinct from old.payload->>'kind') then raise exception 'Duplicate finding statement' using errcode='23505'; end if;
 v_status:=case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'pending' end;
 v_topic:=old.topic_id;
 if p_action='approve' then
  if p_topic->>'mode'='existing' then
   if jsonb_typeof(p_topic->'id') is distinct from 'string' then raise exception 'Choose a topic ID' using errcode='22023'; end if;
   v_topic:=(p_topic->>'id')::uuid;
  elsif p_topic->>'mode'='create' then
   if jsonb_typeof(p_topic->'name') is distinct from 'string' then raise exception 'Enter a topic name' using errcode='22023'; end if;
   v_topic:=public.studio_resolve_knowledge_topic(p_workspace,p_topic->>'name',p_brand,p_user);
  end if;
  select payload->>'name' into v_topic_name from public.studio_knowledge_topics where workspace_id=p_workspace and id=v_topic and jsonb_typeof(payload->'name')='string' for share;
  if not found or btrim(coalesce(v_topic_name,''))='' then raise exception 'Choose a workspace topic before approval' using errcode='22023'; end if;
 end if;
 select payload->>'name' into old_topic_name from public.studio_knowledge_topics where workspace_id=p_workspace and id=old.topic_id;
 if p_action<>'approve' then v_topic_name:=old_topic_name; end if;
 at_iso:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.studio_knowledge_insights set statement=v_statement,status=v_status,topic_id=v_topic,version=version+1 where workspace_id=p_workspace and id=p_insight;
 insert into public.studio_knowledge_reviews(workspace_id,id,insight_id,payload) values(p_workspace,v_review,p_insight,jsonb_build_object(
  'id',v_review,'insight_id',p_insight,'action',p_action,'previous_status',old.status,'new_status',v_status,
  'previous_statement',old.statement,'new_statement',v_statement,'previous_topic_id',old.topic_id,'new_topic_id',v_topic,
  'previous_topic_name',old_topic_name,'new_topic_name',v_topic_name,'at',at_iso,'actor_brand',p_brand,'actor_clerk_user_id',p_user,
  'version',old.version+1,'origin','hosted','reason',nullif(p_reason,''),'request_id',p_request));
 v_result:=jsonb_build_object('workspaceId',p_workspace,'insightId',p_insight,'reviewId',v_review,'previousStatus',old.status,
  'status',v_status,'version',old.version+1,'topicId',v_topic,'at',at_iso);
 insert into public.studio_knowledge_commands(workspace_id,request_id,insight_id,request,result) values(p_workspace,p_request,p_insight,command,v_result);
 return v_result;
end; $$;
revoke all on function public.studio_mutate_knowledge_insight(uuid,text,text,uuid,uuid,bigint,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studio_mutate_knowledge_insight(uuid,text,text,uuid,uuid,bigint,text,text,jsonb,text) to service_role;

create function public.studio_find_knowledge_topics(p_workspace uuid,p_brand text,p_user text,p_query text)
returns table(id uuid,name text) language plpgsql security definer set search_path='' as $$
begin
 perform public.studio_lock_workspace_member(p_workspace,p_brand,p_user);
 if p_query is null or char_length(p_query)>120 or p_query ~ '[[:cntrl:]]' then raise exception 'Invalid topic query' using errcode='22023'; end if;
 return query select t.id,t.payload->>'name' from public.studio_knowledge_topics t where t.workspace_id=p_workspace
  and jsonb_typeof(t.payload->'name')='string' and strpos(lower(t.payload->>'name'),lower(p_query))>0
  order by lower(t.payload->>'name'),t.id limit 101;
end; $$;
revoke all on function public.studio_find_knowledge_topics(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.studio_find_knowledge_topics(uuid,text,text,text) to service_role;

-- Older tabs retain safe status review, but approval now assigns/reuses the
-- current suggested topic when no topic is assigned. New clients choose it.
create or replace function public.studio_review_knowledge_insight(p_workspace_id uuid,p_insight_id uuid,p_action text,p_expected_version bigint,
 p_actor_brand text,p_clerk_user_id text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.studio_knowledge_insights%rowtype; topic jsonb:='{"mode":"keep"}';
begin
 perform public.studio_lock_workspace_member(p_workspace_id,p_actor_brand,p_clerk_user_id);
 select * into i from public.studio_knowledge_insights where workspace_id=p_workspace_id and id=p_insight_id;
 if p_action='approve' and i.topic_id is null then topic:=jsonb_build_object('mode','create','name',i.payload->>'suggested_topic'); end if;
 return public.studio_mutate_knowledge_insight(p_workspace_id,p_actor_brand,p_clerk_user_id,p_insight_id,gen_random_uuid(),p_expected_version,p_action,null,topic,coalesce(p_reason,''));
end; $$;
commit;
