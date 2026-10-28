export type RecordLinkKind = "all" | "reference" | "channel" | "content";
export type RecordLinkAction = "add" | "remove";
export const recordLinkId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function recordLinkKind(value: string | string[] | undefined): RecordLinkKind {
  return value === "reference" || value === "channel" || value === "content" ? value : "all";
}
export function recordLinkPage(value: string | string[] | undefined): number {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,4})$/.test(value) ? Number(value) : 0;
}
export function validRecordLinkChange(source: string, target: string, version: number, action: string): action is RecordLinkAction {
  return recordLinkId(source) && recordLinkId(target) && source.toLowerCase() !== target.toLowerCase()
    && Number.isSafeInteger(version) && version > 0 && (action === "add" || action === "remove");
}
export function recordLinkCandidates(workspace: string, source: string, page: number, kind: RecordLinkKind): Record<string, string> {
  return { select: "id,kind,title,archived", location_id: `eq.${workspace}`, id: `neq.${source}`,
    ...(kind === "all" ? {} : { kind: `eq.${kind}` }), order: "title.asc,id.asc", limit: "21", offset: String(page * 20) };
}
