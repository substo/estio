import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getPlatformProfile } from "@/lib/platform/profile";
import { reviewStudioTranscription } from "@/lib/studio/transcription-reconciliation";
import { transcriptionReviewResponse } from "@/lib/studio/transcription-reconciliation-http";
export const dynamic = "force-dynamic";
async function POSTHandler(request: Request, { params }: { params: Promise<{  }> }) {
  const { workspaceId } = await studioRouteParams(params, request);
  return transcriptionReviewResponse(request, { profile: getPlatformProfile, execute: command => reviewStudioTranscription(workspaceId, command) });
}

export const POST = withStudioRoute(POSTHandler);
