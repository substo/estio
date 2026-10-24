import "server-only";
import { getStudioWorkspaceAccess } from "./access";
import { getStudioRecordRelations } from "./record-relations";
import { queryPath, studioRest } from "./rest";
import type { LibraryDraft, LibraryKind } from "./library-policy";

export interface StudioLibrarySummary {
  id: string; kind: LibraryKind; title: string; version: number; updated_at: string;
  source_url: string | null; summary: string | null; approved: boolean; archived: boolean;
}
export interface StudioLibraryRecord extends StudioLibrarySummary { payload: Record<string, unknown>; }

export async function listStudioLibrary(workspaceId: string, page = 0) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) return null;
  const safePage = Number.isSafeInteger(page) && page >= 0 && page <= 100_000 ? page : 0;
  const rows = await studioRest<StudioLibrarySummary[]>(queryPath("studio_records", {
    select: "id,kind,title,version,updated_at,source_url,summary,approved,archived",
    workspace_id: `eq.${access.workspace.id}`, kind: "in.(reference,channel)",
    order: "updated_at.desc,id.asc", limit: "51", offset: String(safePage * 50),
  }));
  return { access, records: rows.slice(0, 50), hasNext: rows.length > 50, page: safePage };
}

export async function getStudioLibraryRecord(workspaceId: string, recordId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) return null;
  const rows = await studioRest<StudioLibraryRecord[]>(queryPath("studio_records", {
    select: "id,kind,title,version,updated_at,source_url,summary,approved,archived,payload",
    workspace_id: `eq.${access.workspace.id}`, id: `eq.${recordId}`, kind: "in.(reference,channel)", limit: "1",
  }));
  if (!rows[0]) return null;
  const { links, files, uploads } = await getStudioRecordRelations(access, recordId);
  return { access, record: rows[0], links, files, uploads };
}

export async function saveStudioLibraryRecord(workspaceId: string, recordId: string, draft: LibraryDraft, version: number) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) throw new Error("Studio workspace access denied.");
  if (!Number.isSafeInteger(version) || version < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) {
    throw new Error("Invalid Studio record request.");
  }
  return studioRest<StudioLibraryRecord>("rpc/studio_save_record", {
    method: "POST",
    body: JSON.stringify({ p_workspace_id: access.workspace.id, p_record_id: recordId,
      p_kind: draft.kind, p_title: draft.title, p_payload_patch: draft.payload,
      p_expected_version: version, p_clerk_user_id: access.userId }),
  });
}
