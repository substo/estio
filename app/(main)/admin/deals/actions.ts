'use server';

import db from "@/lib/db";
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
import { collectDealConversationReferences, resolveDealConversationRefs, syncDealConversationLinks } from "@/lib/deals/conversation-links";
import { getActiveContactsAccess, type ActiveContactsAccess } from "@/lib/contacts/active-location-access";
import { buildConversationVisibilityWhere } from "@/lib/conversations/contact-assignment-access";
import { buildDealManageWhere, buildDealVisibilityWhere } from "@/lib/deals/assignment-access";

type DealTimelineWindow = {
    oldestCursor: string | null;
    newestCursor: string | null;
    count: number;
    requestedLimit: number;
};

async function getAuthenticatedDealAccess(requestedScope?: string | null) {
    const access = await getActiveContactsAccess();
    if (!access) throw new Error("Unauthorized");
    const location = await db.location.findUnique({ where: { id: access.locationId } });
    if (!location) throw new Error("Unauthorized");
    return { access, location, requestedScope };
}

function mapDealConversationRowToUi(row: any, ghlLocationId: string | null): Conversation {
    const lastMessageAtMs = Number(new Date(row.lastMessageAt || 0).getTime());
    return {
        id: row.id,
        legacyConversationId: row.ghlConversationId || null,
        ghlConversationId: row.ghlConversationId || null,
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

async function queryDealParticipants(
    dealId: string,
    access: ActiveContactsAccess,
    ghlLocationId: string | null,
) {
    const locationId = access.locationId;
    const deal = await db.dealContext.findFirst({
        where: { id: dealId, ...buildDealManageWhere(access) },
        select: {
            id: true,
            title: true,
            stage: true,
            lastActivityAt: true,
            metadata: true,
            propertyIds: true,
            conversationIds: true,
            conversationLinks: {
                select: {
                    conversationId: true,
                    legacyConversationRef: true,
                },
            },
        },
    });

    if (!deal) return null;

    const refs = collectDealConversationReferences(deal);
    const conversations = await db.conversation.findMany({
        where: {
            AND: [
                buildConversationVisibilityWhere(access, "location"),
                { OR: [
                    { id: { in: refs.linkedConversationIds } },
                    { id: { in: refs.legacyConversationRefs } },
                    { ghlConversationId: { in: refs.legacyConversationRefs } },
                    { syncRecords: { some: { providerConversationId: { in: refs.legacyConversationRefs } } } },
                    { syncRecords: { some: { providerThreadId: { in: refs.legacyConversationRefs } } } },
                ] },
            ],
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

export async function getDealContexts(scope?: "my" | "location") {
    const { access } = await getAuthenticatedDealAccess(scope);

    // Fetch all active deals
    const deals = await db.dealContext.findMany({
        where: {
            ...buildDealVisibilityWhere(access, scope),
            stage: { not: 'CLOSED' }
        },
        orderBy: { lastActivityAt: 'desc' },
        take: 50
    });

    return deals;
}

export async function getDealContext(id: string) {
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
    const { access, location } = await getAuthenticatedDealAccess("location");
    const resolved = await resolveDealConversationRefs(db as any, location.id, conversationIds);
    const resolvedConversationIds = resolved.map((item) => item.conversationId);
    const refs = Array.from(new Set([...conversationIds, ...resolvedConversationIds].filter(Boolean)));

    // Find any active deal that contains ANY of the selected conversations
    const deals = await db.dealContext.findMany({
        where: {
            ...buildDealManageWhere(access),
            stage: 'ACTIVE',
            OR: [
                { conversationLinks: { some: { conversationId: { in: resolvedConversationIds } } } },
                { conversationIds: { hasSome: refs } },
            ],
        },
        include: { conversationLinks: true },
    });

    // Sort by relevance (most overlapping IDs) could be done in memory
    return deals.map(d => ({
        id: d.id,
        title: d.title,
        matchedCount: Math.max(
            d.conversationIds.filter(id => refs.includes(id)).length,
            (d as any).conversationLinks.filter((link: any) => resolvedConversationIds.includes(link.conversationId)).length
        ),
        totalCount: Math.max(d.conversationIds.length, (d as any).conversationLinks.length)
    })).sort((a, b) => b.matchedCount - a.matchedCount);
}

export async function createPersistentDeal(title: string, conversationIds: string[]) {
    const { access, location } = await getAuthenticatedDealAccess("location");
    const normalizedTitle = String(title || "").trim() || "Untitled Deal";
    const normalizedConversationIds = Array.from(new Set(
        (Array.isArray(conversationIds) ? conversationIds : [])
            .map((conversationId) => String(conversationId || "").trim())
            .filter(Boolean)
    ));

    if (normalizedConversationIds.length === 0) {
        throw new Error("Select at least one conversation.");
    }

    const resolved = await resolveDealConversationRefs(db as any, location.id, normalizedConversationIds);
    if (resolved.length === 0) {
        throw new Error("No valid conversations were found for this deal.");
    }

    const canonicalConversationIds = resolved.map((item) => item.conversationId);
    const visibleConversationCount = await db.conversation.count({
        where: {
            id: { in: canonicalConversationIds },
            ...buildConversationVisibilityWhere(access, "location"),
        },
    });
    if (visibleConversationCount !== canonicalConversationIds.length) {
        throw new Error("One or more conversations are unavailable.");
    }
    const queuedAt = new Date().toISOString();
    const dealContext = await db.dealContext.create({
        data: {
            title: normalizedTitle,
            locationId: location.id,
            assignedUserId: access.internalUserId,
            conversationIds: canonicalConversationIds,
            propertyIds: [],
            stage: 'ACTIVE',
            lastActivityAt: new Date(),
            metadata: mergeDealEnrichmentMetadata(null, {
                status: "pending",
                queuedAt,
            }),
        },
    });
    await syncDealConversationLinks(db as any, {
        dealId: dealContext.id,
        locationId: location.id,
        conversationRefs: normalizedConversationIds,
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
    const { access, location } = await getAuthenticatedDealAccess("location");
    const normalizedDealId = String(dealId || "").trim();
    const requestedTake = Number(options?.take);
    const take = Number.isFinite(requestedTake) && requestedTake > 0
        ? Math.min(Math.max(Math.floor(requestedTake), 1), 500)
        : 40;

    const resolved = await queryDealParticipants(normalizedDealId, access, location.ghlLocationId || null);
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
    const { access, location } = await getAuthenticatedDealAccess("location");
    const normalizedDealId = String(dealId || "").trim();

    const resolved = await queryDealParticipants(normalizedDealId, access, location.ghlLocationId || null);
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
    const { access } = await getAuthenticatedDealAccess("location");

    const result = await db.dealContext.updateMany({
        where: { id: dealId, ...buildDealManageWhere(access) },
        data: { stage: status }
    });
    if (result.count === 0) {
        throw new Error("Deal not found");
    }

    return { success: true };
}

export async function runDealAgentAction(dealId: string, message: string, history: any[]) {
    const { access, location } = await getAuthenticatedDealAccess("location");

    // Check access
    const deal = await db.dealContext.findFirst({
        where: { id: dealId, ...buildDealManageWhere(access) }
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
    const { access, location } = await getAuthenticatedDealAccess("location");

    const deal = await db.dealContext.findFirst({
        where: { id: dealId, ...buildDealManageWhere(access) },
        select: { conversationIds: true }
    });

    if (!deal) throw new Error("Deal not found");

    const resolved = await resolveDealConversationRefs(db as any, location.id, [conversationId]);
    const resolvedIds = new Set(resolved.map((item) => item.conversationId));
    const refsToRemove = new Set([conversationId, ...resolved.map((item) => item.legacyConversationRef).filter(Boolean) as string[]]);
    const newIds = deal.conversationIds.filter(id => !refsToRemove.has(id) && !resolvedIds.has(id));

    await db.$transaction([
        db.dealContext.update({
            where: { id: dealId },
            data: { conversationIds: newIds }
        }),
        (db as any).dealConversationLink.deleteMany({
            where: {
                dealId,
                OR: [
                    { conversationId: { in: Array.from(resolvedIds) } },
                    { legacyConversationRef: { in: Array.from(refsToRemove) } },
                ],
            },
        }),
    ]);

    return { success: true };
}


export async function fetchDealTimeline(
    dealId: string,
    options?: {
        take?: number | null;
        beforeCursor?: string | null;
    }
) {
    const { access, location } = await getAuthenticatedDealAccess("location");
    const requestedTake = Number(options?.take);
    const take = Number.isFinite(requestedTake) && requestedTake > 0
        ? Math.min(Math.max(Math.floor(requestedTake), 1), 500)
        : 40;
    const deal = await db.dealContext.findFirst({
        where: { id: dealId, ...buildDealManageWhere(access) },
        select: { id: true },
    });
    if (!deal) throw new Error("Deal not found");

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
