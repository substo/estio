import { studioMediaRedirectResponse } from "@/lib/studio/media-download";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; fileId: string }> }) {
  const { workspaceId, fileId } = await params;
  return studioMediaRedirectResponse(workspaceId, fileId, new URL(request.url).searchParams.get("inline") === "1");
}
