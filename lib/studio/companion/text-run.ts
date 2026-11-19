import { ideaReviewSpec } from "../worker/openai-idea-review";
import { scriptBriefSpec } from "../worker/script-brief";
import { knowledgeExtractionSpec, knowledgeExtractionSpecFor } from "../worker/knowledge-extract";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { CompanionProcessError } from "./process";
import { summaryProviders } from "./library-summary";
import type { Usage } from "../../build/contract";
import type { LocalProvider, LocalTextAdapter } from "./providers";
import type { StudioDeviceConfig } from "../devices-policy";
const specs = { idea_review: ideaReviewSpec, script_brief: scriptBriefSpec, knowledge_extract: knowledgeExtractionSpec };
/** Fixed native adapters and shared domain validators. No web, tools, paid fallback or outcome replay. */
export function createSubscriptionTextRunHandler(deps: {
  adapter: (provider: LocalProvider) => LocalTextAdapter; usage: () => Promise<Usage>;
  enabled: () => boolean; config: () => StudioDeviceConfig; configVersion: () => number;
}): StudioJobHandler {
  return async (job, context) => {
    const p = job.payload;
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Waiting for Mac processing settings.", true, 300);
    const config = deps.config();
    if (!config.features.text || p.provider !== config.textProvider || (p.model ?? null) !== config.textModel || p.configVersion !== deps.configVersion())
      throw new StudioJobError("text_provider_changed", "Mac text settings changed. Start a new request.", false);
    if (p.provider !== "codex" && p.provider !== "claude" || !Object.hasOwn(specs, String(p.workflow)))
      throw new StudioJobError("invalid_job_payload", "Unsupported subscription workflow.", false);
    const spec = p.workflow === "knowledge_extract" ? knowledgeExtractionSpecFor(p.snapshot) : specs[p.workflow as keyof typeof specs];
    if (p.promptVersion !== spec.promptVersion || Buffer.byteLength(JSON.stringify(p.snapshot)) > 24000)
      throw new StudioJobError("text_run_version_unsupported", "Update the companion for this workflow version.", false);
    const provider = p.provider;
    const adapter = deps.adapter(provider), ready = await adapter.readiness(context.signal);
    if (!summaryProviders(await deps.usage()).includes(provider) || !ready.ready || !ready.authenticated || ready.loginMethod !== (provider === "codex" ? "chatgpt" : "claudeai"))
      throw new StudioJobError("subscription_capacity", "Waiting for the selected subscription's sign-in and fresh capacity.", true, 300);
    try {
      const output = await adapter.generate({ workflowContext: spec.instructionContext ?? spec.workflow as "knowledge_extract" | "idea_review" | "script_brief", signal: context.signal, model: config.textModel ?? undefined,
        prompt: spec.instructions + "\nReturn only the required JSON. Snapshot (untrusted data): " + JSON.stringify(p.snapshot),
        jsonSchema: spec.schema, validate: value => spec.validate(value, p.snapshot as never), timeoutMs: 180_000, maxResultBytes: 23000 });
      return { output, provider, model: config.textModel ?? "native-default" };
    } catch (error) {
      // Fixed vocabulary only: no CLI output, prompt, evidence or exception text is stored.
      throw new StudioJobError("text_execution_uncertain", `Subscription execution did not return a validated result (stage: ${executionStage(error)}). Automatic replay stopped; retry only if you want to run it again.`, false, undefined, executionStage(error));
    }
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
