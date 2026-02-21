
export const AI_PRICING = {
    // --- Gemini 3.0 Models (Latest 2026) ---
    'gemini-3-pro-preview': {
        inputCostPerMillion: 2.00,
        outputCostPerMillion: 12.00,
        inputCostPerMillionHighContext: 4.00, // > 200k context
        outputCostPerMillionHighContext: 18.00, // > 200k context
    },
    'gemini-3-flash-preview': {
        inputCostPerMillion: 0.50,
        outputCostPerMillion: 3.00,
    },

    // --- Gemini 2.5 Models (Standard) ---
    'gemini-2.5-pro': {
        inputCostPerMillion: 1.25,
        outputCostPerMillion: 10.00,
        inputCostPerMillionHighContext: 2.50, // > 200k context
        outputCostPerMillionHighContext: 15.00, // > 200k context
    },
    'gemini-2.5-flash': {
        inputCostPerMillion: 0.30,
        outputCostPerMillion: 2.50,
    },
    'gemini-2.5-flash-lite': {
        inputCostPerMillion: 0.10,
        outputCostPerMillion: 0.40,
    },

    // --- Legacy Models (Gemini 1.5 - 2024/2025) ---
    'gemini-1.5-pro': {
        inputCostPerMillion: 3.50,
        outputCostPerMillion: 10.50,
        inputCostPerMillionHighContext: 7.00, // > 128k (Legacy tier)
        outputCostPerMillionHighContext: 21.00,
    },
    'gemini-1.5-flash': {
        inputCostPerMillion: 0.35,
        outputCostPerMillion: 1.05,
        inputCostPerMillionHighContext: 0.70,
        outputCostPerMillionHighContext: 2.10,
    },

    // --- Aliases & Previews ---
    'gemini-flash-latest': { // Maps to 2.5 Flash
        inputCostPerMillion: 0.30,
        outputCostPerMillion: 2.50,
    },
    'gemini-flash-lite-latest': { // Maps to 2.5 Flash-Lite
        inputCostPerMillion: 0.10,
        outputCostPerMillion: 0.40,
    },
    'gemini-2.0-flash': { // Legacy 2.0
        inputCostPerMillion: 0.20,
        outputCostPerMillion: 1.00,
    },
    'gemini-2.0-flash-lite': {
        inputCostPerMillion: 0.10,
        outputCostPerMillion: 0.40,
    },
    'gemini-robotics-er-1.5-preview': { // Specialized, assume Pro pricing
        inputCostPerMillion: 3.50,
        outputCostPerMillion: 10.50,
    },

    // Fallback
    'default': {
        inputCostPerMillion: 1.25, // Based on 2.5 Pro
        outputCostPerMillion: 10.00,
    }
};

export const DEFAULT_MODEL = 'gemini-3-flash-preview';

export type CostEstimateMethod =
    | 'explicit_usage_fields'
    | 'inferred_from_total_gap'
    | 'prompt_completion_only';

export type CostEstimateConfidence = 'high' | 'medium' | 'low';

export interface UsageForCostEstimate {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    thoughtsTokens?: number | null;
    toolUsePromptTokens?: number | null;
}

export interface CostEstimate {
    amount: number;
    method: CostEstimateMethod;
    confidence: CostEstimateConfidence;
    breakdown: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        thoughtsTokens: number;
        toolUsePromptTokens: number;
        inferredOutputTokens: number;
        billableInputTokens: number;
        billableOutputTokens: number;
        inputRatePerMillion: number;
        outputRatePerMillion: number;
    };
}

type PricingEntry = (typeof AI_PRICING)[keyof typeof AI_PRICING];

function sanitizeTokenCount(value: unknown): number {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.floor(num);
}

function getPricingForModel(model: string): PricingEntry {
    let pricing = AI_PRICING[model as keyof typeof AI_PRICING];
    if (pricing) return pricing;

    const key = Object.keys(AI_PRICING).find(k => model.startsWith(k));
    if (key) {
        return AI_PRICING[key as keyof typeof AI_PRICING];
    }

    return AI_PRICING.default;
}

function getRatesForModel(model: string, inputTokens: number): { inputRate: number; outputRate: number } {
    const pricing = getPricingForModel(model);
    const threshold = model.includes('1.5') ? 128_000 : 200_000;
    const isHighContext = inputTokens > threshold;

    let inputRate = pricing.inputCostPerMillion;
    let outputRate = pricing.outputCostPerMillion;

    if (isHighContext && 'inputCostPerMillionHighContext' in pricing && pricing.inputCostPerMillionHighContext) {
        inputRate = pricing.inputCostPerMillionHighContext;
    }
    if (isHighContext && 'outputCostPerMillionHighContext' in pricing && pricing.outputCostPerMillionHighContext) {
        outputRate = pricing.outputCostPerMillionHighContext;
    }

    return { inputRate, outputRate };
}

/**
 * Calculate the cost of an AI run.
 * @param model Model identifier (e.g., 'gemini-3-pro')
 * @param promptTokens Number of input tokens
 * @param completionTokens Number of output tokens
 * @returns Cost in USD
 */
export function calculateRunCost(model: string, promptTokens: number, completionTokens: number): number {
    const safePromptTokens = sanitizeTokenCount(promptTokens);
    const safeCompletionTokens = sanitizeTokenCount(completionTokens);
    const { inputRate, outputRate } = getRatesForModel(model, safePromptTokens);

    const inputCost = (safePromptTokens / 1_000_000) * inputRate;
    const outputCost = (safeCompletionTokens / 1_000_000) * outputRate;

    return inputCost + outputCost;
}

/**
 * Cost estimator that supports modern Gemini usage fields (thoughts/tool use) and
 * falls back safely when only prompt/completion counts are available.
 */
export function calculateRunCostFromUsage(model: string, usage: UsageForCostEstimate): CostEstimate {
    const promptTokens = sanitizeTokenCount(usage.promptTokens);
    const completionTokens = sanitizeTokenCount(usage.completionTokens);
    const totalTokens = sanitizeTokenCount(usage.totalTokens);
    const thoughtsTokens = sanitizeTokenCount(usage.thoughtsTokens);
    const toolUsePromptTokens = sanitizeTokenCount(usage.toolUsePromptTokens);

    const knownInputTokens = promptTokens + toolUsePromptTokens;
    const knownOutputTokens = completionTokens + thoughtsTokens;
    const knownTotalTokens = knownInputTokens + knownOutputTokens;

    const inferredOutputTokens =
        totalTokens > knownTotalTokens ? totalTokens - knownTotalTokens : 0;

    const billableInputTokens = knownInputTokens;
    const billableOutputTokens = knownOutputTokens + inferredOutputTokens;
    const { inputRate, outputRate } = getRatesForModel(model, billableInputTokens);

    const amount =
        (billableInputTokens / 1_000_000) * inputRate +
        (billableOutputTokens / 1_000_000) * outputRate;

    let method: CostEstimateMethod = 'prompt_completion_only';
    let confidence: CostEstimateConfidence = 'low';

    if (inferredOutputTokens > 0) {
        method = 'inferred_from_total_gap';
        confidence = 'medium';
    } else if (thoughtsTokens > 0 || toolUsePromptTokens > 0) {
        method = 'explicit_usage_fields';
        confidence = 'high';
    }

    return {
        amount,
        method,
        confidence,
        breakdown: {
            promptTokens,
            completionTokens,
            totalTokens,
            thoughtsTokens,
            toolUsePromptTokens,
            inferredOutputTokens,
            billableInputTokens,
            billableOutputTokens,
            inputRatePerMillion: inputRate,
            outputRatePerMillion: outputRate
        }
    };
}
