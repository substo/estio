import { IDEA_REVIEW_MODEL, type IdeaSnapshot } from "../idea-review-policy";
import { SCRIPT_BRIEF_MAX_OUTPUT, SCRIPT_BRIEF_PROMPT, scriptBriefInstructions, scriptBriefSchema, readScriptBriefResult, type ScriptBriefResult } from "../script-brief-policy";
import { requestStructuredText, type TextRunSpec } from "./openai-text";
import { createTextRunHandler, productionTextRunDeps, type TextRunDeps } from "./text-run";
export const scriptBriefSpec: TextRunSpec<ScriptBriefResult> = { workflow: "script_brief", model: IDEA_REVIEW_MODEL, promptVersion: SCRIPT_BRIEF_PROMPT,
  instructions: scriptBriefInstructions, schema: scriptBriefSchema, maxOutputTokens: SCRIPT_BRIEF_MAX_OUTPUT, validate: readScriptBriefResult };
export const requestScriptBrief = (snapshot: IdeaSnapshot, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch) => requestStructuredText(scriptBriefSpec, snapshot, key, signal, fetcher);
export type ScriptBriefDeps = TextRunDeps<ScriptBriefResult>;
export const createScriptBriefHandler = (deps: ScriptBriefDeps) => createTextRunHandler(scriptBriefSpec, deps);
export const productionScriptBriefDeps = (rest: ScriptBriefDeps["rest"]) => productionTextRunDeps(rest, requestScriptBrief);
