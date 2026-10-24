import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readScheduleCommand } from "@/lib/studio/schedule-execution-policy";
import { executeStudioScheduleCommand } from "@/lib/studio/schedule-executions";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readScheduleCommand,
    execute: command => executeStudioScheduleCommand(workspaceId, command) });
}
