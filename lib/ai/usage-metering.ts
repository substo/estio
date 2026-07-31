import db from "@/lib/db";
import { calculateAiCost } from "./pricing-engine";
import { resolveAiUsageAttribution } from "./usage-attribution-policy";

export interface RecordAiUsageInput {
    locationId: string;
    userId?: string | null;
    resourceType: string; // e.g., "property", "viewing_session"
    resourceId?: string | null;
    featureArea: string; // e.g., "property_image_enhancement"
    action: string; // e.g., "analyze", "precision_remove"
    provider: string; // e.g., "google_gemini", "openai_api"
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    outputTokenType?: "text" | "image";
    quantity?: number;
    metadata?: Record<string, unknown>;
}

export interface RecordConversationAiUsageInput {
    locationId: string;
    conversationId: string;
    action: string;
    model: string;
    provider?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    userId?: string | null;
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
        const attributedUserId = await resolveAiUsageAttribution({
            locationId: input.locationId,
            requestedDbUserId: input.userId,
            findUserInLocation: (dbUserId, locationId) => db.user.findFirst({
                where: { id: dbUserId, locations: { some: { id: locationId } } },
                select: { id: true },
            }),
        });

        const estimatedCostUsd = await calculateAiCost({
            provider: input.provider,
            model: input.model,
            locationId: input.locationId,
            inputTokens,
            outputTokens,
            outputTokenType: input.outputTokenType,
            quantity: input.quantity,
        });

        await db.aiUsage.create({
            data: {
                locationId: input.locationId,
                userId: attributedUserId,
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

export async function securelyRecordConversationAiUsage(input: RecordConversationAiUsageInput): Promise<void> {
    await securelyRecordAiUsage({
        locationId: input.locationId,
        userId: input.userId || null,
        resourceType: "conversation",
        resourceId: input.conversationId,
        featureArea: "conversational_ai",
        action: input.action,
        provider: input.provider || "google_gemini",
        model: input.model,
        inputTokens: input.inputTokens || 0,
        outputTokens: input.outputTokens || 0,
        metadata: input.metadata,
    });
}
