import db from "@/lib/db";
import { runAiSkillDecision } from "../runtime/engine";

/**
 * Semi-Auto Predictor
 * 
 * Runs the orchestrator to predict next steps and draft replies.
 * CRITICAL: This module NEVER sends messages. All outputs are drafts
 * stored for human review.
 */

interface PredictionInput {
    conversationId: string;
    contactId: string;
    triggerMessage: string;
    triggerSource: "webhook" | "cron" | "ui";
}

interface PredictionResult {
    traceId: string;
    draftReply: string | null;
    suggestedActions: string[];
    intent: string;
    skillUsed: string | null;
    reasoning: string;
}

/**
 * Run prediction for a conversation.
 * Checks rate limits, builds context, calls orchestrator, stores draft.
 */
export async function predictAndDraft(input: PredictionInput): Promise<PredictionResult | null> {
    const conversationRecord = await db.conversation.findUnique({
        where: { id: input.conversationId },
        select: {
            id: true,
            locationId: true,
            contactId: true,
        },
    });

    if (!conversationRecord?.id) {
        console.warn(`[Predictor] Conversation not found: ${input.conversationId}`);
        return null;
    }

    // ── Rate Limit Check ──
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const draftCountToday = await db.agentExecution.count({
        where: {
            conversationId: input.conversationId,
            status: "draft",
            createdAt: { gte: todayStart },
        },
    });

    if (draftCountToday >= 50) {
        console.log(`[Predictor] Daily draft limit reached for ${input.conversationId}`);
        return null;
    }

    // ── Cooldown Check ──
    const lastDraft = await db.agentExecution.findFirst({
        where: {
            conversationId: input.conversationId,
            status: "draft",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
    });

    if (lastDraft) {
        const minutesSince = (Date.now() - lastDraft.createdAt.getTime()) / 60000;
        if (minutesSince < 2) {
            console.log(`[Predictor] Cooldown active for ${input.conversationId} (${minutesSince.toFixed(1)} min since last draft)`);
            return null;
        }
    }

    const objectiveHint = input.triggerMessage.startsWith("NEW_LISTING_ALERT:")
        ? "listing_alert"
        : input.triggerMessage === "FOLLOW_UP_TRIGGER"
            ? "revive"
            : undefined;

    const runtime = await runAiSkillDecision({
        locationId: conversationRecord.locationId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        source: "semi_auto",
        objectiveHint,
        contextSummary: [
            `Trigger source: ${input.triggerSource}`,
            `Trigger message: ${input.triggerMessage || "(empty)"}`,
        ].join("\n"),
        extraInstruction: "Keep this as a concise suggested response for human approval.",
        executeImmediately: true,
    });

    if (!runtime.success) {
        return null;
    }

    const decision = runtime.decisionId
        ? await db.aiDecision.findUnique({
            where: { id: runtime.decisionId },
            select: {
                selectedObjective: true,
                selectedSkillId: true,
                traceId: true,
                selectedScore: true,
                suggestedResponses: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: {
                        body: true,
                    },
                },
            },
        })
        : null;

    const draftReply = runtime.draftBody || decision?.suggestedResponses?.[0]?.body || null;
    const selectedSkill = runtime.selectedSkillId || decision?.selectedSkillId || null;
    const selectedObjective = decision?.selectedObjective || objectiveHint || "nurture";

    // ── Build Suggested Actions ──
    const suggestedActions: string[] = [];

    if (draftReply) {
        suggestedActions.push("review_draft_reply");
    }

    // Add intent-specific suggestions
    switch (selectedObjective) {
        case "book_viewing":
            suggestedActions.push("propose_viewing_slots");
            break;
        case "deal_progress":
            suggestedActions.push("review_offer_strategy");
            break;
        case "listing_alert":
            suggestedActions.push("review_search_results");
            break;
        case "revive":
            suggestedActions.push("review_follow_up_draft");
            break;
    }

    // ── Update Suggested Actions ──
    if (suggestedActions.length > 0) {
        await db.conversation.update({
            where: { id: input.conversationId },
            data: { suggestedActions },
        });
    }

    return {
        traceId: runtime.traceId || decision?.traceId || "",
        draftReply,
        suggestedActions,
        intent: String(selectedObjective || "UNKNOWN").toUpperCase(),
        skillUsed: selectedSkill,
        reasoning: `Decision score ${Number(runtime.score ?? decision?.selectedScore ?? 0).toFixed(2)} via runtime policy`,
    };
}
