BEGIN;

CREATE TABLE studio.studio_script_template_versions (
  location_id text NOT NULL REFERENCES public."Location"(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  template_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  purpose text NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 1 AND 500),
  beats jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_clerk_user_id text NOT NULL,
  approved_at timestamptz,
  approved_by_clerk_user_id text,
  PRIMARY KEY (location_id, id),
  UNIQUE (location_id, template_id, version),
  CHECK ((approved_at IS NULL) = (approved_by_clerk_user_id IS NULL))
);

ALTER TABLE studio.studio_records
  ADD COLUMN script_template_version_id uuid,
  ADD COLUMN script_template_selected boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT studio_records_script_template_version_fk FOREIGN KEY (location_id, script_template_version_id)
    REFERENCES studio.studio_script_template_versions(location_id, id),
  ADD CONSTRAINT studio_records_script_template_selection_check CHECK (
    (NOT script_template_selected AND script_template_version_id IS NULL) OR (script_template_selected AND kind = 'content')
  );

CREATE INDEX studio_records_script_template_version_idx
  ON studio.studio_records (location_id, script_template_version_id) WHERE script_template_version_id IS NOT NULL;

-- The same CRM Location role governs both editions, including Estio.
CREATE FUNCTION studio.studio_lock_script_template_actor(p_location_id text, p_actor_app text, p_clerk_user_id text, p_admin boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM studio.platform_require_active_profile(p_actor_app, p_clerk_user_id);
  PERFORM 1 FROM studio.studio_location_members m
  WHERE m.location_id = p_location_id AND m.location_app = p_actor_app AND m.clerk_user_id = p_clerk_user_id
    AND (NOT p_admin OR m.role IN ('owner', 'admin'))
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Script template access denied' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION studio.studio_propose_script_template(
  p_location_id text, p_actor_app text, p_clerk_user_id text, p_template_id uuid, p_id uuid,
  p_expected_version integer, p_name text, p_purpose text, p_beats jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE latest integer; prior studio.studio_script_template_versions%ROWTYPE;
BEGIN
  PERFORM studio.studio_lock_script_template_actor(p_location_id, p_actor_app, p_clerk_user_id, false);
  IF p_template_id IS NULL OR p_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
    OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120
    OR p_purpose IS NULL OR char_length(btrim(p_purpose)) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_beats) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid script template' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_beats) NOT BETWEEN 1 AND 12 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_beats) b WHERE
      jsonb_typeof(b->'name') IS DISTINCT FROM 'string' OR char_length(btrim(b->>'name')) NOT BETWEEN 1 AND 80 OR
      jsonb_typeof(b->'guidance') IS DISTINCT FROM 'string' OR char_length(btrim(b->>'guidance')) NOT BETWEEN 1 AND 500
  ) THEN
    RAISE EXCEPTION 'Invalid script template beats' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('script-template:' || p_location_id || ':' || p_template_id, 0));
  SELECT * INTO prior FROM studio.studio_script_template_versions
  WHERE location_id = p_location_id AND id = p_id;
  IF FOUND THEN
    IF (prior.template_id, prior.version, prior.created_by_clerk_user_id, prior.name, prior.purpose, prior.beats)
      IS DISTINCT FROM (p_template_id, p_expected_version + 1, p_clerk_user_id, btrim(p_name), btrim(p_purpose), p_beats) THEN
      RAISE EXCEPTION 'Script template request reused' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', prior.id);
  END IF;
  SELECT coalesce(max(version), 0) INTO latest FROM studio.studio_script_template_versions
  WHERE location_id = p_location_id AND template_id = p_template_id;
  IF latest <> p_expected_version THEN
    RAISE EXCEPTION 'Script template changed' USING ERRCODE = '40001';
  END IF;
  INSERT INTO studio.studio_script_template_versions
    (location_id, id, template_id, version, name, purpose, beats, created_by_clerk_user_id)
  VALUES (p_location_id, p_id, p_template_id, latest + 1, btrim(p_name), btrim(p_purpose), p_beats, p_clerk_user_id);
  RETURN jsonb_build_object('id', p_id);
END;
$$;

CREATE FUNCTION studio.studio_approve_script_template(
  p_location_id text, p_actor_app text, p_clerk_user_id text, p_template_id uuid, p_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE candidate studio.studio_script_template_versions%ROWTYPE;
BEGIN
  PERFORM studio.studio_lock_script_template_actor(p_location_id, p_actor_app, p_clerk_user_id, true);
  IF p_template_id IS NULL OR p_id IS NULL THEN
    RAISE EXCEPTION 'Invalid template approval' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('script-template:' || p_location_id || ':' || p_template_id, 0));
  SELECT * INTO candidate FROM studio.studio_script_template_versions
  WHERE location_id = p_location_id AND template_id = p_template_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR candidate.id <> p_id THEN
    RAISE EXCEPTION 'Review the latest template version' USING ERRCODE = '40001';
  END IF;
  UPDATE studio.studio_script_template_versions SET approved_at = clock_timestamp(), approved_by_clerk_user_id = p_clerk_user_id
  WHERE location_id = p_location_id AND id = candidate.id AND approved_at IS NULL;
END;
$$;

CREATE FUNCTION studio.studio_save_content_template_selection(
  p_location_id text, p_actor_app text, p_clerk_user_id text, p_record_id uuid, p_title text,
  p_payload_patch jsonb, p_expected_version bigint, p_template_version_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved jsonb; current_record studio.studio_records%ROWTYPE;
BEGIN
  PERFORM studio.studio_lock_script_template_actor(p_location_id, p_actor_app, p_clerk_user_id, false);
  SELECT * INTO current_record FROM studio.studio_records
  WHERE location_id = p_location_id AND id = p_record_id AND kind = 'content' FOR UPDATE;
  IF current_record.archived THEN
    RAISE EXCEPTION 'Restore content before changing its template' USING ERRCODE = '22023';
  END IF;
  IF p_template_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM studio.studio_script_template_versions t WHERE t.location_id = p_location_id
      AND t.id = p_template_version_id AND t.approved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Choose an approved script template from this Location' USING ERRCODE = '22023';
  END IF;
  saved := studio.studio_save_record(p_location_id, p_record_id, 'content', p_title, p_payload_patch, p_expected_version, p_clerk_user_id);
  IF p_expected_version = 0 AND coalesce((saved->>'script_template_selected')::boolean, false)
    AND (saved->>'script_template_version_id')::uuid IS DISTINCT FROM p_template_version_id THEN
    RAISE EXCEPTION 'Content creation request reused' USING ERRCODE = '23505';
  END IF;
  UPDATE studio.studio_records r SET script_template_selected = true, script_template_version_id = p_template_version_id
  WHERE r.location_id = p_location_id AND r.id = p_record_id RETURNING to_jsonb(r) INTO saved;
  RETURN saved;
END;
$$;

-- Future script generation reads this inside its version-fenced snapshot transaction.
CREATE FUNCTION studio.studio_script_template_snapshot(p_location_id text, p_record_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('templateId', t.template_id, 'versionId', t.id, 'version', t.version,
    'name', t.name, 'purpose', t.purpose, 'beats', t.beats)
  FROM studio.studio_records r
  JOIN studio.studio_script_template_versions t ON t.location_id = r.location_id AND t.id = r.script_template_version_id
  WHERE r.location_id = p_location_id AND r.id = p_record_id AND r.kind = 'content' AND t.approved_at IS NOT NULL
$$;

REVOKE ALL ON studio.studio_script_template_versions FROM PUBLIC;
REVOKE ALL ON FUNCTION studio.studio_lock_script_template_actor(text, text, text, boolean),
  studio.studio_propose_script_template(text, text, text, uuid, uuid, integer, text, text, jsonb),
  studio.studio_approve_script_template(text, text, text, uuid, uuid),
  studio.studio_save_content_template_selection(text, text, text, uuid, text, jsonb, bigint, uuid),
  studio.studio_script_template_snapshot(text, uuid) FROM PUBLIC;

COMMIT;
