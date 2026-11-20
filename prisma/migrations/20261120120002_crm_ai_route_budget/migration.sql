BEGIN;

ALTER TABLE studio.studio_ai_usage DROP CONSTRAINT studio_ai_usage_provider_check;
ALTER TABLE studio.studio_ai_usage ADD CONSTRAINT studio_ai_usage_provider_check
  CHECK (provider = 'openai' OR (provider = 'google_gemini' AND operation LIKE 'crm.%'));

-- Share Studio's Location budget row lock and usage ledger so CRM and Studio
-- cannot admit concurrent requests against the same remaining budget.
CREATE FUNCTION studio.studio_reserve_crm_ai_spend(
  p_location_id text, p_kind text, p_operation text, p_estimated_micros bigint, p_route jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_budget bigint;
  v_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_used bigint;
  v_id uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('openai_key', 'gemini_key')
    OR p_operation IS NULL OR p_operation NOT IN ('crm_text', 'crm_translation', 'crm_extraction', 'crm_summary', 'onboarding_answer', 'onboarding_research')
    OR p_estimated_micros IS NULL OR p_estimated_micros <= 0 THEN
    RAISE EXCEPTION 'Invalid CRM AI reservation' USING ERRCODE = '22023';
  END IF;

  SELECT monthly_budget_micros INTO v_budget FROM studio.studio_location_ai_settings
    WHERE location_id = p_location_id FOR UPDATE;
  IF v_budget IS NULL OR v_budget = 0
    OR NOT (p_kind = ANY (studio.studio_location_ai_chain(p_location_id))) THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(CASE status WHEN 'settled' THEN cost_micros WHEN 'reserved' THEN reserved_micros ELSE 0 END), 0)
    INTO v_used FROM studio.studio_ai_usage WHERE location_id = p_location_id AND usage_month = v_month;
  IF v_used + p_estimated_micros > v_budget THEN RETURN NULL; END IF;

  INSERT INTO studio.studio_ai_usage(location_id, provider, operation, status, reserved_micros, usage_month, route)
    VALUES (p_location_id, CASE p_kind WHEN 'openai_key' THEN 'openai' ELSE 'google_gemini' END,
      'crm.' || p_operation, 'reserved', p_estimated_micros, v_month, p_route)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION studio.studio_settle_crm_ai_spend(
  p_location_id text, p_usage_id uuid, p_cost_micros bigint, p_model text,
  p_input_tokens bigint, p_output_tokens bigint, p_route jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM studio.studio_ai_usage WHERE id = p_usage_id AND location_id = p_location_id
    AND operation LIKE 'crm.%' AND status IN ('reserved', 'settled') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown CRM AI reservation' USING ERRCODE = '22023';
  END IF;
  PERFORM studio.studio_settle_ai_spend(p_location_id, p_usage_id, p_cost_micros, p_model, p_input_tokens, p_output_tokens, NULL);
  UPDATE studio.studio_ai_usage SET route = p_route WHERE id = p_usage_id AND location_id = p_location_id;
END;
$$;

CREATE FUNCTION studio.studio_release_crm_ai_spend(p_location_id text, p_usage_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM studio.studio_ai_usage WHERE id = p_usage_id
    AND location_id = p_location_id AND operation LIKE 'crm.%')
    THEN studio.studio_release_ai_spend(p_location_id, p_usage_id) ELSE false END;
$$;

REVOKE ALL ON FUNCTION studio.studio_release_crm_ai_spend(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_release_crm_ai_spend(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION studio.studio_reserve_crm_ai_spend(text, text, text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION studio.studio_settle_crm_ai_spend(text, uuid, bigint, text, bigint, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_reserve_crm_ai_spend(text, text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION studio.studio_settle_crm_ai_spend(text, uuid, bigint, text, bigint, bigint, jsonb) TO service_role;

COMMIT;
