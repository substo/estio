'use server';

import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import type { Conversation } from "@/lib/ghl/conversations";
import {
    assembleTimelineEvents,
    buildTimelineCursorFromEvent,
} from "@/lib/conversations/timeline-events";
import { mergeDealEnrichmentMetadata } from "@/lib/deals/enrichment";
import {
    enqueueDealEnrichment,
    initDealEnrichmentWorker,
} from "@/lib/queue/deal-enrichment";
import { DealAgent } from "@/lib/ai/agent";

type DealTimelineWindow = {
    oldestCursor: string | null;
    newestCursor: string | null;
    count: number;
    requestedLimit: number;
};

async function getAuthenticatedLocation() {
    const location = await getLocationContext();
    if (!location?.ghlAccessToken) throw new Error("Unauthorized or GHL not connected");
    return location;
}

function mapDealConversationRowToUi(row: any, ghlLocationId: string | null): Conversation {
    const lastMessageAtMs = Number(new Date(row.lastMessageAt || 0).getTime());
    return {
        id: row.ghlConversationId,
        contactId: row.contact?.ghlContactId || row.contactId,
        contactName: row.contact?.name || "Unknown Contact",
        contactEmail: row.contact?.email || undefined,
        contactPhone: row.contact?.phone || undefined,
        contactPreferredLanguage: row.contact?.preferredLang || null,
        replyLanguageOverride: row.replyLanguageOverride || null,
        status: (row.status as any) || "open",
        type: row.lastMessageType || "TYPE_SMS",
        lastMessageType: row.lastMessageType || undefined,
        lastMessageBody: row.lastMessageBody || "",
        lastMessageDate: Number.isFinite(lastMessageAtMs) ? Math.floor(lastMessageAtMs / 1000) : 0,
        unreadCount: Number(row.unreadCount || 0),
        locationId: ghlLocationId || "",
        suggestedActions: [],
    };
}

async function queryDealParticipants(dealId: string, locationId: string, ghlLocationId: string | null) {
    const deal = await db.dealContext.findFirst({
        where: { id: dealId, locationId },
        select: {
            id: true,
            title: true,
            stage: true,
            lastActivityAt: true,
            metadata: true,
            propertyIds: true,
            conversationIds: true,
        },
    });

    if (!deal) return null;

    const conversations = await db.conversation.findMany({
        where: {
            ghlConversationId: { in: deal.conversationIds },
            locationId,
        },
        include: {
            contact: {
                select: {
                    ghlContactId: true,
                    name: true,
                    email: true,
                    phone: true,
                    preferredLang: true,
                    contactType: true,
                },
            },
        },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    });

    return {
        deal,
        participants: conversations.map((conversation) => mapDealConversationRowToUi(conversation, ghlLocationId)),
    };
}

function buildDealTimelineWindow(events: any[], requestedLimit: number): DealTimelineWindow {
    const normalizedEvents = Array.isArray(events) ? events : [];
    return {
        oldestCursor: buildTimelineCursorFromEvent(normalizedEvents[0]) || null,
        newestCursor: buildTimelineCursorFromEvent(normalizedEvents[normalizedEvents.length - 1]) || null,
        count: normalizedEvents.length,
        requestedLimit: Math.max(1, Math.floor(Number(requestedLimit) || normalizedEvents.length || 1)),
    };
}

export async function getDealContexts() {
    const location = await getAuthenticatedLocation();

    // Fetch all active deals
    const deals = await db.dealContext.findMany({
        where: {
            locationId: location.id,
            stage: { not: 'CLOSED' }
        },
        orderBy: { lastActivityAt: 'desc' },
        take: 50
    });

    return deals;
}

export async function getDealContext(id: string) {
    const location = await getAuthenticatedLocation();
    const [core, sidebar] = await Promise.all([
        getDealWorkspaceCore(id, { take: 1 }),
        getDealWorkspaceSidebar(id),
    ]);

    if (!core?.success || !sidebar?.success) return null;

    return {
        ...sidebar.deal,
        conversations: core.participants,
        properties: sidebar.properties,
        metadata: sidebar.metadata,
    };
}

export async function findExistingDeal(conversationIds: string[]) {
    const location = await getAuthenticatedLocation();

    // Find any active deal that contains ANY of the selected conversations
    const deals = await db.dealContext.findMany({
        where: {
            locationId: location.id,
            stage: 'ACTIVE',
            conversationIds: { hasSome: conversationIds }
        }
    });

    // Sort by relevance (most overlapping IDs) could be done in memory
    return deals.map(d => ({
        id: d.id,
        title: d.title,
        matchedCount: d.conversationIds.filter(id => conversationIds.includes(id)).length,
        totalCount: d.conversationIds.length
    })).sort((a, b) => b.matchedCount - a.matchedCount);
}

export async function createPersistentDeal(title: string, conversationIds: string[]) {
    const location = await getAuthenticatedLocation();
    const normalizedTitle = String(title || "").trim() || "Untitled Deal";
    const normalizedConversationIds = Array.from(new Set(
        (Array.isArray(conversationIds) ? conversationIds : [])
            .map((conversationId) => String(conversationId || "").trim())
            .filter(Boolean)
    ));

    if (normalizedConversationIds.length === 0) {
        throw new Error("Select at least one conversation.");
    }

    const queuedAt = new Date().toISOString();
    const dealContext = await db.dealContext.create({
        data: {
            title: normalizedTitle,
            locationId: location.id,
            conversationIds: normalizedConversationIds,
            propertyIds: [],
            stage: 'ACTIVE',
            lastActivityAt: new Date(),
            metadata: mergeDealEnrichmentMetadata(null, {
                status: "pending",
                queuedAt,
            }),
        },
    });

    void initDealEnrichmentWorker().catch((error) => {
        console.warn("[Deal Enrichment] Worker init failed, continuing with enqueue fallback:", error);
    });

    const enqueueResult = await enqueueDealEnrichment({
        dealId: dealContext.id,
        allowInlineFallback: true,
    });

    if (enqueueResult.mode === "queue-unavailable") {
        await db.dealContext.update({
            where: { id: dealContext.id },
            data: {
                metadata: mergeDealEnrichmentMetadata(dealContext.metadata, {
                    status: "failed",
                    failedAt: new Date().toISOString(),
                    error: enqueueResult.error || "Queue unavailable for deal enrichment.",
                }),
            },
        });
    }

    return dealContext;
}

export async function getDealWorkspaceCore(
    dealId: string,
    options?: {
        take?: number | null;
        beforeCursor?: string | null;
    }
) {
    const location = await getAuthenticatedLocation();
    const normalizedDealId = String(dealId || "").trim();
    const requestedTake = Number(options?.take);
    const take = Number.isFinite(requestedTake) && requestedTake > 0
        ? Math.min(Math.max(Math.floor(requestedTake), 1), 500)
        : 40;

    const resolved = await queryDealParticipants(normalizedDealId, location.id, location.ghlLocationId || null);
    if (!resolved) {
        return {
            success: false as const,
            error: "Deal not found.",
        };
    }

    const timeline = await assembleTimelineEvents({
        mode: "deal",
        locationId: location.id,
        dealId: normalizedDealId,
        includeMessages: true,
        includeActivities: true,
        take,
        beforeCursor: options?.beforeCursor || null,
    });

    return {
        success: true as const,
        deal: resolved.deal,
        participants: resolved.participants,
        timelineEvents: timeline.events,
        timelineWindow: buildDealTimelineWindow(timeline.events, take),
    };
}

export async function getDealWorkspaceSidebar(dealId: string) {
    const location = await getAuthenticatedLocation();
    const normalizedDealId = String(dealId || "").trim();

    const resolved = await queryDealParticipants(normalizedDealId, location.id, location.ghlLocationId || null);
    if (!resolved) {
        return {
            success: false as const,
            error: "Deal not found.",
        };
    }

    const properties = await db.property.findMany({
        where: {
            id: { in: resolved.deal.propertyIds },
        },
    });

    return {
        success: true as const,
        deal: resolved.deal,
        participants: resolved.participants,
        properties,
        metadata: resolved.deal.metadata,
    };
}

export async function updateDealStatus(dealId: string, status: string) {
    const location = await getAuthenticatedLocation();

    const result = await db.dealContext.updateMany({
        where: { id: dealId, locationId: location.id },
        data: { stage: status }
    });
    if (result.count === 0) {
        throw new Error("Deal not found");
    }

    return { success: true };
}

export async function runDealAgentAction(dealId: string, message: string, history: any[]) {
    const location = await getAuthenticatedLocation();

    // Check access
    const deal = await db.dealContext.findFirst({
        where: { id: dealId, locationId: location.id }
    });
    if (!deal) throw new Error("Deal not found");

    // Init Agent
    // Get API Key from siteConfig or env
    const siteConfig = await db.siteConfig.findUnique({ where: { locationId: location.id } });
    const apiKey = (siteConfig as any)?.googleAiApiKey || process.env.GOOGLE_API_KEY;

    if (!apiKey) throw new Error("AI not configured");

    const agent = new DealAgent(apiKey, dealId, location.id);

    // Run
    const response = await agent.run(message, history);

    // Update last activity
    await db.dealContext.update({
        where: { id: dealId },
        data: { lastActivityAt: new Date() }
    });

    return response;
}

export async function removeConversationFromDeal(dealId: string, conversationId: string) {
    const location = await getAuthenticatedLocation();

    const deal = await db.dealContext.findFirst({
        where: { id: dealId, locationId: location.id },
        select: { conversationIds: true }
    });

    if (!deal) throw new Error("Deal not found");

    const newIds = deal.conversationIds.filter(id => id !== conversationId);

    await db.dealContext.update({
        where: { id: dealId },
        data: { conversationIds: newIds }
    });

    return { success: true };
}


export async function fetchDealTimeline(
    dealId: string,
    options?: {
        take?: number | null;
        beforeCursor?: string | null;
    }
) {
    const location = await getAuthenticatedLocation();
    const requestedTake = Number(options?.take);
    const take = Number.isFinite(requestedTake) && requestedTake > 0
        ? Math.min(Math.max(Math.floor(requestedTake), 1), 500)
        : 40;

    const timeline = await assembleTimelineEvents({
        mode: "deal",
        locationId: location.id,
        dealId,
        includeMessages: true,
        includeActivities: true,
        take,
        beforeCursor: options?.beforeCursor || null,
    });

    return {
        events: timeline.events,
        timelineWindow: buildDealTimelineWindow(timeline.events, take),
    };
}
