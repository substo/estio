/**
 * Helper library to calculate exact estimated USD costs for AI models used in the system.
 */

export interface CostCalculationInput {
    provider: string; // "google_gemini", "vertex_imagen", etc.
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    quantity?: number; // Used for per-image or per-request flat billing
}

// Typical costs per 1,000,000 tokens (USD)
const GEMINI_PRICING: Record<string, { promptPer1M: number; completionPer1M: number }> = {
    // Current public pricing estimates for Gemini models (approx)
    "gemini-1.5-flash": { promptPer1M: 0.075, completionPer1M: 0.30 },
    "gemini-1.5-pro": { promptPer1M: 1.25, completionPer1M: 5.00 },
    "gemini-1.0-pro": { promptPer1M: 0.50, completionPer1M: 1.50 },
};

// Flat rates per item generated/processed
const IMAGEN_PRICING: Record<string, number> = {
    "imagen-3.0-generate-001": 0.03, // $0.03 per image
    "imagen-3.0-capability-001": 0.03,
};

function normalizeModelName(model: string): string {
    const lower = model.toLowerCase();
    // E.g. "gemini-1.5-flash-001" -> "gemini-1.5-flash"
    if (lower.includes("gemini-1.5-flash")) return "gemini-1.5-flash";
    if (lower.includes("gemini-1.5-pro")) return "gemini-1.5-pro";
    if (lower.includes("gemini-1.0-pro")) return "gemini-1.0-pro";
    return lower; // fallback
}

export function calculateAiCost(input: CostCalculationInput): number {
    const rawModel = String(input.model || "").trim();
    if (!rawModel) return 0;

    const provider = String(input.provider || "").toLowerCase();
    const model = normalizeModelName(rawModel);

    // Vertex Imagen Flat Pricing
    if (provider === "vertex_imagen" || model.includes("imagen")) {
        const costPerImage = IMAGEN_PRICING[model] || 0.03; // fallback to 3 cents if exact model unknown
        const qty = input.quantity ?? 1;
        return costPerImage * Math.max(0, qty);
    }

    // Token-based Pricing (Google Gemini, OpenAI, etc)
    const inputTokens = Math.max(0, input.inputTokens || 0);
    const outputTokens = Math.max(0, input.outputTokens || 0);

    let promptCostPer1M = 0;
    let completionCostPer1M = 0;

    // Use Gemini pricing table if found
    if (GEMINI_PRICING[model]) {
        promptCostPer1M = GEMINI_PRICING[model].promptPer1M;
        completionCostPer1M = GEMINI_PRICING[model].completionPer1M;
    } else {
        // Fallback for unknown gemini models to flash pricing so we don't undercharge zero
        if (rawModel.includes("gemini")) {
            promptCostPer1M = 0.075;
            completionCostPer1M = 0.30;
        }
    }

    const inputCost = (inputTokens / 1_000_000) * promptCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * completionCostPer1M;

    return inputCost + outputCost;
}
