import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readUploadCommand } from "@/lib/studio/upload-recovery";
import { executeStudioUploadCommand } from "@/lib/studio/uploads";
export const dynamic = "force-dynamic";
async function POSTHandler(request: Request, { params }: { params: Promise<{  }> }) {
  const { workspaceId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readUploadCommand,
    execute: command => executeStudioUploadCommand(workspaceId, command) });
}

export const POST = withStudioRoute(POSTHandler);
