
/**
 * Model Router configuration and logic.
 * 
 * Routes tasks to the optimal model based on complexity and cost.
 * - Flash: High speed, low cost (Generation, simple classif)
 * - Pro: Balanced (Reasoning, complex tool use)
 * - Thinking/Opus: High intelligence (Planning, heavy reasoning)
 */

export const MODELS = {
    gemini_flash: {
        id: "gemini-2.0-flash",
        pricing: { input: 0.10, output: 0.40 } // $ per 1M tokens (approx)
    },
    gemini_pro: {
        id: "gemini-2.0-pro-exp-02-05", // Using latest stable or exp
        pricing: { input: 1.25, output: 5.00 }
    },
    // Adding placeholder for Thinking model when available
    gemini_thinking: {
        id: "gemini-2.0-flash-thinking-exp-01-21",
        pricing: { input: 0.10, output: 0.40 } // Flash pricing for now
    }
} as const;

export type ModelId = keyof typeof MODELS;

// Map valid task types to their ideal model
export const TASK_MODEL_MAP: Record<string, ModelId> = {
    "intent_classification": "gemini_flash",
    "sentiment_analysis": "gemini_flash",
    "simple_generation": "gemini_flash",
    "tool_selection": "gemini_flash",

    "property_search": "gemini_flash", // Flash is good enough for structured query gen
    "draft_reply": "gemini_pro",       // Pro for better tone/nuance
    "qualification": "gemini_pro",
    "negotiation": "gemini_pro",
    "deal_coordinator": "gemini_pro",
    "negotiation_advice": "gemini_pro", // Pro allows better reasoning

    "complex_planning": "gemini_thinking", // Thinking model for deep reasoning
    "market_analysis": "gemini_thinking"
};

export function getModelForTask(taskType: string): string {
    const modelKey = TASK_MODEL_MAP[taskType] || "gemini_flash";
    return MODELS[modelKey].id;
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    // Reverse lookup model key from ID if needed, or just iterate
    const modelEntry = Object.values(MODELS).find(m => m.id === modelId);
    if (!modelEntry) return 0;

    const inputCost = (inputTokens / 1_000_000) * modelEntry.pricing.input;
    const outputCost = (outputTokens / 1_000_000) * modelEntry.pricing.output;

    return inputCost + outputCost;
}
