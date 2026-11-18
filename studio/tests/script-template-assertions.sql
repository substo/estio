\set ON_ERROR_STOP 1
BEGIN;

SELECT public.test_location('templates-estio', 'estio');
SELECT public.test_location('templates-substo', 'substo');
SELECT public.test_member('templates-estio', 'template-member', 'member');
SELECT public.test_member('templates-estio', 'template-admin', 'admin');
SELECT public.test_member('templates-substo', 'template-admin', 'admin');

DO $$
DECLARE
  template uuid := gen_random_uuid();
  other_template uuid := gen_random_uuid();
  original uuid := gen_random_uuid();
  revised uuid := gen_random_uuid();
  other_version uuid := gen_random_uuid();
  content uuid := gen_random_uuid();
  new_content uuid := gen_random_uuid();
  beats jsonb := '[{"name":"Hook","guidance":"Open with proof"},{"name":"Demo","guidance":"Show the result"}]';
  payload jsonb := '{"stage":"script","script":"Existing script","notes":"Existing production notes","approved":true,"importMetadata":{"old":true}}';
  snap jsonb;
BEGIN
  PERFORM studio.studio_save_record('templates-estio', content, 'content', 'Existing', payload, 0, 'template-member');
  IF studio.studio_script_template_snapshot('templates-estio', content) IS NOT NULL THEN
    RAISE EXCEPTION 'Existing content should have no selection';
  END IF;
  PERFORM studio.studio_propose_script_template('templates-estio', 'estio', 'template-member', template, original, 0, 'Proof first', 'Open with the outcome', beats);
  PERFORM studio.studio_propose_script_template('templates-estio', 'estio', 'template-member', template, original, 0, 'Proof first', 'Open with the outcome', beats);
  BEGIN
    PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', content, 'Existing', '{}', 1, original);
    RAISE EXCEPTION 'Draft version could be used';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM studio.studio_approve_script_template('templates-estio', 'estio', 'template-member', template, original);
    RAISE EXCEPTION 'Member could approve';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM studio.studio_approve_script_template('templates-estio', 'substo', 'template-admin', template, original);
    RAISE EXCEPTION 'Cross-app admin could approve';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM studio.studio_propose_script_template('templates-estio', 'estio', 'template-outsider', template, revised, 1, 'Outsider', 'Outsider', beats);
    RAISE EXCEPTION 'Unrelated Estio account could propose';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM studio.studio_approve_script_template('templates-estio', 'estio', 'template-admin', template, original);
  PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', content, 'Existing', '{}', 1, original);
  PERFORM studio.studio_propose_script_template('templates-estio', 'estio', 'template-member', template, revised, 1, 'Proof and demo', 'An expanded purpose', beats);
  BEGIN
    PERFORM studio.studio_approve_script_template('templates-estio', 'estio', 'template-admin', template, original);
    RAISE EXCEPTION 'Stale approval succeeded';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM studio.studio_propose_script_template('templates-estio', 'estio', 'template-admin', template, gen_random_uuid(), 1, 'Lost edit', 'Draft', beats);
    RAISE EXCEPTION 'Stale template save succeeded';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  PERFORM studio.studio_approve_script_template('templates-estio', 'estio', 'template-admin', template, revised);
  snap := studio.studio_script_template_snapshot('templates-estio', content);
  IF snap->>'versionId' IS DISTINCT FROM original::text OR snap->>'name' IS DISTINCT FROM 'Proof first'
    OR snap->'beats' IS DISTINCT FROM beats OR snap->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'The saved script lost its pinned version: %', snap;
  END IF;
  IF (SELECT r.payload FROM studio.studio_records r WHERE r.location_id = 'templates-estio' AND r.id = content)
    IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Template selection modified script data'; END IF;

  PERFORM studio.studio_propose_script_template('templates-substo', 'substo', 'template-admin', other_template, other_version, 0, 'Substo', 'Own brand', beats);
  PERFORM studio.studio_approve_script_template('templates-substo', 'substo', 'template-admin', other_template, other_version);
  BEGIN
    PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', content, 'Wrong', '{}', 2, other_version);
    RAISE EXCEPTION 'Cross-Location version could be used';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF studio.studio_script_template_snapshot('templates-substo', content) IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot exposed cross-Location content';
  END IF;
  PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', content, 'Existing', '{}', 2, revised);
  BEGIN
    PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', content, 'Stale', '{}', 2, NULL);
    RAISE EXCEPTION 'A stale record could change the selection';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  IF studio.studio_script_template_snapshot('templates-estio', content)->>'versionId' IS DISTINCT FROM revised::text THEN
    RAISE EXCEPTION 'Explicit update failed or stale save changed the selection';
  END IF;
  PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', content, 'Existing', '{}', 3, NULL);
  IF studio.studio_script_template_snapshot('templates-estio', content) IS NOT NULL
    OR NOT (SELECT r.script_template_selected FROM studio.studio_records r WHERE r.location_id = 'templates-estio' AND r.id = content) THEN
    RAISE EXCEPTION 'Explicit opt-out lost';
  END IF;
  PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', new_content, 'New', '{}', 0, revised);
  PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', new_content, 'New', '{}', 0, revised);
  BEGIN
    PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', new_content, 'New', '{}', 0, original);
    RAISE EXCEPTION 'A retried creation could swap the template';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  DELETE FROM public."UserLocationRole" WHERE "locationId" = 'templates-estio' AND role = 'MEMBER';
  BEGIN
    PERFORM studio.studio_save_content_template_selection('templates-estio', 'estio', 'template-member', content, 'Revoked', '{}', 4, revised);
    RAISE EXCEPTION 'Revoked member could select a template';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
