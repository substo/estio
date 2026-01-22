
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

/**
 * Calculate the cost of an AI run.
 * @param model Model identifier (e.g., 'gemini-3-pro')
 * @param promptTokens Number of input tokens
 * @param completionTokens Number of output tokens
 * @returns Cost in USD
 */
export function calculateRunCost(model: string, promptTokens: number, completionTokens: number): number {
    // Normalize model string checks (e.g. handle versions)
    // Simple lookup for now
    let pricing = AI_PRICING[model as keyof typeof AI_PRICING];

    // If exact match fails, try to find by prefix (e.g. "gemini-1.5-pro-001" -> "gemini-1.5-pro")
    if (!pricing) {
        const key = Object.keys(AI_PRICING).find(k => model.startsWith(k));
        if (key) {
            pricing = AI_PRICING[key as keyof typeof AI_PRICING];
        } else {
            pricing = AI_PRICING['default'];
        }
    }

    // Determine tier based on prompt length (Context Window)
    // Gemini 3/2.5 often use 200k as the tier. 1.5 used 128k.
    // We'll use 200k as the modern standard check, unless legacy logic needed.
    // Simplifying: if 'inputCostPerMillionHighContext' exists, we check against a threshold.
    // We'll assume 200k for modern, but 128k was old standard. Let's use 128k to be safe/inclusive or 200k?
    // The search results for 3/2.5 said 200k.
    const CONTEXT_THRESHOLD = 200_000;

    // Legacy override for 1.5 if needed, but let's stick to the pricing object structure.
    // Note: If using 1.5, the threshold was 128k. 
    // Let's check if model contains "1.5"
    const threshold = model.includes('1.5') ? 128_000 : 200_000;

    const isHighContext = promptTokens > threshold;

    let inputRate = pricing.inputCostPerMillion;
    let outputRate = pricing.outputCostPerMillion;

    if (isHighContext && 'inputCostPerMillionHighContext' in pricing && pricing.inputCostPerMillionHighContext) {
        inputRate = pricing.inputCostPerMillionHighContext;
    }
    if (isHighContext && 'outputCostPerMillionHighContext' in pricing && pricing.outputCostPerMillionHighContext) {
        outputRate = pricing.outputCostPerMillionHighContext;
    }

    const inputCost = (promptTokens / 1_000_000) * inputRate;
    const outputCost = (completionTokens / 1_000_000) * outputRate;

    return inputCost + outputCost;
}
