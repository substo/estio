import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import {getPlatformProfile} from "@/lib/platform/profile";
import {studioCommandResponse} from "@/lib/studio/command-http";
import {executeKnowledgeExtraction, readStudioKnowledgeCommand} from "@/lib/studio/knowledge-extraction";
export const dynamic="force-dynamic";
async function POSTHandler(request:Request,{params}:{params: Promise<{  }>}){
 const {locationId}=await studioRouteParams(params, request);
 return studioCommandResponse(request,{profile:getPlatformProfile,parse:readStudioKnowledgeCommand,execute:command=>executeKnowledgeExtraction(locationId,command)});
}

export const POST = withStudioRoute(POSTHandler);
