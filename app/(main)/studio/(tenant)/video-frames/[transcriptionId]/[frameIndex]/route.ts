import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { studioVideoFrameRedirectResponse } from "@/lib/studio/media-download";

export const dynamic = "force-dynamic";
async function GETHandler(request: Request, { params }: { params: Promise<{ transcriptionId: string; frameIndex: string }> }) {
  const { locationId, transcriptionId, frameIndex } = await studioRouteParams(params, request);
  return studioVideoFrameRedirectResponse(locationId, transcriptionId, frameIndex);
}

export const GET = withStudioRoute(GETHandler);
