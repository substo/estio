import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { findStudioKnowledgeTopics } from "@/lib/studio/knowledge-commands";
import { StudioCommandError } from "@/lib/studio/command-error";
export const dynamic = "force-dynamic";
async function GETHandler(request: Request, { params }: { params: Promise<{  }> }) {
 const { workspaceId } = await studioRouteParams(params, request); const queries = new URL(request.url).searchParams.getAll("q");
 try {
  if (queries.length > 1) throw new StudioCommandError("Use one topic query.");
  return Response.json(await findStudioKnowledgeTopics(workspaceId, queries[0] ?? ""), { headers: { "Cache-Control": "private, no-store" } });
 } catch (error) {
  return Response.json({ error: error instanceof StudioCommandError ? error.message : "Topics could not be loaded." },
   { status: error instanceof StudioCommandError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
 }
}

export const GET = withStudioRoute(GETHandler);
