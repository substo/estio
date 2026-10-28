import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readIdeaReviewRequest } from "@/lib/studio/idea-review-policy";
import { enqueueStudioIdeaReview } from "@/lib/studio/idea-review";
export const dynamic = "force-dynamic";
async function POSTHandler(request: Request, { params }: { params: Promise<{  }> }) {
  const { locationId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readIdeaReviewRequest, execute: command => enqueueStudioIdeaReview(locationId, command) });
}

export const POST = withStudioRoute(POSTHandler);
