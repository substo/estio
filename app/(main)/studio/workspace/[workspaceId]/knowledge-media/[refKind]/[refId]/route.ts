import { studioKnowledgeMediaRedirectResponse } from "@/lib/studio/media-download";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; refKind: string; refId: string }> }) {
  const { workspaceId, refKind, refId } = await params;
  return studioKnowledgeMediaRedirectResponse(workspaceId, refKind, refId);
}
