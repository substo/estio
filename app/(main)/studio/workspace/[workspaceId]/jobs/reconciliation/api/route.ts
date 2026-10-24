import { getPlatformProfile } from "@/lib/platform/profile";
import { reviewStudioTranscription } from "@/lib/studio/transcription-reconciliation";
import { transcriptionReviewResponse } from "@/lib/studio/transcription-reconciliation-http";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return transcriptionReviewResponse(request, { profile: getPlatformProfile, execute: command => reviewStudioTranscription(workspaceId, command) });
}
