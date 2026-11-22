import { CREATION_PROMPT, creationInstructions, creationTextSchema, isCreationSnapshot, readCreationTextResult, type CreationSnapshot, type CreationTextResult } from "../creation-text-policy";
import { AGENT_PROMPT, AGENT_PROMPT_V1, AGENT_PROMPT_V2, agentInstructions, agentInstructionsFor, agentSchema, isAgentSnapshot, readAgentResult, type AgentResult, type AgentSnapshot } from "../agent-policy";
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
/** Conversational agent round: one typed step per call; the server runs the tools between calls. v2 adds duration targets and 9,000-character Scripts. */
export const agentSpec: TextRunSpec<AgentResult, AgentSnapshot> = { workflow: "script_brief", model: IDEA_REVIEW_MODEL, promptVersion: AGENT_PROMPT, instructionContext: "studio_agent",
  instructions: agentInstructions, schema: agentSchema, maxOutputTokens: SCRIPT_BRIEF_MAX_OUTPUT, validate: readAgentResult };
type CombinedSpec = TextRunSpec<ScriptBriefResult | CreationTextResult | AgentResult, IdeaSnapshot>;
const agentCombined = (version: string): CombinedSpec => ({ ...agentSpec, promptVersion: version, instructions: agentInstructionsFor(version), validate(value, snapshot) {
  if (!isAgentSnapshot(snapshot)) throw new Error("Invalid Studio agent snapshot");
  return readAgentResult(value, snapshot, version);
} }) as CombinedSpec;
const agentV1 = agentCombined(AGENT_PROMPT_V1), agentV2 = agentCombined(AGENT_PROMPT_V2), agentV3 = agentCombined(AGENT_PROMPT);
const stagedSpec: CombinedSpec = { ...creationTextSpec, validate(value, snapshot) {
  if (!isCreationSnapshot(snapshot)) throw new Error("Invalid Studio creation snapshot");
  return readCreationTextResult(value, snapshot);
} };
/** An agent job runs under the exact prompt it was stamped with. Without one, the snapshot decides, as SQL stamping does: scriptLimits means v2. */
/** Without a stamped version the snapshot decides, as SQL stamping does: contract 3 is v3, scriptLimits alone is v2, neither is v1. */
const agentVersion = (snapshot: unknown, promptVersion?: string) => {
  const s = snapshot as { contract?: unknown; scriptLimits?: unknown };
  return promptVersion ?? (s.contract === 3 ? AGENT_PROMPT : s.scriptLimits ? AGENT_PROMPT_V2 : AGENT_PROMPT_V1);
};
export const scriptBriefSpecFor = (snapshot: unknown, promptVersion?: string): CombinedSpec => {
  if (!isAgentSnapshot(snapshot)) return isCreationSnapshot(snapshot) ? stagedSpec : scriptBriefSpec;
  const version = agentVersion(snapshot, promptVersion);
  return version === AGENT_PROMPT_V1 ? agentV1 : version === AGENT_PROMPT_V2 ? agentV2 : agentV3;
};
export type ScriptBriefDeps = TextRunDeps<ScriptBriefResult | CreationTextResult | AgentResult>;
export const createScriptBriefHandler = (deps: ScriptBriefDeps) => createTextRunHandler<ScriptBriefResult | CreationTextResult | AgentResult>(scriptBriefSpec, deps, scriptBriefSpecFor);
export const productionScriptBriefDeps = (rest: ScriptBriefDeps["db"]) => productionTextRunDeps(rest,
  (snapshot, key, signal) => requestStructuredText(scriptBriefSpecFor(snapshot), snapshot, key, signal));
