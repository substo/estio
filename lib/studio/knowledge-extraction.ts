import "server-only";
import { getStudioAccess } from "./access";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import { StudioDbError } from "./db";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import type { StudioTextRun } from "./idea-review";
import type { ExtractionMode,KnowledgeExtractionResult,KnowledgeExtractionSnapshot,readKnowledgeExtractionCommand } from "./knowledge-extraction-policy";
export interface ExtractionInputs {source:{id:string;version:number;title:string};inputs:Array<{mode:ExtractionMode;inputId:string;label:string;totalUnits:number}>}
export interface ExtractionState {stale:boolean;findings:Array<{findingIndex:number;insightId:string;reused:boolean;status:string}>}
export async function getKnowledgeExtractionInputs(locationId:string,sourceId:string){
 const access=await getStudioAccess(locationId);if(!access||! /^[0-9a-f-]{36}$/i.test(sourceId))return null;
 try {
 const inputs=await studioDb.call<ExtractionInputs>("studio_knowledge_extraction_inputs",{p_location_id:access.locationId,p_actor_app:access.app,p_clerk_user_id:access.userId,p_source_id:sourceId});
 return inputs;
 } catch(error) { if(error instanceof StudioDbError && ["22023","42501"].includes(error.code??""))return null;throw error; }
}
export async function executeKnowledgeExtraction(locationId:string,command:ReturnType<typeof readKnowledgeExtractionCommand>){
 const access=await requireOwnStudioCommandLocation(locationId);
 const authority={p_location_id:access.locationId,p_actor_app:access.app,p_clerk_user_id:access.userId,p_request_id:command.requestId,p_expected_version:command.expectedVersion};
 if(command.action==="enqueue")return studioDb.call("studio_enqueue_knowledge_extraction",{...authority,p_source_id:command.sourceId,p_mode:command.mode,p_input_id:command.inputId,p_start_unit:command.startUnit,p_unit_count:command.unitCount,p_focus:command.focus,p_confirm_paid:command.confirmPaid});
 return studioDb.call("studio_apply_knowledge_extraction",{...authority,p_review_id:command.reviewId,p_finding_indexes:command.findingIndexes,p_confirm_pending:command.confirmPending});
}
export async function getKnowledgeExtraction(locationId:string,reviewId:string){
 const access=await getStudioAccess(locationId);if(!access||! /^[0-9a-f-]{36}$/i.test(reviewId))return null;
 const review=await studioDb.one<StudioTextRun<KnowledgeExtractionResult,KnowledgeExtractionSnapshot>>(Prisma.sql`
  select id,job_id,model,prompt_version,snapshot,result,created_at,completed_at,stale_at_completion
  from studio.studio_idea_reviews where location_id=${access.locationId} and id=${reviewId}::uuid and workflow='knowledge_extract'`);
 if(!review)return null;
 const [state,jobs]=await Promise.all([
  studioDb.call<ExtractionState>("studio_knowledge_extraction_state",{p_location_id:access.locationId,p_actor_app:access.app,p_clerk_user_id:access.userId,p_review_id:reviewId}),
  studioDb.rows<{status:string;last_error_message:string|null}>(Prisma.sql`
   select status,last_error_message from studio.studio_jobs where location_id=${access.locationId} and id=${review.job_id}::uuid limit 1`),
 ]);
 return {review,state,job:jobs[0]};
}
