import {
    getStoredProviderModels,
    type AiProviderModelProvider,
    type StoredProviderModel,
} from "@/lib/ai/provider-model-catalog";

export interface CostCalculationInput {
    provider: string;
    model: string;
    locationId?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    quantity?: number;
    outputTokenType?: "text" | "image";
}

type ProviderPricingMetadata = {
    currency?: string;
    unit?: string;
    inputPer1MTokens?: number;
    outputPer1MTokens?: number;
    imageOutputPer1MTokens?: number;
    outputImageTokens?: Array<{
        resolution?: string;
        tokens?: number;
        equivalentUsd?: number;
    }>;
};

function normalizeProvider(value: string): AiProviderModelProvider | null {
    const provider = String(value || "").trim().toLowerCase();
    if (provider === "google_gemini" || provider === "openai_api" || provider === "chatgpt_subscription") {
        return provider;
    }
    return null;
}

function normalizeModelLookupKey(model: string): string {
    return String(model || "")
        .trim()
        .toLowerCase()
        .replace(/^models\//, "")
        .replace(/-image-preview$/, "-image")
        .replace(/-preview$/, "");
}

function asPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function getProviderPricing(record: StoredProviderModel | null): ProviderPricingMetadata | null {
    const pricing = record?.pricing;
    if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) return null;

    const candidate = pricing as ProviderPricingMetadata;
    if (candidate.currency && candidate.currency !== "USD") return null;
    if (candidate.unit && candidate.unit !== "per_1m_tokens") return null;

    return candidate;
}

async function getCatalogPricing(input: {
    provider: AiProviderModelProvider;
    model: string;
    locationId?: string | null;
}): Promise<ProviderPricingMetadata | null> {
    const lookupKey = normalizeModelLookupKey(input.model);
    const scopes = [
        input.locationId ? { scopeType: "LOCATION" as const, scopeId: input.locationId } : null,
        { scopeType: "GLOBAL" as const, scopeId: "global" },
    ].filter(Boolean) as Array<{ scopeType: "LOCATION" | "GLOBAL"; scopeId: string }>;

    for (const scope of scopes) {
        const records = await getStoredProviderModels({
            provider: input.provider,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            includeUnavailable: true,
        });

        const exact = records.find((record) => record.modelId === input.model);
        const normalized = records.find((record) => normalizeModelLookupKey(record.modelId) === lookupKey);
        const pricing = getProviderPricing(exact || normalized || null);
        if (pricing) return pricing;
    }

    return null;
}

export async function calculateAiCost(input: CostCalculationInput): Promise<number> {
    const rawModel = String(input.model || "").trim();
    if (!rawModel) return 0;

    const provider = normalizeProvider(input.provider);
    if (provider === "chatgpt_subscription" || rawModel.startsWith("chatgpt_subscription:")) {
        return 0;
    }
    if (!provider) return 0;

    const pricing = await getCatalogPricing({
        provider,
        model: rawModel,
        locationId: input.locationId,
    });
    if (!pricing) return 0;

    const inputTokens = Math.max(0, input.inputTokens || 0);
    const outputTokens = Math.max(0, input.outputTokens || 0);
    const quantity = Math.max(0, input.quantity || 0);
    const inputPer1M = asPositiveNumber(pricing.inputPer1MTokens) || 0;
    const textOutputPer1M = asPositiveNumber(pricing.outputPer1MTokens) || 0;
    const imageOutputPer1M = asPositiveNumber(pricing.imageOutputPer1MTokens);

    const inputCost = (inputTokens / 1_000_000) * inputPer1M;
    let outputCost = 0;

    if (input.outputTokenType === "image") {
        if (outputTokens > 0 && imageOutputPer1M !== undefined) {
            outputCost = (outputTokens / 1_000_000) * imageOutputPer1M;
        } else if (quantity > 0) {
            const example = pricing.outputImageTokens?.find((item) => asPositiveNumber(item.equivalentUsd) !== undefined);
            if (example?.equivalentUsd !== undefined) {
                outputCost = quantity * example.equivalentUsd;
            } else if (imageOutputPer1M !== undefined) {
                const tokenExample = pricing.outputImageTokens?.find((item) => asPositiveNumber(item.tokens) !== undefined);
                outputCost = quantity * ((Number(tokenExample?.tokens || 0) / 1_000_000) * imageOutputPer1M);
            }
        }
    } else {
        outputCost = (outputTokens / 1_000_000) * textOutputPer1M;
    }

    return inputCost + outputCost;
}
