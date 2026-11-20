import { KNOWLEDGE_CURATED_PROMPT, knowledgeCuratedBatchInstructions, knowledgeCuratedBatchSchema, readKnowledgeCuratedBatchResult } from "../knowledge-extraction-policy";
import { IDEA_REVIEW_MODEL } from "../idea-review-policy";
import { KNOWLEDGE_EXTRACTION_PROMPT,knowledgeExtractionInstructions,knowledgeExtractionSchema,readKnowledgeExtractionResult,KNOWLEDGE_OUTLINE_PROMPT,knowledgeOutlineBatchInstructions,knowledgeOutlineBatchSchema,readKnowledgeOutlineBatchResult,type KnowledgeExtractionResult,type KnowledgeExtractionSnapshot } from "../knowledge-extraction-policy";
import { VIDEO_TEMPLATE_PROMPT, videoTemplateInstructions, videoTemplateSchema, readVideoTemplateResult, type VideoTemplateResult } from "../video-template-policy";
import { SOURCE_ASSIST_PROMPT, SELECTED_IDEA_PROMPT, selectedIdeaInstructions, sourceAssistInstructions, sourceAssistSchema, readSourceAssistResult, type SourceAssistResult } from "../source-assist-policy";
import { requestStructuredText,type TextRunSpec } from "./openai-text";
import { createTextRunHandler,productionTextRunDeps,type TextRunDeps } from "./text-run";
export const knowledgeExtractionSpec:TextRunSpec<KnowledgeExtractionResult,KnowledgeExtractionSnapshot>={workflow:"knowledge_extract",model:IDEA_REVIEW_MODEL,promptVersion:KNOWLEDGE_EXTRACTION_PROMPT,
  instructions:knowledgeExtractionInstructions,schema:knowledgeExtractionSchema,maxOutputTokens:6000,validate:readKnowledgeExtractionResult};
const outlineSpec: typeof knowledgeExtractionSpec = { ...knowledgeExtractionSpec, promptVersion: KNOWLEDGE_OUTLINE_PROMPT,
  instructions: knowledgeOutlineBatchInstructions, schema: knowledgeOutlineBatchSchema, validate: readKnowledgeOutlineBatchResult };
const curatedSpec: typeof knowledgeExtractionSpec = { ...outlineSpec, promptVersion: KNOWLEDGE_CURATED_PROMPT,
  instructions: knowledgeCuratedBatchInstructions, schema: knowledgeCuratedBatchSchema, validate: readKnowledgeCuratedBatchResult };
type SourceAnalysisSpec = TextRunSpec<KnowledgeExtractionResult | VideoTemplateResult | SourceAssistResult, KnowledgeExtractionSnapshot>;
const videoTemplateSpec: SourceAnalysisSpec = { ...knowledgeExtractionSpec, promptVersion: VIDEO_TEMPLATE_PROMPT,
  instructionContext: "video_template", instructions: videoTemplateInstructions, schema: videoTemplateSchema,
  maxOutputTokens: 6000, validate: readVideoTemplateResult };
const sourceAssistSpec: SourceAnalysisSpec = { ...knowledgeExtractionSpec, promptVersion: SOURCE_ASSIST_PROMPT,
  instructionContext: "source_assist", instructions: sourceAssistInstructions, schema: sourceAssistSchema, maxOutputTokens: 2500, validate: readSourceAssistResult };
const selectedIdeaSpec: SourceAnalysisSpec = { ...sourceAssistSpec, promptVersion: SELECTED_IDEA_PROMPT, instructions: selectedIdeaInstructions };
export function knowledgeExtractionSpecFor(snapshot: unknown): SourceAnalysisSpec {
  const mode = snapshot && typeof snapshot === "object" && "mode" in snapshot ? snapshot.mode : null;
  if (mode === "script_template") return videoTemplateSpec;
  if (mode === "source_assist") return (snapshot as { selectedOutline?: string }).selectedOutline ? selectedIdeaSpec : sourceAssistSpec;
  if (mode !== "outline") return knowledgeExtractionSpec;
  return (snapshot as KnowledgeExtractionSnapshot).curationVersion === 1 ? curatedSpec : outlineSpec;
}

export const requestKnowledgeExtraction=(snapshot:KnowledgeExtractionSnapshot,key:string,signal:AbortSignal,fetcher:typeof fetch=fetch)=>requestStructuredText(knowledgeExtractionSpecFor(snapshot),snapshot,key,signal,fetcher);
export type KnowledgeExtractionDeps=TextRunDeps<KnowledgeExtractionResult | VideoTemplateResult | SourceAssistResult,KnowledgeExtractionSnapshot>;
export const createKnowledgeExtractionHandler=(deps:KnowledgeExtractionDeps)=>createTextRunHandler<KnowledgeExtractionResult | VideoTemplateResult | SourceAssistResult, KnowledgeExtractionSnapshot>(knowledgeExtractionSpec,deps,knowledgeExtractionSpecFor);
export const productionKnowledgeExtractionDeps=(rest:KnowledgeExtractionDeps["db"])=>productionTextRunDeps(rest,requestKnowledgeExtraction);
