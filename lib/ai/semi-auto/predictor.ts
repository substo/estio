import db from "@/lib/db";
import { orchestrate } from "../orchestrator";

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

    // ── Build Context ──
    const recentMessages = await db.message.findMany({
        where: { conversationId: input.conversationId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { direction: true, body: true, createdAt: true },
    });

    const conversationHistory = recentMessages
        .reverse()
        .map((m) => `[${m.direction}] ${m.body ?? ""}`)
        .join("\n");

    // ── Orchestrate ──
    const result = await orchestrate({
        conversationId: input.conversationId,
        contactId: input.contactId,
        message: input.triggerMessage,
        conversationHistory,
    });

    // ── Build Suggested Actions ──
    const suggestedActions: string[] = [];

    if (result.draftReply) {
        suggestedActions.push("review_draft_reply");
    }

    // Add intent-specific suggestions
    switch (result.intent) {
        case "SCHEDULE_VIEWING":
            suggestedActions.push("propose_viewing_slots");
            break;
        case "PRICE_NEGOTIATION":
        case "OFFER":
        case "COUNTER_OFFER":
            suggestedActions.push("review_offer_strategy");
            break;
        case "PROPERTY_SEARCH":
            suggestedActions.push("review_search_results");
            break;
        case "CONTRACT_REQUEST":
            suggestedActions.push("review_contract_draft");
            break;
        case "FOLLOW_UP":
            suggestedActions.push("review_follow_up_draft");
            break;
    }

    // ── Store Draft (NEVER send) ──
    if (result.draftReply) {
        await db.agentExecution.create({
            data: {
                conversationId: input.conversationId,
                traceId: result.traceId,
                intent: result.intent,
                skillName: result.skillUsed,
                draftReply: result.draftReply,
                thoughtSummary: result.reasoning,
                status: "draft",
            },
        });
    }

    // ── Update Suggested Actions ──
    if (suggestedActions.length > 0) {
        await db.conversation.update({
            where: { id: input.conversationId },
            data: { suggestedActions },
        });
    }

    return {
        traceId: result.traceId,
        draftReply: result.draftReply,
        suggestedActions,
        intent: result.intent,
        skillUsed: result.skillUsed,
        reasoning: result.reasoning,
    };
}
