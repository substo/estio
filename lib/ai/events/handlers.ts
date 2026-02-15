import { eventBus } from "./event-bus";
import { predictAndDraft } from "../semi-auto/predictor";
import db from "@/lib/db";

/**
 * Register all event handlers.
 * 
 * IMPORTANT: This is a SEMI-AUTO system. All handlers produce DRAFTS ONLY.
 * No handler is allowed to send messages autonomously. Every outbound
 * message requires human approval via the UI.
 * 
 * This function is idempotent — safe to call multiple times.
 */

let _registered = false;

export function registerEventHandlers() {
    if (_registered) return;
    _registered = true;

    // ── Message Received ──
    // When a WhatsApp/Email message arrives, auto-draft a response (if semi-auto is on).

    eventBus.on("message.received", async (event) => {
        const { conversationId, contactId, message } = event.payload;

        if (!conversationId || !contactId) return;

        // Only process inbound messages (don't re-trigger on our own outbound)
        if (event.payload.direction === "outbound") return;

        // Check if semi-auto is enabled for this conversation
        const conversation = await db.conversation.findUnique({
            where: { id: conversationId },
            select: { semiAuto: true },
        });

        if (!conversation?.semiAuto) return;

        // Use the predictor (has rate limiting + cooldown built in)
        try {
            await predictAndDraft({
                conversationId,
                contactId,
                triggerMessage: message ?? "",
                triggerSource: "webhook",
            });
        } catch (error) {
            console.error(`[EventHandler] message.received prediction failed for ${conversationId}:`, error);
        }
    });

    // ── New Lead Created ──
    // Auto-score based on source.

    eventBus.on("lead.created", async (event) => {
        const { contactId, source } = event.payload;

        if (!contactId) return;

        const initialScore: Record<string, number> = {
            website_form: 30,
            whatsapp_direct: 40,
            referral: 60,
            portal_inquiry: 35,
        };

        try {
            await db.contact.update({
                where: { id: contactId },
                data: { leadScore: initialScore[source] ?? 20 },
            });
        } catch (error) {
            console.error(`[EventHandler] lead.created scoring failed for ${contactId}:`, error);
        }
    });

    // ── Viewing Completed ──
    // Flag the viewing as complete (Phase 4's checkPendingFollowUps handles the actual follow-up).

    eventBus.on("viewing.completed", async (event) => {
        const { viewingId } = event.payload;

        if (!viewingId) return;

        try {
            await db.viewing.update({
                where: { id: viewingId },
                data: { status: "completed" },
            });
        } catch (error) {
            console.error(`[EventHandler] viewing.completed failed for ${viewingId}:`, error);
        }
    });

    // ── Follow-Up Due ──
    // Draft a follow-up message for human review.

    eventBus.on("follow_up.due", async (event) => {
        const { contactId } = event.payload;

        if (!contactId) return;

        try {
            // Find the most recent conversation for this contact
            const conversation = await db.conversation.findFirst({
                where: { contactId },
                orderBy: { lastMessageAt: "desc" },
                select: { id: true, semiAuto: true },
            });

            if (!conversation?.semiAuto) return;

            // Use predictor for rate-limited drafting
            await predictAndDraft({
                conversationId: conversation.id,
                contactId,
                triggerMessage: "FOLLOW_UP_TRIGGER",
                triggerSource: "cron",
            });
        } catch (error) {
            console.error(`[EventHandler] follow_up.due failed for ${contactId}:`, error);
        }
    });

    // ── New Listing Matches Saved Search ──
    // Draft personalized alerts for matching contacts.

    eventBus.on("listing.new", async (event) => {
        const { propertyId, matchingContactIds } = event.payload;

        if (!propertyId || !matchingContactIds?.length) return;

        for (const contactId of matchingContactIds) {
            try {
                const conversation = await db.conversation.findFirst({
                    where: { contactId },
                    orderBy: { lastMessageAt: "desc" },
                    select: { id: true, semiAuto: true },
                });

                if (!conversation?.semiAuto) continue;

                // Use predictor for rate-limited drafting
                await predictAndDraft({
                    conversationId: conversation.id,
                    contactId,
                    triggerMessage: `NEW_LISTING_ALERT:${propertyId}`,
                    triggerSource: "cron",
                });
            } catch (error) {
                console.error(`[EventHandler] listing.new failed for contact ${contactId}:`, error);
            }
        }
    });

    console.log("[EventBus] All event handlers registered (Semi-Auto mode — drafts only)");
}
