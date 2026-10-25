import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readKnowledgeCommand } from "@/lib/studio/knowledge-command-policy";
import { executeStudioKnowledgeCommand } from "@/lib/studio/knowledge-commands";
export const dynamic = "force-dynamic";
async function POSTHandler(request: Request, { params }: { params: Promise<{ insightId: string }> }) {
 const { workspaceId, insightId } = await studioRouteParams(params, request);
 return studioCommandResponse(request, { profile: getPlatformProfile, parse: readKnowledgeCommand,
  execute: command => executeStudioKnowledgeCommand(workspaceId, insightId, command) });
}

export const POST = withStudioRoute(POSTHandler);
