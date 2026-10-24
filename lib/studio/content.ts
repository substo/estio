import "server-only";
import { getStudioWorkspaceAccess } from "./access";
import { getStudioRecordRelations } from "./record-relations";
import { queryPath, studioRest, studioRestAll } from "./rest";
import { contentListQuery, type ContentDraft } from "./content-policy";

export interface StudioContentSummary {
  id: string; title: string; version: number; updated_at: string;
  summary: string | null; approved: boolean; archived: boolean;
  stage: string | null; level: string | null; pillar: number | null;
}
export interface StudioContentRecord {
  id: string; title: string; version: number; updated_at: string;
  approved: boolean; archived: boolean; payload: Record<string, unknown>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listStudioContent(workspaceId: string, showArchived = false) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) return null;
  const records = await studioRestAll<StudioContentSummary>("studio_records", contentListQuery(access.workspace.id, showArchived));
  return { access, records };
}

export async function getStudioContentRecord(workspaceId: string, recordId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || !uuid.test(recordId)) return null;
  const rows = await studioRest<StudioContentRecord[]>(queryPath("studio_records", {
    select: "id,title,version,updated_at,approved,archived,payload",
    workspace_id: `eq.${access.workspace.id}`, id: `eq.${recordId}`, kind: "eq.content", limit: "1",
  }));
  if (!rows[0]) return null;
  const { links, files, uploads } = await getStudioRecordRelations(access, recordId);
  return { access, record: rows[0], links, files, uploads };
}

export async function saveStudioContentRecord(workspaceId: string, recordId: string, draft: ContentDraft, version: number) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) throw new Error("Studio workspace access denied.");
  if (!uuid.test(recordId) || !Number.isSafeInteger(version) || version < 0) throw new Error("Invalid content record request.");
  return studioRest<StudioContentRecord>("rpc/studio_save_record", {
    method: "POST",
    body: JSON.stringify({ p_workspace_id: access.workspace.id, p_record_id: recordId, p_kind: "content",
      p_title: draft.title, p_payload_patch: draft.payload, p_expected_version: version, p_clerk_user_id: access.userId }),
  });
}
