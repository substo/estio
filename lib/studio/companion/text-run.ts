import { ideaReviewSpec } from "../worker/openai-idea-review";
import { scriptBriefSpec } from "../worker/script-brief";
import { knowledgeExtractionSpec, knowledgeExtractionSpecFor } from "../worker/knowledge-extract";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
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
    } catch {
      throw new StudioJobError("text_execution_uncertain", "Subscription execution did not return a validated result. Automatic replay stopped.", false);
    }
  };
}
