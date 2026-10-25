import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readScheduleCommand } from "@/lib/studio/schedule-execution-policy";
import { executeStudioScheduleCommand } from "@/lib/studio/schedule-executions";
export const dynamic = "force-dynamic";
async function POSTHandler(request: Request, { params }: { params: Promise<{  }> }) {
  const { workspaceId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readScheduleCommand,
    execute: command => executeStudioScheduleCommand(workspaceId, command) });
}

export const POST = withStudioRoute(POSTHandler);
