import db from "@/lib/db";
import { calculateAiCost } from "./pricing-engine";

export interface RecordAiUsageInput {
    locationId: string;
    userId?: string | null;
    resourceType: string; // e.g., "property", "viewing_session"
    resourceId?: string | null;
    featureArea: string; // e.g., "property_image_enhancement"
    action: string; // e.g., "analyze", "precision_remove"
    provider: string; // e.g., "google_gemini", "vertex_imagen"
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    quantity?: number;
    metadata?: Record<string, unknown>;
}

/**
 * Safely writes telemetry for AI Usage without throwing errors that would disrupt main flow.
 * Recommended to wrap with `waitUntil()` if used in standard API routes.
 */
export async function securelyRecordAiUsage(input: RecordAiUsageInput): Promise<void> {
    try {
        if (!input.locationId || !input.resourceType || !input.featureArea || !input.action || !input.model) {
            console.warn("[UsageMetering] Missing required fields for AI telemetry", input);
            return;
        }

        const inputTokens = Math.max(0, input.inputTokens || 0);
        const outputTokens = Math.max(0, input.outputTokens || 0);
        const totalTokens = inputTokens + outputTokens;

        const estimatedCostUsd = calculateAiCost({
            provider: input.provider,
            model: input.model,
            inputTokens,
            outputTokens,
            quantity: input.quantity,
        });

        await db.aiUsage.create({
            data: {
                locationId: input.locationId,
                userId: input.userId || null,
                resourceType: input.resourceType,
                resourceId: input.resourceId || null,
                featureArea: input.featureArea,
                action: input.action,
                provider: input.provider,
                model: input.model,
                inputTokens,
                outputTokens,
                totalTokens,
                estimatedCostUsd,
                metadata: (input.metadata || {}) as any,
            },
        });
    } catch (error) {
        console.error("[UsageMetering] Failed to record AI usage telemetry:", error);
    }
}
