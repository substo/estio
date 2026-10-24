import {getPlatformProfile} from "@/lib/platform/profile";
import {studioCommandResponse} from "@/lib/studio/command-http";
import {readKnowledgeExtractionCommand} from "@/lib/studio/knowledge-extraction-policy";
import {executeKnowledgeExtraction} from "@/lib/studio/knowledge-extraction";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await params;
 return studioCommandResponse(request,{profile:getPlatformProfile,parse:readKnowledgeExtractionCommand,execute:command=>executeKnowledgeExtraction(workspaceId,command)});
}
