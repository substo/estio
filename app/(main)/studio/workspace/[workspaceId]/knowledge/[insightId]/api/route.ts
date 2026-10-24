import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { readKnowledgeCommand } from "@/lib/studio/knowledge-command-policy";
import { executeStudioKnowledgeCommand } from "@/lib/studio/knowledge-commands";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; insightId: string }> }) {
 const { workspaceId, insightId } = await params;
 return studioCommandResponse(request, { profile: getPlatformProfile, parse: readKnowledgeCommand,
  execute: command => executeStudioKnowledgeCommand(workspaceId, insightId, command) });
}
