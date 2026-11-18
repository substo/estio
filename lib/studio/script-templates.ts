import "server-only";
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { SCRIPT_TEMPLATE_UUID, type ScriptTemplateDraft, type ScriptTemplateOption } from "./script-template-policy";
import { studioDb } from "./studio-db";

type TemplateVersion = ScriptTemplateOption & {
  approved_at: string | null;
};

type TemplateSummary = Omit<TemplateVersion, "beats"> & {
  template_id: string;
  approved_version: number | null;
};

export async function requireStudioTemplateWriter(locationId: string) {
  const [access, state] = await Promise.all([getStudioAccess(locationId), auth()]);
  if (!access || state.actor || state.userId !== access.userId) throw new StudioCommandError("Use your own Location account to make this change.", 403);
  return access;
}

export async function listStudioScriptTemplates(locationId: string) {
  const [access, state] = await Promise.all([getStudioAccess(locationId), auth()]);
  if (!access) return null;
  const templates = await studioDb.rows<TemplateSummary>(Prisma.sql`
    SELECT DISTINCT ON (template_id) template_id, id, name, purpose, version, approved_at,
      max(version) FILTER (WHERE approved_at IS NOT NULL) OVER (PARTITION BY template_id) AS approved_version
    FROM studio.studio_script_template_versions WHERE location_id = ${access.locationId}
    ORDER BY template_id, version DESC`);
  return { templates: templates.sort((a, b) => a.name.localeCompare(b.name)), canEdit: !state.actor };
}

export async function getStudioScriptTemplate(locationId: string, templateId: string) {
  const [access, state] = await Promise.all([getStudioAccess(locationId), auth()]);
  if (!access || !SCRIPT_TEMPLATE_UUID.test(templateId)) return null;
  const versions = await studioDb.rows<TemplateVersion>(Prisma.sql`
    SELECT id, version, name, purpose, beats, approved_at
    FROM studio.studio_script_template_versions
    WHERE location_id = ${access.locationId} AND template_id = ${templateId}::uuid
    ORDER BY version DESC`);
  if (!versions.length) return null;
  return { versions, canApprove: !state.actor && access.role === "ADMIN", canEdit: !state.actor };
}

export async function getStudioScriptTemplateChoices(locationId: string, pinnedId?: string | null) {
  const [access, state] = await Promise.all([getStudioAccess(locationId), auth()]);
  if (!access) return { options: [], canSelect: false };
  const options = await studioDb.rows<ScriptTemplateOption>(Prisma.sql`
    WITH current_versions AS (
      SELECT DISTINCT ON (template_id) id, version, name, purpose, beats
      FROM studio.studio_script_template_versions
      WHERE location_id = ${access.locationId} AND approved_at IS NOT NULL
      ORDER BY template_id, version DESC
    )
    SELECT * FROM current_versions
    UNION
    SELECT id, version, name, purpose, beats FROM studio.studio_script_template_versions
    WHERE location_id = ${access.locationId} AND id = ${pinnedId ?? null}::uuid AND approved_at IS NOT NULL
    ORDER BY name, version DESC`);
  return { options, canSelect: !state.actor };
}

export async function proposeStudioScriptTemplate(locationId: string, templateId: string, id: string, version: number, draft: ScriptTemplateDraft) {
  const access = await requireStudioTemplateWriter(locationId);
  return studioDb.call("studio_propose_script_template", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId,
    p_template_id: templateId, p_id: id, p_expected_version: version,
    p_name: draft.name, p_purpose: draft.purpose, p_beats: draft.beats,
  });
}

export async function approveStudioScriptTemplate(locationId: string, templateId: string, id: string) {
  const access = await requireStudioTemplateWriter(locationId);
  return studioDb.call("studio_approve_script_template", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId,
    p_template_id: templateId, p_id: id,
  });
}
