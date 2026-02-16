
import { AI_PRICING, calculateRunCost, DEFAULT_MODEL } from "./pricing";

/**
 * Model Router configuration and logic.
 * 
 * Routes tasks to the optimal model based on the "Single Source of Truth" in pricing.ts.
 * 
 * Logic:
 * - Dynamically finds the best "Flash" or "Pro" model from AI_PRICING keys.
 * - Prioritizes newer versions (higher numbers).
 */

// Helper: Extract valid model IDs from pricing config
const VALID_MODELS = Object.keys(AI_PRICING);

// Helper: Find best model for a given tier (flash/pro)
function getBestModelForTier(tier: 'flash' | 'pro'): string {
    const candidates = VALID_MODELS.filter(m => m.includes(tier) && !m.includes('image'));

    // Sort by version (descending)
    // Simple heuristic: extract numbers, compare. 
    // If no numbers, alphabetical desc usually works for versions (3.0 > 2.0).
    candidates.sort((a, b) => {
        const vA = parseFloat(a.match(/\d+(\.\d+)?/)?.[0] || '0');
        const vB = parseFloat(b.match(/\d+(\.\d+)?/)?.[0] || '0');
        return vB - vA;
    });

    return candidates[0] || DEFAULT_MODEL;
}

// Cache selections to avoid re-sorting every call (optional optimization)
const BEST_FLASH = getBestModelForTier('flash');
const BEST_PRO = getBestModelForTier('pro');

// Map valid task types to their ideal tier
const TASK_TIER_MAP: Record<string, 'flash' | 'pro'> = {
    "intent_classification": "flash",
    "sentiment_analysis": "flash",
    "simple_generation": "flash",
    "tool_selection": "flash",
    "property_search": "flash",

    "draft_reply": "pro",
    "qualification": "pro",
    "negotiation": "pro",
    "deal_coordinator": "pro",
    "negotiation_advice": "pro",

    "complex_planning": "pro", // Fallback to Pro until Thinking models are standard in pricing
    "market_analysis": "pro"
};

export function getModelForTask(taskType: string): string {
    const tier = TASK_TIER_MAP[taskType] || 'flash';
    return tier === 'pro' ? BEST_PRO : BEST_FLASH;
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    return calculateRunCost(modelId, inputTokens, outputTokens);
}
