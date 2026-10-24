import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readUploadCommand } from "@/lib/studio/upload-recovery";
import { executeStudioUploadCommand } from "@/lib/studio/uploads";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readUploadCommand,
    execute: command => executeStudioUploadCommand(workspaceId, command) });
}
