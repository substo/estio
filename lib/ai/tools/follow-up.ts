/**
 * Post-Viewing Follow-Up Tools for Phase 4: Coordinator & Scheduling
 * 
 * Handles automatic follow-up after viewings and processes feedback to determine next actions.
 */

import db from "@/lib/db";
import { storeInsight } from "../memory";

/**
 * Check for viewings that need follow-up.
 * Returns viewings where the scheduled time has passed (>2h ago) and no feedback received yet.
 */
export async function checkPendingFollowUps(): Promise<{
    viewingId: string;
    contactId: string;
    propertyTitle: string;
    hoursAgo: number;
}[]> {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const viewings = await db.viewing.findMany({
        where: {
            status: "confirmed",
            scheduledAt: { lte: twoHoursAgo },
            feedbackReceived: false,
        },
        include: {
            property: true,
            contact: true,
        },
    });

    return viewings.map(v => ({
        viewingId: v.id,
        contactId: v.contactId,
        propertyTitle: v.property?.title ?? "the property",
        hoursAgo: Math.round((Date.now() - (v.scheduledAt?.getTime() || Date.now())) / (60 * 60 * 1000)),
    }));
}

export interface ViewingFeedback {
    viewingId: string;
    overallRating: 1 | 2 | 3 | 4 | 5;
    liked: string[];
    disliked: string[];
    interestedInOffer: boolean;
    comments: string;
}

/**
 * Process viewing feedback and update deal state.
 * Stores insights and determines the next action based on feedback.
 */
export async function processViewingFeedback(
    feedback: ViewingFeedback
): Promise<{ nextAction: string; insights: number }> {
    const viewing = await db.viewing.findUnique({
        where: { id: feedback.viewingId },
        include: { contact: true },
    });

    if (!viewing) {
        throw new Error(`Viewing ${feedback.viewingId} not found`);
    }

    // Update viewing with feedback
    await db.viewing.update({
        where: { id: feedback.viewingId },
        data: {
            feedbackReceived: true,
            feedback: feedback as any,
            status: "completed",
        },
    });

    let insightCount = 0;

    // Store liked items as positive insights
    for (const liked of feedback.liked) {
        await storeInsight({
            contactId: viewing.contactId,
            conversationId: undefined, // May not have a conversation context
            text: `Liked "${liked}" about the property during viewing`,
            category: "preference",
            importance: 7,
            source: "agent_extracted",
        });
        insightCount++;
    }

    // Store disliked items as negative insights / deal breakers
    for (const disliked of feedback.disliked) {
        await storeInsight({
            contactId: viewing.contactId,
            conversationId: undefined,
            text: `Disliked "${disliked}" — potential deal breaker`,
            category: "preference",
            importance: 8,
            source: "agent_extracted",
        });
        insightCount++;
    }

    // Store overall sentiment
    if (feedback.comments) {
        await storeInsight({
            contactId: viewing.contactId,
            conversationId: undefined,
            text: `Viewing feedback: ${feedback.comments}`,
            category: "preference",
            importance: feedback.overallRating >= 4 ? 8 : 5,
            source: "agent_extracted",
        });
        insightCount++;
    }

    // Determine next action
    let nextAction: string;
    if (feedback.interestedInOffer) {
        nextAction = "transition_to_negotiator";
    } else if (feedback.overallRating >= 3) {
        nextAction = "suggest_similar_properties";
    } else {
        nextAction = "search_alternatives";
    }

    return { nextAction, insights: insightCount };
}
