-- Real shared-budget admissions with no provider traffic. Run after the Phase A
-- routing assertions in scripts/test-studio-ai-routing.sh.
DO $$
DECLARE
  location_id text := 'f7a10000-0000-4000-8000-000000000004';
  crm_id uuid;
  studio_id uuid;
  plan jsonb := '{"operation":"crm_text","requested":{"kind":"chatgpt_subscription","model":"gpt-5.4"},"actual":{"kind":"gemini_key","model":"gemini-2.5-flash"},"switchReason":"Limit or quota reached → Gemini API"}';
BEGIN
  PERFORM studio.studio_create_substo_location(location_id, 'CRM route budget', 'route-owner');
  PERFORM studio.studio_set_ai_budget(location_id, 'substo', 'route-owner', 15000);
  IF studio.studio_reserve_crm_ai_spend(location_id, 'gemini_key', 'crm_text', 10000, plan) IS NOT NULL THEN
    RAISE EXCEPTION 'Default order admitted a paid CRM attempt';
  END IF;

  INSERT INTO public.settings_documents VALUES
    ('LOCATION', location_id, 'location.ai', '{"aiRouting":{"chain":[{"kind":"openai_key"},{"kind":"gemini_key"}]}}');
  INSERT INTO public.settings_secrets VALUES ('LOCATION', location_id, 'location.ai', 'openai_api_key');
  crm_id := studio.studio_reserve_crm_ai_spend(location_id, 'gemini_key', 'crm_text', 10000, plan);
  IF crm_id IS NULL THEN RAISE EXCEPTION 'CRM could not reserve against a funded order'; END IF;
  IF studio.studio_reserve_ai_spend(location_id, 'openai', 'idea_review', 10000) IS NOT NULL THEN
    RAISE EXCEPTION 'Studio did not account for the CRM hold';
  END IF;
  IF studio.studio_reserve_crm_ai_spend(location_id, 'openai_key', 'crm_text', 10000, plan) IS NOT NULL THEN
    RAISE EXCEPTION 'CRM did not account for the existing hold';
  END IF;

  IF NOT studio.studio_release_crm_ai_spend(location_id, crm_id) THEN
    RAISE EXCEPTION 'CRM could not release its rejected attempt';
  END IF;
  studio_id := studio.studio_reserve_ai_spend(location_id, 'openai', 'idea_review', 10000);
  IF studio_id IS NULL THEN RAISE EXCEPTION 'CRM release did not free budget'; END IF;
  IF studio.studio_reserve_crm_ai_spend(location_id, 'gemini_key', 'crm_text', 10000, plan) IS NOT NULL THEN
    RAISE EXCEPTION 'CRM did not account for the Studio hold';
  END IF;
  IF studio.studio_release_crm_ai_spend(location_id, studio_id) THEN
    RAISE EXCEPTION 'CRM released a Studio hold';
  END IF;
  PERFORM studio.studio_release_ai_spend(location_id, studio_id);
  crm_id := studio.studio_reserve_crm_ai_spend(location_id, 'gemini_key', 'crm_text', 10000, plan);
  PERFORM studio.studio_settle_crm_ai_spend(location_id, crm_id, 6000, 'gemini-2.5-flash', 30, 20, plan);
  IF NOT EXISTS (
    SELECT 1 FROM studio.studio_ai_usage WHERE id = crm_id AND status = 'settled' AND provider = 'google_gemini'
      AND cost_micros = 6000 AND model = 'gemini-2.5-flash' AND route = plan
  ) THEN RAISE EXCEPTION 'CRM settlement did not retain metering and route'; END IF;
  IF studio.studio_reserve_ai_spend(location_id, 'openai', 'idea_review', 10000) IS NOT NULL THEN
    RAISE EXCEPTION 'Studio did not account for the CRM settlement';
  END IF;
  RAISE NOTICE 'CRM route budget assertions passed';
END $$;
