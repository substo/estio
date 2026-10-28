import type { ScheduleImportSnapshot } from "./schedule-history-reader";

export function scheduleImportDownloadResponse(result: {
  access: { locationId: string }; imported: ScheduleImportSnapshot;
} | null): Response {
  if (!result) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return new Response(JSON.stringify({ locationId: result.access.locationId, ...result.imported }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="studio-schedule-import-${result.imported.id}.json"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    },
  });
}
