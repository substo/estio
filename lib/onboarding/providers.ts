import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { callChatGptSubscriptionWithMetadata, isChatGptSubscriptionTransportEnabled, resolveChatGptSubscriptionCredential, resolveChatGptSubscriptionDefaultModel } from "@/lib/ai/chatgpt-subscription";
import { resolveOpenAiApiKey, OPENAI_DEFAULT_TEXT_MODEL, stripOpenAiModelPrefix } from "@/lib/ai/openai-models";
import { callLLMWithMetadata } from "@/lib/ai/llm";
import { GEMINI_FLASH_LATEST_ALIAS } from "@/lib/ai/models";
import { securelyRecordAiUsage, type AiFundingScope } from "@/lib/ai/usage-metering";
import { researchOutputJsonSchema } from "./research-contract";

/**
 * Which of the Location's own AI connections runs onboarding research, and how. Subscriptions go first, then API keys:
 * - ChatGPT subscription (server Codex, live web search on for research only)
 * - OpenAI API key (Responses API with the web_search tool)
 * - Gemini API key: reads the fetched pages only, no Google Search grounding.
 * Paired Macs (Codex/Claude on a subscription) need a companion handler for onboarding jobs, shipped with the Mac app;
 * until then they count as a connection for the gate but research uses the server sources above.
 * Worker-safe: no "server-only" imports. Every call is recorded against the Location.
 */
export type ResearchProvider = "chatgpt_subscription" | "openai_key" | "gemini_key";
export type ProviderReply = { text: string; provider: ResearchProvider; model: string };

export async function chooseResearchProvider(locationId: string): Promise<ResearchProvider | null> {
  if (isChatGptSubscriptionTransportEnabled() && await resolveChatGptSubscriptionCredential({ executionMode: "background", locationId, userId: null }).catch(() => null)) return "chatgpt_subscription";
  const has = (secretKey: string) => settingsService.hasSecret({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey }).catch(() => false);
  if (await has(SETTINGS_SECRET_KEYS.OPENAI_API_KEY)) return "openai_key";
  if (await has(SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY)) return "gemini_key";
  return null;
}
export const providerSearchesWeb = (provider: ResearchProvider) => provider !== "gemini_key";

async function aiSettings(locationId: string) {
  const doc = await settingsService.getDocument<{ openAiTextModel?: string | null; googleAiModelExtraction?: string | null }>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI }).catch(() => null);
  return doc?.payload ?? {};
}
function outputText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks: string[] = [];
  for (const item of payload?.output ?? []) for (const part of item?.content ?? []) if (typeof part?.text === "string") chunks.push(part.text);
  return chunks.join("\n").trim();
}

/** One research or extraction call on the given provider, recorded as usage. Throws a plain, secret-free message on failure. */
export async function runProvider(input: { provider: ResearchProvider; locationId: string; userId: string | null; system: string; user: string; webSearch: boolean; action: string; signal?: AbortSignal }): Promise<ProviderReply> {
  const record = (model: string, provider: string, inputTokens: number, outputTokens: number, fundingScope: AiFundingScope) => securelyRecordAiUsage({
    locationId: input.locationId, userId: input.userId, resourceType: "location", resourceId: input.locationId, featureArea: "business_onboarding", action: input.action,
    provider, model, inputTokens, outputTokens, fundingScope, executionMode: "background", metadata: { webSearch: input.webSearch } });
  if (input.provider === "chatgpt_subscription") {
    const model = resolveChatGptSubscriptionDefaultModel(null);
    const result = await callChatGptSubscriptionWithMetadata(model, input.system, input.user, {
      executionContext: { executionMode: "background", locationId: input.locationId, userId: null }, jsonSchema: researchOutputJsonSchema as unknown as Record<string, unknown>, webSearch: input.webSearch });
    await record(result.model, "chatgpt_subscription", result.usage.promptTokens, result.usage.completionTokens, result.fundingScope as AiFundingScope);
    return { text: result.text, provider: input.provider, model: result.model };
  }
  if (input.provider === "openai_key") {
    const apiKey = await resolveOpenAiApiKey(input.locationId);
    if (!apiKey) throw new Error("The OpenAI key is no longer available.");
    const model = stripOpenAiModelPrefix((await aiSettings(input.locationId)).openAiTextModel || OPENAI_DEFAULT_TEXT_MODEL);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: input.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: input.system, input: input.user, ...(input.webSearch ? { tools: [{ type: "web_search" }] } : {}),
        text: { format: { type: "json_schema", name: "onboarding_research", strict: true, schema: researchOutputJsonSchema } } }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenAI could not complete the research (${response.status}). Check the key in Settings → Integrations.`);
    const usage = payload?.usage ?? {};
    await record(model, "openai", Number(usage.input_tokens) || 0, Number(usage.output_tokens) || 0, "location_openai");
    return { text: outputText(payload), provider: input.provider, model };
  }
  const model = (await aiSettings(input.locationId)).googleAiModelExtraction || GEMINI_FLASH_LATEST_ALIAS;
  const result = await callLLMWithMetadata(model, input.system, input.user, { jsonMode: true, locationId: input.locationId, executionMode: "background" });
  await record(result.model, "google_gemini", result.usage.promptTokens, result.usage.completionTokens, "location_gemini");
  return { text: result.text, provider: input.provider, model: result.model };
}
