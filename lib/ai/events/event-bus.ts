import db from "@/lib/db";

// ── Event Types ──

export type EventType =
    | "message.received"
    | "email.received"
    | "lead.created"
    | "viewing.completed"
    | "follow_up.due"
    | "listing.new"
    | "deal.stage_changed"
    | "document.signed";

export interface AgentEvent {
    type: EventType;
    payload: Record<string, any>;
    metadata: {
        timestamp: Date;
        sourceId: string; // e.g. "evolution-webhook", "cron", "ui"
        conversationId?: string;
        contactId?: string;
        dealId?: string;
    };
}

type EventHandler = (event: AgentEvent) => Promise<void>;

// ── Event Bus ──

class EventBus {
    private handlers = new Map<EventType, EventHandler[]>();

    /**
     * Register a handler for a specific event type.
     */
    on(eventType: EventType, handler: EventHandler) {
        const existing = this.handlers.get(eventType) ?? [];
        existing.push(handler);
        this.handlers.set(eventType, existing);
    }

    /**
     * Emit an event. Runs all registered handlers sequentially.
     * Logs every event to the AgentEvent table for observability.
     * Individual handler errors are caught and logged — they don't stop other handlers.
     */
    async emit(event: AgentEvent) {
        const handlers = this.handlers.get(event.type) ?? [];

        // Log event for observability
        let eventRecord: { id: string } | null = null;
        try {
            eventRecord = await db.agentEvent.create({
                data: {
                    type: event.type,
                    payload: event.payload,
                    conversationId: event.metadata.conversationId,
                    contactId: event.metadata.contactId,
                    status: "processing",
                },
            });
        } catch (logError) {
            console.error(`[EventBus] Failed to log event ${event.type}:`, logError);
        }

        let hasError = false;

        for (const handler of handlers) {
            try {
                await handler(event);
            } catch (error) {
                hasError = true;
                console.error(`[EventBus] Handler error for ${event.type}:`, error);

                // Update event record with error
                if (eventRecord) {
                    try {
                        await db.agentEvent.update({
                            where: { id: eventRecord.id },
                            data: {
                                status: "error",
                                error: error instanceof Error ? error.message : String(error),
                            },
                        });
                    } catch {
                        // Swallow — don't fail on logging failure
                    }
                }
            }
        }

        // Mark as processed if no errors
        if (eventRecord && !hasError) {
            try {
                await db.agentEvent.update({
                    where: { id: eventRecord.id },
                    data: { status: "processed" },
                });
            } catch {
                // Swallow
            }
        }
    }
}

export const eventBus = new EventBus();
