do $$
#variable_conflict use_variable
declare
  substo_location text := '91000000-0000-4000-8000-000000000001';
  estio_location text := '91000000-0000-4000-8000-000000000002';
  source_id uuid := '92000000-0000-4000-8000-000000000001';
  insight_id uuid := '93000000-0000-4000-8000-000000000001';
  estio_source_id uuid := '92000000-0000-4000-8000-000000000002';
  estio_insight_id uuid := '93000000-0000-4000-8000-000000000002';
  original_insight jsonb := '{"id":"93000000-0000-4000-8000-000000000001","source_id":"92000000-0000-4000-8000-000000000001","status":"pending","kind":"claim","statement":"  Original exact text  "}'::jsonb;
  original_review jsonb := '{"action":"reopen","previous_status":"approved","new_status":"pending","at":"2026-01-01T00:00:00.000Z","legacy_unknown":{"keep":true}}'::jsonb;
  result jsonb;
  prior_count integer;
  review_id uuid;
begin
  if has_function_privilege('anon','public.studio_review_knowledge_insight(text,uuid,text,bigint,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.studio_review_knowledge_insight(text,uuid,text,bigint,text,text,text)','EXECUTE')
    or not has_function_privilege('service_role','public.studio_review_knowledge_insight(text,uuid,text,bigint,text,text,text)','EXECUTE')
    or not has_table_privilege('service_role','public.studio_knowledge_reviews','SELECT')
    or not has_table_privilege('service_role','public.studio_knowledge_insights','SELECT')
    or has_table_privilege('service_role','public.studio_knowledge_reviews','INSERT')
    or has_table_privilege('service_role','public.studio_knowledge_reviews','UPDATE')
    or has_table_privilege('service_role','public.studio_knowledge_reviews','DELETE')
    or has_table_privilege('service_role','public.studio_knowledge_reviews','TRUNCATE')
    or has_table_privilege('service_role','public.studio_knowledge_insights','INSERT')
    or has_table_privilege('service_role','public.studio_knowledge_insights','UPDATE')
    or has_table_privilege('service_role','public.studio_knowledge_insights','DELETE')
    or has_table_privilege('service_role','public.studio_knowledge_insights','TRUNCATE') then
    raise exception 'Knowledge review grants are unsafe';
  end if;

  perform public.studio_create_substo_location(substo_location,'Review fixture','review-owner');
  perform public.studio_save_record(substo_location,source_id,'reference','Review source','{}',0,'review-owner');
  insert into public.studio_knowledge_sources(location_id,id,payload,total_units,covered_units)
    values(substo_location,source_id,'{"title":"Review source"}',0,0);
  insert into public.studio_knowledge_insights(location_id,id,source_id,status,statement,payload)
    values(substo_location,insight_id,source_id,'pending','  Original exact text  ',original_insight);
  insert into public.studio_knowledge_reviews(location_id,id,insight_id,payload)
    values(substo_location,'94000000-0000-4000-8000-000000000001',insight_id,original_review);

  begin
    perform public.studio_review_knowledge_insight(substo_location,insight_id,'approve',1,'substo','outsider',null);
    raise exception 'Nonmember reviewed Substo insight';
  exception when insufficient_privilege then null; end;
  begin
    perform public.studio_review_knowledge_insight(substo_location,insight_id,'approve',1,'estio','review-owner',null);
    raise exception 'Wrong-app actor reviewed Substo insight';
  exception when insufficient_privilege then null; end;
  begin
    perform public.studio_review_knowledge_insight(substo_location,estio_insight_id,'approve',1,'substo','review-owner',null);
    raise exception 'Missing insight accepted';
  exception when no_data_found then null; end;
  begin
    perform public.studio_review_knowledge_insight(substo_location,insight_id,'approve',1,'substo','review-owner',repeat('x',2001));
    raise exception 'Oversized review reason accepted';
  exception when invalid_parameter_value then null; end;

  result := public.studio_review_knowledge_insight(substo_location,insight_id,'approve',1,'substo','review-owner','  exact reason  ');
  review_id := (result->>'reviewId')::uuid;
  if result->>'locationId' is distinct from substo_location::text
    or result->>'insightId' is distinct from insight_id::text
    or result->>'previousStatus' is distinct from 'pending'
    or result->>'status' is distinct from 'approved'
    or result->>'version' is distinct from '2'
    or result->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    or (select payload from public.studio_knowledge_insights where location_id=substo_location and id=insight_id) is distinct from original_insight
    or (select payload from public.studio_knowledge_reviews where location_id=substo_location and id='94000000-0000-4000-8000-000000000001') is distinct from original_review
    or (select payload->>'reason' from public.studio_knowledge_reviews where location_id=substo_location and id=review_id) is distinct from '  exact reason  '
    or (select payload->>'actor_clerk_user_id' from public.studio_knowledge_reviews where location_id=substo_location and id=review_id) is distinct from 'review-owner'
    or (select payload->>'actor_app' from public.studio_knowledge_reviews where location_id=substo_location and id=review_id) is distinct from 'substo'
    or (select payload->>'at' from public.studio_knowledge_reviews where location_id=substo_location and id=review_id) is distinct from result->>'at'
    or (select count(*) from public.studio_knowledge_reviews r where location_id=substo_location and r.insight_id=insight_id) <> 2 then
    raise exception 'Audited approval did not preserve provenance and attribution';
  end if;

  begin
    perform public.studio_review_knowledge_insight(substo_location,insight_id,'approve',1,'substo','review-owner',null);
    raise exception 'Stale retry accepted and duplicated review';
  exception when serialization_failure then null; end;
  begin
    perform public.studio_review_knowledge_insight(substo_location,insight_id,'reject',2,'substo','review-owner',null);
    raise exception 'Direct approved-to-rejected switch accepted';
  exception when invalid_parameter_value then null; end;
  result := public.studio_review_knowledge_insight(substo_location,insight_id,'reopen',2,'substo','review-owner',null);
  if result->>'status' is distinct from 'pending' or result->>'version' is distinct from '3' then
    raise exception 'Reopen did not advance version';
  end if;
  result := public.studio_review_knowledge_insight(substo_location,insight_id,'reject',3,'substo','review-owner','');
  if result->>'status' is distinct from 'rejected' or result->>'version' is distinct from '4'
    or (select payload->'reason' from public.studio_knowledge_reviews where location_id=substo_location and id=(result->>'reviewId')::uuid) is distinct from 'null'::jsonb then
    raise exception 'Rejection did not record status or normalized empty reason';
  end if;
  begin
    perform public.studio_review_knowledge_insight(substo_location,insight_id,'reject',4,'substo','review-owner',null);
    raise exception 'No-op review accepted';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.studio_knowledge_reviews r where location_id=substo_location and r.insight_id=insight_id) <> 4 then
    raise exception 'Rejected review attempts changed history';
  end if;

  -- Force the append to fail after the status UPDATE. The caught RPC call must
  -- roll back both writes, leaving version and event count unchanged.
  alter table public.studio_knowledge_reviews add constraint studio_review_forced_failure
    check ((payload->>'origin') is distinct from 'hosted') not valid;
  prior_count := (select count(*) from public.studio_knowledge_reviews r where location_id=substo_location and r.insight_id=insight_id);
  begin
    perform public.studio_review_knowledge_insight(substo_location,insight_id,'reopen',4,'substo','review-owner',null);
    raise exception 'Forced event failure did not fail RPC';
  exception when check_violation then null; end;
  if (select status from public.studio_knowledge_insights where location_id=substo_location and id=insight_id) is distinct from 'rejected'
    or (select version from public.studio_knowledge_insights where location_id=substo_location and id=insight_id) <> 4
    or (select count(*) from public.studio_knowledge_reviews r where location_id=substo_location and r.insight_id=insight_id) <> prior_count then
    raise exception 'Failed audit append left a partial status update';
  end if;
  alter table public.studio_knowledge_reviews drop constraint studio_review_forced_failure;

  -- Every active Substo role can review, matching Studio's existing write
  -- authority. A removed member cannot create the next decision.
  insert into public.studio_location_memberships(location_id,location_app,clerk_user_id,role)
    values(substo_location,'substo','review-member','member');
  result := public.studio_review_knowledge_insight(substo_location,insight_id,'reopen',4,'substo','review-member',null);
  if result->>'status' is distinct from 'pending' or result->>'version' is distinct from '5'
    or (select payload->>'actor_clerk_user_id' from public.studio_knowledge_reviews
        where location_id=substo_location and id=(result->>'reviewId')::uuid) is distinct from 'review-member' then
    raise exception 'Active member review was not audited';
  end if;
  delete from public.studio_location_memberships
    where location_id=substo_location and clerk_user_id='review-member';
  begin
    perform public.studio_review_knowledge_insight(substo_location,insight_id,'approve',5,'substo','review-member',null);
    raise exception 'Revoked member reviewed Knowledge';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.studio_knowledge_reviews r where location_id=substo_location and r.insight_id=insight_id) <> 5 then
    raise exception 'Revoked member changed review history';
  end if;

  insert into public.studio_locations(location_id,app,name)
    values(estio_location,'estio','Estio review fixture');
  perform public.studio_save_record(estio_location,estio_source_id,'reference','Estio source','{}',0,'estio-user');
  insert into public.studio_knowledge_sources(location_id,id,payload,total_units,covered_units)
    values(estio_location,estio_source_id,'{"title":"Estio source"}',0,0);
  insert into public.studio_knowledge_insights(location_id,id,source_id,status,statement,payload)
    values(estio_location,estio_insight_id,estio_source_id,'pending','Estio finding','{"status":"pending"}');
  begin
    perform public.studio_review_knowledge_insight(estio_location,estio_insight_id,'approve',1,'substo','estio-user',null);
    raise exception 'Wrong-app Estio review accepted';
  exception when insufficient_privilege then null; end;
  result := public.studio_review_knowledge_insight(estio_location,estio_insight_id,'approve',1,'estio','estio-user',null);
  if result->>'status' is distinct from 'approved' or result->>'version' is distinct from '2'
    or (select payload->>'actor_app' from public.studio_knowledge_reviews where location_id=estio_location and id=(result->>'reviewId')::uuid) is distinct from 'estio' then
    raise exception 'Estio server-authorized review failed';
  end if;
end;
$$;
select 'Studio knowledge review assertions passed' as result;
