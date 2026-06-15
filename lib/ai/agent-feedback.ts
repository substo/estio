import db from "@/lib/db";

export type AgentFeedbackFeature =
    | "ai_draft"
    | "property_recommendation"
    | "browser_research"
    | "viewing_management"
    | string;

export type AgentFeedbackInput = {
    locationId: string;
    conversationId?: string | null;
    contactId?: string | null;
    sourceFeature: AgentFeedbackFeature;
    sourceAction?: string | null;
    agentExecutionId?: string | null;
    aiDecisionId?: string | null;
    traceId?: string | null;
    skillId?: string | null;
    model?: string | null;
    aiOutput?: string | null;
    humanOutput?: string | null;
    outcome?: string | null;
    rating?: string | null;
    feedbackReason?: string | null;
    toolTrace?: unknown;
    metadata?: Record<string, unknown> | null;
};

const MATERIAL_EDIT_DISTANCE_THRESHOLD = 0.2;

function normalizeComparableText(value: string) {
    return value
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

export function calculateNormalizedEditDistance(left: string, right: string) {
    const a = normalizeComparableText(left);
    const b = normalizeComparableText(right);
    if (!a && !b) return 0;
    if (!a || !b) return 1;
    if (a === b) return 0;

    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = Array.from({ length: b.length + 1 }, () => 0);

    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + substitutionCost
            );
        }
        for (let j = 0; j <= b.length; j += 1) {
            previous[j] = current[j];
        }
    }

    return previous[b.length] / Math.max(a.length, b.length);
}

export function shouldRecordMaterialFeedback(input: {
    aiOutput?: string | null;
    humanOutput?: string | null;
    rating?: string | null;
    feedbackReason?: string | null;
}) {
    const aiOutput = String(input.aiOutput || "").trim();
    const humanOutput = String(input.humanOutput || "").trim();
    const hasExplicitFeedback = !!String(input.rating || "").trim() || !!String(input.feedbackReason || "").trim();
    if (hasExplicitFeedback) return true;
    if (!aiOutput || !humanOutput) return false;
    return calculateNormalizedEditDistance(aiOutput, humanOutput) >= MATERIAL_EDIT_DISTANCE_THRESHOLD;
}

export async function recordAgentFeedback(input: AgentFeedbackInput) {
    const locationId = String(input.locationId || "").trim();
    const sourceFeature = String(input.sourceFeature || "").trim();
    const aiOutput = String(input.aiOutput || "").trim();
    const humanOutput = String(input.humanOutput || "").trim();
    if (!locationId || !sourceFeature) return null;

    const editDistance = aiOutput && humanOutput
        ? calculateNormalizedEditDistance(aiOutput, humanOutput)
        : null;
    const materialEdit = editDistance !== null && editDistance >= MATERIAL_EDIT_DISTANCE_THRESHOLD;

    if (!materialEdit && !shouldRecordMaterialFeedback(input)) {
        return null;
    }

    return (db as any).agentFeedback.create({
        data: {
            locationId,
            conversationId: input.conversationId || null,
            contactId: input.contactId || null,
            sourceFeature,
            sourceAction: input.sourceAction || null,
            agentExecutionId: input.agentExecutionId || null,
            aiDecisionId: input.aiDecisionId || null,
            traceId: input.traceId || null,
            skillId: input.skillId || null,
            model: input.model || null,
            aiOutput: aiOutput || null,
            humanOutput: humanOutput || null,
            outcome: input.outcome || "sent",
            rating: input.rating || null,
            feedbackReason: input.feedbackReason || null,
            editDistance,
            materialEdit,
            toolTrace: input.toolTrace === undefined ? undefined : input.toolTrace,
            metadata: input.metadata || undefined,
        },
        select: { id: true },
    });
}
