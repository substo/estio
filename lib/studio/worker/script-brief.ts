import { CREATION_PROMPT, creationInstructions, creationTextSchema, isCreationSnapshot, readCreationTextResult, type CreationSnapshot, type CreationTextResult } from "../creation-text-policy";
import { IDEA_REVIEW_MODEL, type IdeaSnapshot } from "../idea-review-policy";
import { SCRIPT_BRIEF_MAX_OUTPUT, SCRIPT_BRIEF_PROMPT, scriptBriefInstructions, scriptBriefSchema, readScriptBriefResult, type ScriptBriefResult } from "../script-brief-policy";
import { requestStructuredText, type TextRunSpec } from "./openai-text";
import { createTextRunHandler, productionTextRunDeps, type TextRunDeps } from "./text-run";
export const scriptBriefSpec: TextRunSpec<ScriptBriefResult> = { workflow: "script_brief", model: IDEA_REVIEW_MODEL, promptVersion: SCRIPT_BRIEF_PROMPT,
  instructions: scriptBriefInstructions, schema: scriptBriefSchema, maxOutputTokens: SCRIPT_BRIEF_MAX_OUTPUT, validate: readScriptBriefResult };
export const requestScriptBrief = (snapshot: IdeaSnapshot, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch) => requestStructuredText(scriptBriefSpec, snapshot, key, signal, fetcher);
export const creationTextSpec: TextRunSpec<CreationTextResult, CreationSnapshot> = {
  workflow: "script_brief", model: IDEA_REVIEW_MODEL, promptVersion: CREATION_PROMPT,
  instructions: creationInstructions, schema: creationTextSchema, maxOutputTokens: SCRIPT_BRIEF_MAX_OUTPUT, validate: readCreationTextResult,
};
type CombinedSpec = TextRunSpec<ScriptBriefResult | CreationTextResult, IdeaSnapshot>;
const stagedSpec: CombinedSpec = { ...creationTextSpec, validate(value, snapshot) {
  if (!isCreationSnapshot(snapshot)) throw new Error("Invalid Studio creation snapshot");
  return readCreationTextResult(value, snapshot);
} };
export const scriptBriefSpecFor = (snapshot: unknown): CombinedSpec => isCreationSnapshot(snapshot) ? stagedSpec : scriptBriefSpec;
export type ScriptBriefDeps = TextRunDeps<ScriptBriefResult | CreationTextResult>;
export const createScriptBriefHandler = (deps: ScriptBriefDeps) => createTextRunHandler<ScriptBriefResult | CreationTextResult>(scriptBriefSpec, deps, scriptBriefSpecFor);
export const productionScriptBriefDeps = (rest: ScriptBriefDeps["db"]) => productionTextRunDeps(rest,
  (snapshot, key, signal) => requestStructuredText(scriptBriefSpecFor(snapshot), snapshot, key, signal));
