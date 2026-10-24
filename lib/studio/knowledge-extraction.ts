import "server-only";
import { getStudioWorkspaceAccess } from "./access";
import { requireOwnStudioCommandWorkspace } from "./paid-workspace";
import { StudioRestError } from "./rest-client";
import { queryPath,studioRest } from "./rest";
import type { StudioTextRun } from "./idea-review";
import type { ExtractionMode,KnowledgeExtractionResult,KnowledgeExtractionSnapshot,readKnowledgeExtractionCommand } from "./knowledge-extraction-policy";
export interface ExtractionInputs {source:{id:string;version:number;title:string};inputs:Array<{mode:ExtractionMode;inputId:string;label:string;totalUnits:number}>}
export interface ExtractionState {stale:boolean;findings:Array<{findingIndex:number;insightId:string;reused:boolean;status:string}>}
export async function getKnowledgeExtractionInputs(workspaceId:string,sourceId:string){
 const access=await getStudioWorkspaceAccess(workspaceId);if(!access||! /^[0-9a-f-]{36}$/i.test(sourceId))return null;
 try {
 const inputs=await studioRest<ExtractionInputs>("rpc/studio_knowledge_extraction_inputs",{method:"POST",body:JSON.stringify({p_workspace_id:access.workspace.id,p_actor_brand:access.brand,p_clerk_user_id:access.userId,p_source_id:sourceId})});
 return inputs;
 } catch(error) { if(error instanceof StudioRestError && ["22023","42501"].includes(error.code??""))return null;throw error; }
}
export async function executeKnowledgeExtraction(workspaceId:string,command:ReturnType<typeof readKnowledgeExtractionCommand>){
 const access=await requireOwnStudioCommandWorkspace(workspaceId);
 const authority={p_workspace_id:access.workspace.id,p_actor_brand:access.brand,p_clerk_user_id:access.userId,p_request_id:command.requestId,p_expected_version:command.expectedVersion};
 if(command.action==="enqueue")return studioRest("rpc/studio_enqueue_knowledge_extraction",{method:"POST",body:JSON.stringify({...authority,p_source_id:command.sourceId,p_mode:command.mode,p_input_id:command.inputId,p_start_unit:command.startUnit,p_unit_count:command.unitCount,p_focus:command.focus,p_confirm_paid:command.confirmPaid})});
 return studioRest("rpc/studio_apply_knowledge_extraction",{method:"POST",body:JSON.stringify({...authority,p_review_id:command.reviewId,p_finding_indexes:command.findingIndexes,p_confirm_pending:command.confirmPending})});
}
export async function getKnowledgeExtraction(workspaceId:string,reviewId:string){
 const access=await getStudioWorkspaceAccess(workspaceId);if(!access||! /^[0-9a-f-]{36}$/i.test(reviewId))return null;
 const [review]=await studioRest<StudioTextRun<KnowledgeExtractionResult,KnowledgeExtractionSnapshot>[]>(queryPath("studio_idea_reviews",{select:"id,job_id,model,prompt_version,snapshot,result,created_at,completed_at,stale_at_completion",workspace_id:`eq.${access.workspace.id}`,id:`eq.${reviewId}`,workflow:"eq.knowledge_extract",limit:"1"}));
 if(!review)return null;
 const [state,jobs]=await Promise.all([
  studioRest<ExtractionState>("rpc/studio_knowledge_extraction_state",{method:"POST",body:JSON.stringify({p_workspace_id:access.workspace.id,p_actor_brand:access.brand,p_clerk_user_id:access.userId,p_review_id:reviewId})}),
  studioRest<Array<{status:string;last_error_message:string|null}>>(queryPath("studio_jobs",{select:"status,last_error_message",workspace_id:`eq.${access.workspace.id}`,id:`eq.${review.job_id}`,limit:"1"})),
 ]);
 return {review,state,job:jobs[0]};
}
