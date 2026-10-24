import { scheduleImportDownloadResponse } from "@/lib/studio/schedule-import-download";
import { getStudioScheduleImportSnapshot } from "@/lib/studio/schedule-history";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; importId: string }> }) {
  const { workspaceId, importId } = await params;
  const result = await getStudioScheduleImportSnapshot(workspaceId, importId);
  return scheduleImportDownloadResponse(result);
}
