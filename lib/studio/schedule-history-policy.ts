export function scheduleHistoryId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function scheduleHistoryPage(value: string | string[] | undefined): number {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,4})$/.test(value) ? Number(value) : 0;
}
export function scheduleHistoryQuery(workspaceId: string, scheduleId: string, importId: string, page: number): Record<string, string> {
  return {
    select: "id,schedule_id,import_run_id,source_index,preset_id:payload->>presetId,status:payload->>status,started_at:payload->>startedAt,completed_at:payload->>completedAt",
    workspace_id: `eq.${workspaceId}`, schedule_id: `eq.${scheduleId}`, import_run_id: `eq.${importId}`,
    order: "source_index.asc,id.asc", limit: "21", offset: String(page * 20),
  };
}
export function historicalRunStatus(status: string | null): string {
  return status === "running" || status === "queued"
    ? `${status} in the local snapshot · not resumed` : `${status || "unknown"} in the local snapshot`;
}
