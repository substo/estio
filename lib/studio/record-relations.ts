import "server-only";
import type { StudioWorkspaceAccess } from "./access";
import { studioRestAll } from "./rest";
import { listStudioRecordUploads } from "./uploads";

/** Call only after resolving the record within this authorized workspace. */
export async function getStudioRecordRelations(access: StudioWorkspaceAccess, recordId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) throw new Error("Invalid Studio record identifier.");
  const workspaceId = access.workspace.id;
  const linkRows = await studioRestAll<{ target_id: string }>("studio_record_links", {
    select: "target_id", workspace_id: `eq.${workspaceId}`, source_id: `eq.${recordId}`, order: "target_id.asc",
  });
  const links: Array<{ id: string; title: string; kind: string }> = [];
  for (let index = 0; index < linkRows.length; index += 100) {
    links.push(...await studioRestAll<{ id: string; title: string; kind: string }>("studio_records", {
      select: "id,title,kind", workspace_id: `eq.${workspaceId}`,
      id: `in.(${linkRows.slice(index, index + 100).map((link) => link.target_id).join(",")})`, order: "id.asc",
    }));
  }
  const files = await studioRestAll<{ id: string; payload: Record<string, unknown>; media_object_id: string | null }>("studio_legacy_files", {
    select: "id,payload,media_object_id", workspace_id: `eq.${workspaceId}`, record_id: `eq.${recordId}`, order: "id.asc",
  });
  const uploads = await listStudioRecordUploads(workspaceId, recordId);
  return { links, files, uploads };
}
