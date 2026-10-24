import { IDEA_REVIEW_MODEL } from "../idea-review-policy";
import { KNOWLEDGE_EXTRACTION_PROMPT,knowledgeExtractionInstructions,knowledgeExtractionSchema,readKnowledgeExtractionResult,type KnowledgeExtractionResult,type KnowledgeExtractionSnapshot } from "../knowledge-extraction-policy";
import { requestStructuredText,type TextRunSpec } from "./openai-text";
import { createTextRunHandler,productionTextRunDeps,type TextRunDeps } from "./text-run";
export const knowledgeExtractionSpec:TextRunSpec<KnowledgeExtractionResult,KnowledgeExtractionSnapshot>={workflow:"knowledge_extract",model:IDEA_REVIEW_MODEL,promptVersion:KNOWLEDGE_EXTRACTION_PROMPT,
  instructions:knowledgeExtractionInstructions,schema:knowledgeExtractionSchema,maxOutputTokens:6000,validate:readKnowledgeExtractionResult};
export const requestKnowledgeExtraction=(snapshot:KnowledgeExtractionSnapshot,key:string,signal:AbortSignal,fetcher:typeof fetch=fetch)=>requestStructuredText(knowledgeExtractionSpec,snapshot,key,signal,fetcher);
export type KnowledgeExtractionDeps=TextRunDeps<KnowledgeExtractionResult,KnowledgeExtractionSnapshot>;
export const createKnowledgeExtractionHandler=(deps:KnowledgeExtractionDeps)=>createTextRunHandler(knowledgeExtractionSpec,deps);
export const productionKnowledgeExtractionDeps=(rest:KnowledgeExtractionDeps["rest"])=>productionTextRunDeps(rest,requestKnowledgeExtraction);
