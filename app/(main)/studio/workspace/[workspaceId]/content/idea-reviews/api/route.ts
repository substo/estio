import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readIdeaReviewRequest } from "@/lib/studio/idea-review-policy";
import { enqueueStudioIdeaReview } from "@/lib/studio/idea-review";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readIdeaReviewRequest, execute: command => enqueueStudioIdeaReview(workspaceId, command) });
}
