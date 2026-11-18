import "server-only";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { createStudioDb } from "./db";
import { createSourceIdeaService } from "./source-idea-service";
import { getStudioAccess } from "./access";
import { getStudioRecordRelations } from "./record-relations";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import { contentListQuery, type ContentDraft } from "./content-policy";
import { requireStudioTemplateWriter } from "./script-templates";

export interface StudioContentSummary {
  id: string; title: string; version: number; updated_at: string;
  summary: string | null; approved: boolean; archived: boolean;
  stage: string | null; level: string | null; pillar: number | null;
}
export interface StudioContentRecord {
  id: string; title: string; version: number; updated_at: string;
  approved: boolean; archived: boolean; payload: Record<string, unknown>;
  script_template_version_id: string | null; script_template_selected: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listStudioContent(locationId: string, showArchived = false) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const records = await studioDb.rows<StudioContentSummary>(contentListQuery(access.locationId, showArchived));
  return { access, records };
}

export async function getStudioContentRecord(locationId: string, recordId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || !uuid.test(recordId)) return null;
  const record = await studioDb.one<StudioContentRecord>(Prisma.sql`
    select id, title, version, updated_at, approved, archived, payload, script_template_version_id, script_template_selected from studio.studio_records
    where location_id = ${access.locationId} and id = ${recordId}::uuid and kind = 'content'`);
  if (!record) return null;
  const { links, files, uploads } = await getStudioRecordRelations(access, recordId);
  return { access, record, links, files, uploads };
}

export async function saveStudioContentRecord(locationId: string, recordId: string, draft: ContentDraft, version: number, templateVersionId?: string | null) {
  const access = await getStudioAccess(locationId);
  if (!access) throw new Error("Studio access denied.");
  if (!uuid.test(recordId) || !Number.isSafeInteger(version) || version < 0) throw new Error("Invalid content record request.");
  if (templateVersionId !== undefined) {
    const writer = await requireStudioTemplateWriter(locationId);
    return studioDb.call<StudioContentRecord>("studio_save_content_template_selection", {
      p_location_id: writer.locationId, p_actor_app: writer.app, p_clerk_user_id: writer.userId,
      p_record_id: recordId, p_title: draft.title, p_payload_patch: draft.payload,
      p_expected_version: version, p_template_version_id: templateVersionId,
    });
  }
  return studioDb.call<StudioContentRecord>("studio_save_record", { p_location_id: access.locationId, p_record_id: recordId, p_kind: "content",
    p_title: draft.title, p_payload_patch: draft.payload, p_expected_version: version, p_clerk_user_id: access.userId });
}

/** New source-backed ideas save and link together; failures roll back both writes. */
export async function createStudioSourceIdea(locationId: string, sourceId: string, ideaId: string, title: string, summary: string) {
  const service = createSourceIdeaService({
    authorize: getStudioAccess,
    isImpersonating: async () => Boolean((await auth()).actor),
    transaction: run => db.$transaction(tx => run(createStudioDb(tx))),
  });
  return service(locationId, sourceId, ideaId, title, summary);
}
