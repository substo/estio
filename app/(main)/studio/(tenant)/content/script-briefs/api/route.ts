import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readScriptBriefCommand } from "@/lib/studio/script-brief-policy";
import { enqueueStudioScriptBrief, applyStudioScriptBrief } from "@/lib/studio/script-brief";
export const dynamic = "force-dynamic";
async function POSTHandler(request: Request, { params }: { params: Promise<{  }> }) {
  const { workspaceId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readScriptBriefCommand,
    execute: command => command.action === "enqueue" ? enqueueStudioScriptBrief(workspaceId, command) : applyStudioScriptBrief(workspaceId, command) });
}

export const POST = withStudioRoute(POSTHandler);
