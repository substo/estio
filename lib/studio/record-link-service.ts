import { queryPath } from "./rest-client";
import { recordLinkCandidates, recordLinkId, validRecordLinkChange, type RecordLinkKind } from "./record-link-policy";
export interface RecordLinkSummary { id: string; title: string; kind: "reference" | "channel" | "content"; archived: boolean; }
export interface RecordLinkChange { sourceId: string; targetId: string; version: number; changed: boolean; }

export function createRecordLinkService<Access extends { workspace: { id: string }; brand: "estio" | "substo"; userId: string }>(dependencies: {
  authorize: (workspace: string) => Promise<Access | null>;
  isImpersonating: () => Promise<boolean>;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const { authorize, isImpersonating, request } = dependencies;
  return {
    async list(workspaceId: string, sourceId: string, pages: { links: number; candidates: number }, kind: RecordLinkKind) {
      if (!recordLinkId(sourceId) || !Object.values(pages).every(p => Number.isSafeInteger(p) && p >= 0 && p <= 99_999)) return null;
      const access = await authorize(workspaceId);
      if (!access) return null;
      const workspace = access.workspace.id;
      const records = await request<Array<RecordLinkSummary & { version: number }>>(queryPath("studio_records", {
        select: "id,title,kind,archived,version", workspace_id: `eq.${workspace}`, id: `eq.${sourceId}`, limit: "1",
      }));
      if (!records[0]) return null;
      const [links, candidates] = await Promise.all([
        request<Array<{ target_id: string }>>(queryPath("studio_record_links", { select: "target_id", workspace_id: `eq.${workspace}`,
          source_id: `eq.${sourceId}`, order: "target_id.asc", limit: "21", offset: String(pages.links * 20) })),
        request<RecordLinkSummary[]>(queryPath("studio_records", recordLinkCandidates(workspace, sourceId, pages.candidates, kind))),
      ]);
      const visibleLinks = links.slice(0, 20); const visibleCandidates = candidates.slice(0, 20);
      const [labels, candidateLinks] = await Promise.all([
        visibleLinks.length ? request<RecordLinkSummary[]>(queryPath("studio_records", { select: "id,title,kind,archived", workspace_id: `eq.${workspace}`,
          id: `in.(${visibleLinks.map(l => l.target_id).join(",")})`, limit: "20" })) : Promise.resolve([]),
        visibleCandidates.length ? request<Array<{ target_id: string }>>(queryPath("studio_record_links", { select: "target_id", workspace_id: `eq.${workspace}`,
          source_id: `eq.${sourceId}`, target_id: `in.(${visibleCandidates.map(c => c.id).join(",")})`, limit: "20" })) : Promise.resolve([]),
      ]);
      const labelsById = new Map(labels.map(label => [label.id, label]));
      const linkedCandidates = new Set(candidateLinks.map(link => link.target_id));
      const currentLinks = visibleLinks.map(link => {
        const label = labelsById.get(link.target_id);
        if (!label) throw new Error("Studio returned incomplete link labels. Reload the record.");
        return label;
      });
      return { access, record: records[0], links: currentLinks,
        candidates: visibleCandidates.map(c => ({ ...c, linked: linkedCandidates.has(c.id) })), hasMoreLinks: links.length > 20, hasMoreCandidates: candidates.length > 20 };
    },
    async change(workspaceId: string, sourceId: string, targetId: string, version: number, action: string) {
      const access = await authorize(workspaceId);
      if (!access || await isImpersonating()) throw new Error("Use your own authorized workspace account to change links.");
      if (!validRecordLinkChange(sourceId, targetId, version, action)) throw new Error("Invalid record link request.");
      const result = await request<RecordLinkChange>("rpc/studio_change_record_link", { method: "POST", body: JSON.stringify({
        p_workspace_id: access.workspace.id, p_source_id: sourceId, p_target_id: targetId, p_action: action,
        p_expected_version: version, p_actor_brand: access.brand, p_clerk_user_id: access.userId,
      }) });
      if (!result || result.sourceId !== sourceId.toLowerCase() || result.targetId !== targetId.toLowerCase()
        || typeof result.changed !== "boolean" || !Number.isSafeInteger(result.version)
        || result.version !== version + (result.changed ? 1 : 0)) throw new Error("Studio did not confirm the link change. Reload before retrying.");
      return result;
    },
  };
}
