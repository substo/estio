import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { scheduleImportDownloadResponse } from "@/lib/studio/schedule-import-download";
import { getStudioScheduleImportSnapshot } from "@/lib/studio/schedule-history";

export const dynamic = "force-dynamic";
async function GETHandler(_request: Request, { params }: { params: Promise<{ importId: string }> }) {
  const { locationId, importId } = await studioRouteParams(params, _request);
  const result = await getStudioScheduleImportSnapshot(locationId, importId);
  return scheduleImportDownloadResponse(result);
}

export const GET = withStudioRoute(GETHandler);
