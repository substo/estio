import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { studioKnowledgeMediaRedirectResponse } from "@/lib/studio/media-download";

export const dynamic = "force-dynamic";
async function GETHandler(_request: Request, { params }: { params: Promise<{ refKind: string; refId: string }> }) {
  const { workspaceId, refKind, refId } = await studioRouteParams(params, _request);
  return studioKnowledgeMediaRedirectResponse(workspaceId, refKind, refId);
}

export const GET = withStudioRoute(GETHandler);
