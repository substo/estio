import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { studioUploadRedirectResponse } from "@/lib/studio/media-download";

export const dynamic = "force-dynamic";
async function GETHandler(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  const { locationId, uploadId } = await studioRouteParams(params, request);
  return studioUploadRedirectResponse(locationId, uploadId, new URL(request.url).searchParams.get("inline") === "1");
}

export const GET = withStudioRoute(GETHandler);
