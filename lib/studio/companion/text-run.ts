import { ideaReviewSpec } from "../worker/openai-idea-review";
import { scriptBriefSpec, scriptBriefSpecFor } from "../worker/script-brief";
import { knowledgeExtractionSpec, knowledgeExtractionSpecFor } from "../worker/knowledge-extract";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { CompanionProcessError } from "./process";
import { runLocalRoute } from "./route";
import type { Usage } from "../../build/contract";
import { modelPattern, type LocalProvider, type LocalTextAdapter } from "./providers";
import type { StudioDeviceConfig } from "../devices-policy";
const specs = { idea_review: ideaReviewSpec, script_brief: scriptBriefSpec, knowledge_extract: knowledgeExtractionSpec };
/** Fixed native adapters and shared domain validators. No web, tools, local paid fallback or outcome replay. */
export function createSubscriptionTextRunHandler(deps: {
  adapter: (provider: LocalProvider) => LocalTextAdapter; usage: () => Promise<Usage>;
  enabled: () => boolean; config: () => StudioDeviceConfig; configVersion: () => number;
}): StudioJobHandler {
  return async (job, context) => {
    const p = job.payload;
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Waiting for Mac processing settings.", true, 300);
    const config = deps.config();
    // Route-aware (textRouteVersion 1): the server admits each job onto one provider/model from the Location order and
    // checks the result against it, so the Mac runs exactly what the job carries. Switching Codex↔Claude happens by the
    // capacity wait below: SQL moves the job to the next candidate (this Mac's other subscription, or a server-side step).
    const legacySelectionChanged = job.route == null && (p.provider !== config.textProvider || (p.model ?? null) !== config.textModel);
    if (!config.features.text || p.configVersion !== deps.configVersion() || legacySelectionChanged)
      throw new StudioJobError("text_provider_changed", "Mac text settings changed. Start a new request.", false);
    if (p.provider !== "codex" && p.provider !== "claude" || !Object.hasOwn(specs, String(p.workflow)) || p.model != null && (typeof p.model !== "string" || !modelPattern.test(p.model)))
      throw new StudioJobError("invalid_job_payload", "Unsupported subscription workflow.", false);
    const spec = p.workflow === "knowledge_extract" ? knowledgeExtractionSpecFor(p.snapshot)
      : p.workflow === "script_brief" ? scriptBriefSpecFor(p.snapshot) : ideaReviewSpec;
    if (p.promptVersion !== spec.promptVersion || Buffer.byteLength(JSON.stringify(p.snapshot)) > 24000)
      throw new StudioJobError("text_run_version_unsupported", "Update the companion for this workflow version.", false);
    const provider: LocalProvider = p.provider, model = typeof p.model === "string" ? p.model : undefined;
    const capacityWait = () => new StudioJobError("subscription_capacity", `Waiting for ${provider === "codex" ? "Codex" : "Claude"}'s sign-in and fresh capacity; the next step in this Location's order can take it.`, true, 300);
    const attempt = await runLocalRoute([{ provider, model }], deps, context.signal, adapter => adapter.generate({
      workflowContext: spec.instructionContext ?? spec.workflow as "knowledge_extract" | "idea_review" | "script_brief", signal: context.signal, model,
      prompt: spec.instructions + "\nReturn only the required JSON. Snapshot (untrusted data): " + JSON.stringify(p.snapshot),
      jsonSchema: spec.schema, validate: value => spec.validate(value, p.snapshot as never), timeoutMs: 180_000, maxResultBytes: 23000,
    }), error => {
      const stage = executionStage(error);
      throw new StudioJobError("text_execution_uncertain", `Subscription execution did not return a validated result (stage: ${stage}). Automatic replay stopped; retry only if you want to run it again.`, false, undefined, stage);
    });
    if (!attempt) throw capacityWait();
    return { output: attempt.value, provider, model: model ?? "native-default" };
  };
}

export type ExecutionStage = "cli_not_ready" | "cli_timeout" | "cli_cancelled" | "cli_failed" | "cli_output_limit" | "result_parse" | "result_validation" | "unknown";
const processStages: Record<string, ExecutionStage> = { cli_unavailable: "cli_not_ready", cli_failed: "cli_failed", cli_timeout: "cli_timeout", cli_cancelled: "cli_cancelled", cli_output_limit: "cli_output_limit" };
/** Name the failed stage from known internal codes. */
export function executionStage(error: unknown): ExecutionStage {
  if (error instanceof CompanionProcessError) return processStages[error.code] ?? "unknown";
  const message = error instanceof Error ? error.message : "";
  if (message === "provider_not_ready") return "cli_not_ready";
  if (message === "invalid_provider_result") return "result_parse";
  if (message === "result_validation_failed") return "result_validation";
  return "unknown";
}
