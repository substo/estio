import { z } from "zod";
import type { Usage } from "../../build/contract";
import { findTopic } from "../../onboarding/topics";
import { researchInput, researchOutputJsonSchema, researchOutputSchema, researchPrompt } from "../../onboarding/research-contract";
import { pageExcerptSchema } from "../../onboarding/state";
import { DEVICE_RESEARCH_RESULT_BYTES } from "../devices-policy";
import { StudioJobError, StudioProviderRejectedError, type StudioJobHandler } from "../worker/handlers";
import { summaryProviders } from "./library-summary";
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
const subscriptionLogin: Record<LocalProvider, string> = { codex: "chatgpt", claude: "claudeai" };
/** Which subscriptions have fresh capacity now, for the heartbeat (the server routes research only to a Mac with capacity). */
export function subscriptionCapacity(usage: Usage, now = Date.now()): Record<LocalProvider, boolean> {
  const ok = summaryProviders(usage, now);
  return { codex: ok.includes("codex"), claude: ok.includes("claude") };
}

export function createOnboardingResearchHandler(deps: { adapter: (p: LocalProvider) => LocalTextAdapter; usage: () => Promise<Usage>; enabled: () => boolean }): StudioJobHandler {
  return async (job, context) => {
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Waiting for the computer's processing settings.", true, 300);
    const parsed = researchPayloadSchema.safeParse(job.payload);
    const topic = parsed.success ? findTopic(parsed.data.topic) : undefined;
    if (!parsed.success || !topic) throw new StudioJobError("invalid_research", "This research request is not valid for this companion version.", false);
    const data = parsed.data;
    const prompt = `${researchPrompt(topic, { ...data.input, ...data.context, app: data.app, webSearch: true })}\n\n${researchInput({ ...data.input, pages: data.pages })}`;
    for (const provider of summaryProviders(await deps.usage())) {
      const adapter = deps.adapter(provider), ready = await adapter.readiness(context.signal);
      // Subscription logins only: an API-key login would bill a different account.
      if (!ready.ready || !ready.authenticated || ready.loginMethod !== subscriptionLogin[provider]) continue;
      try {
        const research = await adapter.generate({ signal: context.signal, prompt, webSearch: true, timeoutMs: researchTimeoutMs, maxResultBytes: replyBytes,
          jsonSchema: researchOutputJsonSchema as unknown as Record<string, unknown>, validate: value => researchOutputSchema.parse(value) });
        return { research: researchOutputSchema.parse(research), provider, model: "native-default" };
      } catch (error) {
        // Only an explicit, completed rejection moves on to the other subscription.
        if (error instanceof StudioProviderRejectedError && error.code === "rate_limited") continue;
        const code = error instanceof Error && error.message === "invalid_provider_result" ? "research_invalid" : "research_failed";
        throw new StudioJobError(code, code === "research_invalid" ? "The Mac's reply was not valid research." : "Research on the Mac did not finish (check the CLI sign-in and limits).", code === "research_failed", 60);
      }
    }
    throw new StudioJobError("subscription_capacity", "Waiting for fresh subscription capacity on the Mac.", true, 300);
  };
}
