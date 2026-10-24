-- Hosted Knowledge review decisions. The imported insight/review payloads remain
-- exact provenance; current status and optimistic version are separate columns.
begin;

alter table public.studio_knowledge_insights
  add column version bigint not null default 1
  constraint studio_knowledge_insights_version_positive check (version > 0);

-- Keep imported payloads and audit history immutable through the service role.
-- Both import and review RPCs are security-definer functions owned by the
-- migration role, so their writes still work without direct table DML grants.
revoke all on public.studio_knowledge_insights, public.studio_knowledge_reviews from service_role;
grant select on public.studio_knowledge_insights, public.studio_knowledge_reviews to service_role;

create function public.studio_review_knowledge_insight(
  p_workspace_id uuid,
  p_insight_id uuid,
  p_action text,
  p_expected_version bigint,
  p_actor_brand text,
  p_clerk_user_id text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_brand text;
  v_insight public.studio_knowledge_insights%rowtype;
  v_next_status text;
  v_review_id uuid;
  v_at timestamptz;
  v_at_iso text;
  v_reason text;
begin
  if p_workspace_id is null or p_insight_id is null
    or p_action is null or p_action not in ('approve','reject','reopen')
    or p_expected_version is null or p_expected_version < 1
    or p_actor_brand is null or p_actor_brand not in ('estio','substo')
    or p_clerk_user_id is null or pg_catalog.btrim(p_clerk_user_id) = ''
    or p_reason is not null and pg_catalog.char_length(p_reason) > 2000 then
    raise exception 'Invalid knowledge review request' using errcode = '22023';
  end if;

  select brand into v_brand from public.studio_workspaces where id = p_workspace_id;
  if v_brand is null or v_brand <> p_actor_brand then
    raise exception 'Knowledge reviewer has no workspace access' using errcode = '42501';
  end if;
  -- Estio's location/team authority lives in its separate Business database.
  -- The trusted server must check it (and reject impersonated writes) before
  -- this service-role RPC. Substo memberships can be checked again here.
  if v_brand = 'substo' then
    -- Hold the membership through the decision; a concurrent revoke must wait
    -- for this transaction instead of committing between authorization and audit.
    perform 1 from public.studio_workspace_memberships
      where workspace_id = p_workspace_id and workspace_brand = 'substo'
        and clerk_user_id = p_clerk_user_id
      for share;
    if not found then
      raise exception 'Knowledge reviewer has no workspace membership' using errcode = '42501';
    end if;
  end if;

  select * into v_insight from public.studio_knowledge_insights
  where workspace_id = p_workspace_id and id = p_insight_id for update;
  if not found then
    raise exception 'Knowledge insight was not found in workspace' using errcode = 'P0002';
  end if;
  if v_insight.version <> p_expected_version then
    raise exception 'Knowledge insight changed since it was loaded' using errcode = '40001';
  end if;

  v_next_status := case p_action
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    else 'pending'
  end;
  if (v_insight.status = 'pending' and p_action not in ('approve','reject'))
    or (v_insight.status in ('approved','rejected') and p_action <> 'reopen') then
    raise exception 'Invalid knowledge review transition' using errcode = '22023';
  end if;

  v_at := pg_catalog.clock_timestamp();
  v_at_iso := pg_catalog.to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_reason := nullif(p_reason, '');
  v_review_id := pg_catalog.gen_random_uuid();

  update public.studio_knowledge_insights
    set status = v_next_status, version = version + 1
    where workspace_id = p_workspace_id and id = p_insight_id;
  insert into public.studio_knowledge_reviews(workspace_id,id,insight_id,payload)
    values(p_workspace_id,v_review_id,p_insight_id,pg_catalog.jsonb_build_object(
      'id',v_review_id,
      'insight_id',p_insight_id,
      'action',p_action,
      'previous_status',v_insight.status,
      'new_status',v_next_status,
      'at',v_at_iso,
      'actor_brand',p_actor_brand,
      'actor_clerk_user_id',p_clerk_user_id,
      'version',v_insight.version + 1,
      'origin','hosted',
      'reason',v_reason
    ));
  return pg_catalog.jsonb_build_object(
    'workspaceId',p_workspace_id,
    'insightId',p_insight_id,
    'reviewId',v_review_id,
    'previousStatus',v_insight.status,
    'status',v_next_status,
    'version',v_insight.version + 1,
    'at',v_at_iso
  );
end;
$$;
revoke all on function public.studio_review_knowledge_insight(uuid,uuid,text,bigint,text,text,text)
  from public,anon,authenticated;
grant execute on function public.studio_review_knowledge_insight(uuid,uuid,text,bigint,text,text,text)
  to service_role;
commit;
