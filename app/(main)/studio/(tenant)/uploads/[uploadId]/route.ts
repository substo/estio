import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { studioUploadRedirectResponse } from "@/lib/studio/media-download";

export const dynamic = "force-dynamic";
async function GETHandler(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  const { workspaceId, uploadId } = await studioRouteParams(params, request);
  return studioUploadRedirectResponse(workspaceId, uploadId, new URL(request.url).searchParams.get("inline") === "1");
}

export const GET = withStudioRoute(GETHandler);
