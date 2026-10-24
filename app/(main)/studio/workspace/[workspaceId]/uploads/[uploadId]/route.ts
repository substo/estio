import { studioUploadRedirectResponse } from "@/lib/studio/media-download";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; uploadId: string }> }) {
  const { workspaceId, uploadId } = await params;
  return studioUploadRedirectResponse(workspaceId, uploadId, new URL(request.url).searchParams.get("inline") === "1");
}
