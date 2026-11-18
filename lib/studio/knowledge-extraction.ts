import "server-only";
import { getStudioAccess } from "./access";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import { StudioDbError } from "./db";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import type { StudioTextRun } from "./idea-review";
import { StudioCommandError } from "./command-error";
import { readKnowledgeExtractionCommand, type ExtractionMode, type KnowledgeExtractionResult,
  type KnowledgeExtractionSnapshot } from "./knowledge-extraction-policy";
import { readKnowledgeOutlineCommand, type KnowledgeOutline } from "./knowledge-outline";

const reviewUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export interface ExtractionInputs {source:{id:string;version:number;title:string};inputs:Array<{mode:ExtractionMode;inputId:string;label:string;totalUnits:number}>}
export interface ExtractionState {stale:boolean;findings:Array<{findingIndex:number;insightId:string;reused:boolean;status:string}>}
export async function getKnowledgeExtractionInputs(locationId:string,sourceId:string){
 const access=await getStudioAccess(locationId);if(!access||!reviewUuid.test(sourceId))return null;
 try {
 const inputs=await studioDb.call<ExtractionInputs>("studio_knowledge_extraction_inputs",{p_location_id:access.locationId,p_actor_app:access.app,p_clerk_user_id:access.userId,p_source_id:sourceId});
 return inputs;
 } catch(error) { if(error instanceof StudioDbError && ["22023","42501"].includes(error.code??""))return null;throw error; }
}
export function readStudioKnowledgeCommand(value: unknown) {
  if (value && typeof value === "object" && "action" in value && ["enqueueOutline", "annotate", "approve"].includes(String(value.action))) {
    return readKnowledgeOutlineCommand(value as Record<string, unknown>);
  }
  return readKnowledgeExtractionCommand(value);
}

export async function executeKnowledgeExtraction(locationId:string,command:ReturnType<typeof readStudioKnowledgeCommand>){
 const access=await requireOwnStudioCommandLocation(locationId);
 if (command.action === "enqueueOutline" || command.action === "annotate" || command.action === "approve") {
   const rpc = command.action === "enqueueOutline" ? "studio_enqueue_knowledge_outline" : "studio_change_knowledge_outline";
   try {
     return await studioDb.call(rpc, { p_location: access.locationId, p_app: access.app, p_actor: access.userId, p_command: command });
   } catch (error) {
     if (error instanceof StudioDbError) {
       if (error.code === "P2010") throw new StudioCommandError("This evidence exceeds the full extraction limit. Save it as shorter sources and try again.");
       if (error.code === "P2011") throw new StudioCommandError("Your updated paired Mac must be online with Text work, subscription sign-in and capacity.");
       if (error.code === "P2012") throw new StudioCommandError("Extraction is already processing for this source, or the Location queue is full.", 409);
     }
     throw error;
   }
 }
 const authority={p_location_id:access.locationId,p_actor_app:access.app,p_clerk_user_id:access.userId,p_request_id:command.requestId,p_expected_version:command.expectedVersion};
 if(command.action==="enqueue")return studioDb.call("studio_enqueue_routed_text_run",{p_location_id:access.locationId,p_actor_app:access.app,p_clerk_user_id:access.userId,p_workflow:"knowledge_extract",p_command:command});
 return studioDb.call("studio_apply_knowledge_extraction",{...authority,p_review_id:command.reviewId,p_finding_indexes:command.findingIndexes,p_confirm_pending:command.confirmPending});
}
export async function getKnowledgeExtraction(locationId:string,reviewId:string){
 const access=await getStudioAccess(locationId);if(!access||!reviewUuid.test(reviewId))return null;
 const review=await studioDb.one<StudioTextRun<KnowledgeExtractionResult,KnowledgeExtractionSnapshot>>(Prisma.sql`
  select id,job_id,model,prompt_version,snapshot,result,created_at,completed_at,stale_at_completion
  from studio.studio_idea_reviews where location_id=${access.locationId} and id=${reviewId}::uuid and workflow='knowledge_extract' and snapshot->>'mode' is distinct from 'script_template'`);
 if(!review)return null;
 const [state,jobs]=await Promise.all([
  studioDb.call<ExtractionState>("studio_knowledge_extraction_state",{p_location_id:access.locationId,p_actor_app:access.app,p_clerk_user_id:access.userId,p_review_id:reviewId}),
  studioDb.rows<{status:string;last_error_message:string|null}>(Prisma.sql`
   select status,last_error_message from studio.studio_jobs where location_id=${access.locationId} and id=${review.job_id}::uuid limit 1`),
 ]);
 return {review,state,job:jobs[0]};
}

export async function getKnowledgeOutline(locationId: string, outlineId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || !reviewUuid.test(outlineId)) return null;
  return studioDb.call<KnowledgeOutline | null>("studio_get_knowledge_outline", {
    p_location: access.locationId, p_app: access.app, p_actor: access.userId, p_outline: outlineId,
  });
}

export async function getLatestKnowledgeOutline(locationId: string, sourceId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  return studioDb.one<{ id: string }>(Prisma.sql`
    select id from studio.studio_knowledge_outlines
    where location_id=${access.locationId} and actor_app=${access.app} and source_id=${sourceId}::uuid
    order by created_at desc,id limit 1`);
}

export async function listKnowledgeExtractions(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  return studioDb.rows<{ id: string; title: string; created_at: string; outline: boolean }>(Prisma.sql`
    select * from (
      select o.id, r.title, o.created_at, true as outline
      from studio.studio_knowledge_outlines o
      left join studio.studio_records r on r.location_id=o.location_id and r.id=o.source_id
      where o.location_id=${access.locationId} and o.actor_app=${access.app}
      union all
      select id, snapshot#>>'{source,title}' as title, created_at, false as outline
      from studio.studio_idea_reviews where location_id=${access.locationId} and workflow='knowledge_extract'
        and snapshot->>'mode' is distinct from 'outline' and snapshot->>'mode' is distinct from 'script_template'
    ) history order by created_at desc,id limit 30`);
}
