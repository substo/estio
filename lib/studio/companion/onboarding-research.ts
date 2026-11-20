import { z } from "zod";
import type { Usage } from "../../build/contract";
import { findTopic } from "../../onboarding/topics";
import { researchInput, researchOutputJsonSchema, researchOutputSchema, researchPrompt } from "../../onboarding/research-contract";
import { pageExcerptSchema } from "../../onboarding/state";
import { DEVICE_RESEARCH_RESULT_BYTES } from "../devices-policy";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { localRoute, runLocalRoute, summaryProviders, type ReportLocalRoute } from "./route";
import type { LocalProvider, LocalTextAdapter } from "./providers";

/**
 * Business onboarding research on the Mac's own Codex/Claude subscription, with live web search on for this job kind only.
 * The server reads the website first and sends the excerpts; the prompt is built here from the shared research contract,
 * so the Mac never runs a server-written instruction. The structured reply goes back unparsed for the server to validate
 * and apply exactly like server research.
 */
export const researchPayloadSchema = z.object({
  batch: z.string().min(1).max(40), topic: z.string().min(1).max(40), actorId: z.string().max(200).nullable().optional(),
  app: z.enum(["estio", "substo"]),
  input: z.object({ name: z.string().max(200).optional(), website: z.string().max(2048).optional() }).strict(),
  context: z.object({ stage: z.string().nullable().optional(), kind: z.string().nullable().optional(), presence: z.string().nullable().optional(), summary: z.string().max(4000).nullable().optional(), excluded: z.array(z.string().max(60)).max(40).optional() }).strict().optional(),
  pages: z.array(pageExcerptSchema).max(6),
});
/** Room for the provider/model keys inside the device result bound. */
const replyBytes = DEVICE_RESEARCH_RESULT_BYTES - 200;
export const researchTimeoutMs = 8 * 60_000;
/** Which subscriptions have fresh capacity now, for the heartbeat (the server routes research only to a Mac with capacity). */
export function subscriptionCapacity(usage: Usage, now = Date.now()): Record<LocalProvider, boolean> {
  const ok = summaryProviders(usage, now);
  return { codex: ok.includes("codex"), claude: ok.includes("claude") };
}

export function createOnboardingResearchHandler(deps: { adapter: (p: LocalProvider) => LocalTextAdapter; usage: () => Promise<Usage>; enabled: () => boolean; deviceId?: string; reportRoute?: ReportLocalRoute }): StudioJobHandler {
  return async (job, context) => {
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Waiting for the computer's processing settings.", true, 300);
    const parsed = researchPayloadSchema.safeParse(job.payload);
    const topic = parsed.success ? findTopic(parsed.data.topic) : undefined;
    if (!parsed.success || !topic) throw new StudioJobError("invalid_research", "This research request is not valid for this companion version.", false);
    const data = parsed.data;
    const prompt = `${researchPrompt(topic, { ...data.input, ...data.context, app: data.app, webSearch: true })}\n\n${researchInput({ ...data.input, pages: data.pages })}`;
    // The Location order supplied with the job; without one, whichever subscription has more fresh capacity first.
    const routed = localRoute(job, { deviceId: deps.deviceId });
    const steps = routed?.steps ?? ((capacity: LocalProvider[]) => capacity.map(provider => ({ provider, model: undefined })));
    const attempt = await runLocalRoute(steps, deps, context.signal, (adapter, step) => adapter.generate({ workflowContext: "onboarding_research", signal: context.signal, prompt, webSearch: true, timeoutMs: researchTimeoutMs, maxResultBytes: replyBytes,
      model: step.model, jsonSchema: researchOutputJsonSchema as unknown as Record<string, unknown>, validate: value => researchOutputSchema.parse(value) }),
    error => {
      const code = error instanceof Error && error.message === "invalid_provider_result" ? "research_invalid" : "research_failed";
      throw new StudioJobError(code, code === "research_invalid" ? "The Mac's reply was not valid research." : "Research on the Mac did not finish (check the CLI sign-in and limits).", false);
    });
    if (attempt) {
      deps.reportRoute?.(job.id, attempt);
      return { research: researchOutputSchema.parse(attempt.value), provider: attempt.provider, model: attempt.model ?? "native-default" };
    }
    if (routed) throw new StudioJobError("onboarding_route_wait", "The Mac subscriptions in this step were unavailable before generation.", false);
    throw new StudioJobError("subscription_capacity", "Waiting for fresh subscription capacity on the Mac.", true, 300);
  };
}
