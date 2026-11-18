import { callLLMWithMetadata } from "./llm";
import { securelyRecordAiUsage } from "./usage-metering";

export type ContentAiRequest = {
  model: string; prompt: string; locationId: string; action: string;
  jsonMode?: boolean; temperature?: number;
};

/** One call and one usage event, using the actual provider/model/funding returned
 * by the shared resolver (which may prefer the interactive account subscription). */
export async function generateContentAiText(args: ContentAiRequest, deps = {
  generate: callLLMWithMetadata, record: securelyRecordAiUsage,
}): Promise<string> {
  const result = await deps.generate(args.model, args.prompt, undefined, {
    jsonMode: args.jsonMode ?? true, temperature: args.temperature,
    locationId: args.locationId, executionMode: "interactive",
  });
  await deps.record({
    locationId: args.locationId, resourceType: "website", featureArea: "website_content",
    action: args.action, provider: result.provider, model: result.model,
    inputTokens: result.usage.promptTokens,
    outputTokens: result.usage.completionTokens + result.usage.thoughtsTokens,
    fundingScope: result.fundingScope, executionMode: result.executionMode,
    metadata: { requestedModel: args.model, cachedContentTokens: result.usage.cachedContentTokens },
  });
  return result.text;
}
