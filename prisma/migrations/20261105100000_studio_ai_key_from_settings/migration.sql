-- Studio uses the Location's encrypted OpenAI key in settings (shared with the CRM), not studio_location_ai_credentials.
-- Budget reservation now checks that key. The old table stays until it is dropped in a later cleanup.
CREATE OR REPLACE FUNCTION studio.studio_reserve_ai_spend(p_location_id text, p_provider text, p_operation text, p_estimated_micros bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_budget bigint;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_used bigint;
  v_id uuid;
begin
  if p_estimated_micros is null or p_estimated_micros < 0 then raise exception 'Invalid estimate' using errcode = '22023'; end if;
  select monthly_budget_micros into v_budget from studio.studio_location_ai_settings where location_id=p_location_id for update;
  if v_budget is null or v_budget = 0 then return null; end if;
  if p_provider <> 'openai' or not exists(select 1 from public.settings_secrets s where s.scope_type::text = 'LOCATION' and s.scope_id = p_location_id
      and s.domain = 'location.ai' and s.secret_key = 'openai_api_key') then return null; end if;
  select coalesce(pg_catalog.sum(case status when 'settled' then cost_micros when 'reserved' then reserved_micros else 0 end),0)
    into v_used from studio.studio_ai_usage where location_id=p_location_id and usage_month=v_month;
  if v_used + p_estimated_micros > v_budget then return null; end if;
  insert into studio.studio_ai_usage(location_id,provider,operation,status,reserved_micros,usage_month)
    values(p_location_id,p_provider,p_operation,'reserved',p_estimated_micros,v_month) returning id into v_id;
  return v_id;
end;
$$;
