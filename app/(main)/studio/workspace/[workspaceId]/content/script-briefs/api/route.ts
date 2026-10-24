import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readScriptBriefCommand } from "@/lib/studio/script-brief-policy";
import { enqueueStudioScriptBrief, applyStudioScriptBrief } from "@/lib/studio/script-brief";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readScriptBriefCommand,
    execute: command => command.action === "enqueue" ? enqueueStudioScriptBrief(workspaceId, command) : applyStudioScriptBrief(workspaceId, command) });
}
