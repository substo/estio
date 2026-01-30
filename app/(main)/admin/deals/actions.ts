'use server';

import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { refreshGhlAccessToken } from "@/lib/location";
import { ensureLocalContactSynced } from "@/lib/crm/contact-sync";
import { getConversation } from "@/lib/ghl/conversations";

async function getAuthenticatedLocation() {
    const location = await getLocationContext();
    if (!location?.ghlAccessToken) throw new Error("Unauthorized or GHL not connected");
    return location;
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

    const deal = await db.dealContext.findUnique({
        where: { id, locationId: location.id }
    });

    if (!deal) return null;

    // Hydrate Participants (Conversations + Contacts)
    // We assume conversationIds are GHL Conversation IDs based on current usage
    const conversations = await db.conversation.findMany({
        where: {
            ghlConversationId: { in: deal.conversationIds },
            locationId: location.id
        },
        include: {
            contact: {
                include: {
                    viewings: true
                }
            }
        }
    });

    // Hydrate Properties
    const properties = await db.property.findMany({
        where: { id: { in: deal.propertyIds } }
    });

    return {
        ...deal,
        conversations: conversations.map(c => ({
            id: c.ghlConversationId,
            contactId: c.contactId,
            contactName: c.contact.name,
            contactEmail: c.contact.email,
            contactPhone: c.contact.phone,
            contactType: c.contact.contactType,
            lastMessageBody: c.lastMessageBody,
            lastMessageAt: c.lastMessageAt,
            unreadCount: c.unreadCount
        })),
        properties
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
    const accessToken = location.ghlAccessToken!;

    // Auto-detect properties from the contacts involved
    let propertyIds: string[] = [];
    try {
        // [JIT Sync] Ensure contacts are synced locally
        const conversations = await Promise.all(
            conversationIds.map(id => getConversation(accessToken, id))
        );

        const ghlContactIds = conversations
            .map(c => c.conversation?.contactId)
            .filter(Boolean) as string[];

        // Run Sync in Parallel
        await Promise.all(
            ghlContactIds.map(cid => ensureLocalContactSynced(cid, location.id, accessToken))
        );

        // Find local Contacts and their Property Roles to find shared properties
        if (ghlContactIds.length > 0) {
            const contacts = await db.contact.findMany({
                where: {
                    ghlContactId: { in: ghlContactIds },
                    locationId: location.id
                },
                include: {
                    propertyRoles: { select: { propertyId: true } },
                    viewings: { select: { propertyId: true } },
                    // Also check plain lists?
                }
            });

            // Extract unique Property IDs from roles and viewings
            const allPropIds = contacts.flatMap(c => [
                ...c.propertyRoles.map(r => r.propertyId),
                ...c.viewings.map(v => v.propertyId)
            ]);
            propertyIds = Array.from(new Set(allPropIds));
        }
    } catch (e) {
        console.warn("Failed to auto-detect properties for Deal Context", e);
    }

    // Create the DB record
    const dealContext = await db.dealContext.create({
        data: {
            title,
            locationId: location.id,
            conversationIds,
            propertyIds,
            stage: 'ACTIVE',
            lastActivityAt: new Date()
        }
    });

    return dealContext;
}

export async function updateDealStatus(dealId: string, status: string) {
    const location = await getAuthenticatedLocation();

    await db.dealContext.update({
        where: { id: dealId, locationId: location.id },
        data: { stage: status }
    });

    return { success: true };
}

import { DealAgent } from "@/lib/ai/agent";

export async function runDealAgentAction(dealId: string, message: string, history: any[]) {
    const location = await getAuthenticatedLocation();

    // Check access
    const deal = await db.dealContext.findUnique({
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

    const deal = await db.dealContext.findUnique({
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


export async function fetchDealTimeline(dealId: string) {
    const location = await getAuthenticatedLocation();

    // 1. Get Deal to find involved conversations
    const deal = await db.dealContext.findUnique({
        where: { id: dealId, locationId: location.id },
        select: { conversationIds: true }
    });

    if (!deal) throw new Error("Deal not found");

    // 2. Resolve internal Conversation IDs from GHL IDs
    const conversations = await db.conversation.findMany({
        where: {
            ghlConversationId: { in: deal.conversationIds },
            locationId: location.id
        },
        select: {
            id: true,
            ghlConversationId: true,
            contact: { select: { id: true, name: true, email: true, phone: true } }
        }
    });

    const internalConvIds = conversations.map(c => c.id);

    // 3. Fetch Messages
    const messages = await db.message.findMany({
        where: {
            conversationId: { in: internalConvIds }
        },
        orderBy: { createdAt: 'asc' },
        include: {
            conversation: {
                select: {
                    contact: { select: { name: true, email: true, ghlContactId: true } }
                }
            }
        }
    });

    // 4. Transform for UI
    // We want a unified feed format
    return messages.map(m => ({
        id: m.id,
        body: m.body || "",
        createdAt: m.createdAt,
        dateAdded: m.createdAt, // Alias for MessageBubble compatibility
        direction: m.direction,
        type: m.type,

        // Extended fields for MessageBubble
        subject: m.subject,
        emailFrom: m.emailFrom,
        emailTo: m.emailTo,

        senderName: m.direction === 'outbound' ? 'You' : (m.conversation.contact.name || "Unknown Contact"),
        senderEmail: m.conversation.contact.email,
        contactId: m.conversation.contact.ghlContactId,
        getStatus: m.status
    }));
}
