import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import {getPlatformProfile} from "@/lib/platform/profile";
import {studioCommandResponse} from "@/lib/studio/command-http";
import {readKnowledgeExtractionCommand} from "@/lib/studio/knowledge-extraction-policy";
import {executeKnowledgeExtraction} from "@/lib/studio/knowledge-extraction";
export const dynamic="force-dynamic";
async function POSTHandler(request:Request,{params}:{params: Promise<{  }>}){
 const {workspaceId}=await studioRouteParams(params, request);
 return studioCommandResponse(request,{profile:getPlatformProfile,parse:readKnowledgeExtractionCommand,execute:command=>executeKnowledgeExtraction(workspaceId,command)});
}

export const POST = withStudioRoute(POSTHandler);
