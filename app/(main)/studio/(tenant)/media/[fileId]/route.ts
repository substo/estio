import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { studioMediaRedirectResponse } from "@/lib/studio/media-download";

export const dynamic = "force-dynamic";
async function GETHandler(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { locationId, fileId } = await studioRouteParams(params, request);
  return studioMediaRedirectResponse(locationId, fileId, new URL(request.url).searchParams.get("inline") === "1");
}

export const GET = withStudioRoute(GETHandler);
