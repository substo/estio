import { withAiWorkflowInstructions } from "../ai/workflow-capabilities";
import { callChatGptSubscriptionWithMetadata, resolveChatGptSubscriptionDefaultModel } from "@/lib/ai/chatgpt-subscription";
import { resolveOpenAiApiKey, OPENAI_DEFAULT_TEXT_MODEL, stripOpenAiModelPrefix } from "@/lib/ai/openai-models";
import { executeCrmRouteStep, routeUsageMetadata } from "@/lib/ai/llm";
import { GEMINI_FLASH_LATEST_ALIAS } from "@/lib/ai/models";
import { CRM_DEFAULT_OUTPUT_TOKENS, loadCrmRoutePlan, runLocationCrmRoute } from "@/lib/ai/crm-route-loader";
import type { CrmRoutePlan, CrmRouteRecord } from "@/lib/ai/crm-routing";
import { AiProviderRejectedError, AiRouteUnavailableError } from "@/lib/ai/route-errors";
import { securelyRecordAiUsage, type AiFundingScope } from "@/lib/ai/usage-metering";
import { researchOutputJsonSchema } from "./research-contract";

/**
 * Which of the Location's own AI connections runs onboarding research, and how. The Location's ordered chain decides
 * (lib/ai/crm-routing.ts).
 * - ChatGPT subscription (server Codex, live web search on for research only)
 * - OpenAI API key (Responses API with the web_search tool)
 * - Gemini API key: reads the fetched pages only, no Google Search grounding.
 * The server path skips personal credentials.
 * Worker-safe: no "server-only" imports. Every call is recorded against the Location.
 */
export type ResearchProvider = "chatgpt_subscription" | "openai_key" | "gemini_key";
export type ProviderReply = { text: string; provider: ResearchProvider; model: string; route?: CrmRouteRecord };
export type OnboardingOperation = "onboarding_research" | "onboarding_answer";
const isResearchProvider = (kind: string): kind is ResearchProvider => kind === "chatgpt_subscription" || kind === "openai_key" || kind === "gemini_key";

export const onboardingServerPlan = (locationId: string, operation: OnboardingOperation, routing?: Parameters<typeof loadCrmRoutePlan>[0]["routing"]) =>
  loadCrmRoutePlan({ locationId, operation, interactive: false, routing });

/** The first server connection the chain would use now, or null (the onboarding gate and the run's first label). */
export async function chooseResearchProvider(locationId: string, operation: OnboardingOperation = "onboarding_research"): Promise<ResearchProvider | null> {
  const plan = await onboardingServerPlan(locationId, operation);
  return plan.steps.map(s => s.kind).find(isResearchProvider) ?? null;
}

/**
 * Run one onboarding call over the Location chain. The next step runs only when a step failed before generation; the
 * system prompt is rebuilt per step because only some providers search the web.
 */
export async function runOnboardingRoute(input: { locationId: string; userId: string | null; operation: OnboardingOperation; system: (webSearch: boolean) => string; user: string; action: string; signal?: AbortSignal; plan?: CrmRoutePlan }): Promise<ProviderReply> {
  const plan = input.plan ?? await onboardingServerPlan(input.locationId, input.operation);
  const research = input.operation === "onboarding_research";
  const searchPrompt = input.system(true);
  const readPrompt = research ? input.system(false) : searchPrompt;
  const routed = await runLocationCrmRoute(plan, input.locationId, {
    inputChars: Math.max(searchPrompt.length, readPrompt.length) + input.user.length + JSON.stringify(researchOutputJsonSchema).length + 6000,
    outputTokens: CRM_DEFAULT_OUTPUT_TOKENS,
  }, step => {
    const provider = step.kind as ResearchProvider;
    const webSearch = research && providerSearchesWeb(provider);
    return runProvider({ provider, model: step.model, locationId: input.locationId, webSearch,
      system: webSearch ? searchPrompt : readPrompt, user: input.user, signal: input.signal, operation: input.operation });
  }, value => value);
  const value = routed.value;
  const route = { ...routed.route, actual: { kind: routed.step.kind, model: value.model } };
  await securelyRecordAiUsage({
    locationId: input.locationId, userId: input.userId, resourceType: "location", resourceId: input.locationId,
    featureArea: "business_onboarding", action: input.action, provider: value.usageProvider, model: value.model,
    inputTokens: value.inputTokens, outputTokens: value.outputTokens, fundingScope: value.fundingScope,
    executionMode: input.operation === "onboarding_answer" ? "interactive" : "background",
    metadata: { webSearch: research && providerSearchesWeb(value.provider), ...routeUsageMetadata({ route }) },
  });
  return { text: value.text, provider: value.provider, model: value.model, route };
}
export const providerSearchesWeb = (provider: ResearchProvider) => provider !== "gemini_key";

function outputText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks: string[] = [];
  for (const item of payload?.output ?? []) for (const part of item?.content ?? []) if (typeof part?.text === "string") chunks.push(part.text);
  return chunks.join("\n").trim();
}

type MeteredReply = ProviderReply & { usageProvider: string; inputTokens: number; outputTokens: number; fundingScope: AiFundingScope };

async function runProvider(input: { provider: ResearchProvider; model: string | null; operation: OnboardingOperation; locationId: string; system: string; user: string; webSearch: boolean; signal?: AbortSignal }): Promise<MeteredReply> {
  input = { ...input, system: withAiWorkflowInstructions(input.system, input.operation) };
  if (input.provider === "chatgpt_subscription") {
    const model = resolveChatGptSubscriptionDefaultModel(input.model ?? null);
    const result = await callChatGptSubscriptionWithMetadata(model, input.system, input.user, {
      executionContext: { executionMode: "background", locationId: input.locationId, userId: null }, jsonSchema: researchOutputJsonSchema as unknown as Record<string, unknown>, webSearch: input.webSearch });
    return { text: result.text, provider: input.provider, model: result.model, usageProvider: "chatgpt_subscription",
      inputTokens: result.usage.promptTokens, outputTokens: result.usage.completionTokens, fundingScope: result.fundingScope };
  }
  if (input.provider === "openai_key") {
    const apiKey = await resolveOpenAiApiKey(input.locationId);
    if (!apiKey) throw new AiRouteUnavailableError("The OpenAI key is no longer available.");
    const model = stripOpenAiModelPrefix(input.model || OPENAI_DEFAULT_TEXT_MODEL);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: input.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: input.system, input: input.user, max_output_tokens: CRM_DEFAULT_OUTPUT_TOKENS, ...(input.webSearch ? { tools: [{ type: "web_search" }] } : {}),
        text: { format: { type: "json_schema", name: "onboarding_research", strict: true, schema: researchOutputJsonSchema } } }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new AiProviderRejectedError(`OpenAI could not complete the research (${response.status}). Check the key in Settings → Integrations.`, response.status);
    const usage = payload?.usage ?? {};
    const text = outputText(payload);
    if (!text) throw new Error("OpenAI returned an empty onboarding response.");
    return { text, provider: input.provider, model, usageProvider: "openai", inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0, fundingScope: "location_openai" };
  }
  const model = input.model || GEMINI_FLASH_LATEST_ALIAS;
  // The system prompt already carries the onboarding contract; run the Gemini step directly (no re-routing).
  const result = await executeCrmRouteStep({ kind: "gemini_key", model, label: "Gemini API", personal: false, paid: true }, input.system, input.user,
    { jsonMode: true, locationId: input.locationId, executionMode: "background", maxOutputTokens: CRM_DEFAULT_OUTPUT_TOKENS });
  return { text: result.text, provider: input.provider, model: result.model, usageProvider: "google_gemini",
    inputTokens: result.usage.promptTokens + result.usage.toolUsePromptTokens,
    outputTokens: result.usage.completionTokens + result.usage.thoughtsTokens, fundingScope: "location_gemini" };
}
