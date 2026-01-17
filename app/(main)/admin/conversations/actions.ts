'use server';

import { getLocationContext } from "@/lib/auth/location-context";
import { getConversations, getMessages, getConversation, sendMessage, getMessage, Conversation, Message } from "@/lib/ghl/conversations";
import { generateDraft } from "@/lib/ai/coordinator";
import { refreshGhlAccessToken } from "@/lib/location";
import db from "@/lib/db";
import { generateMultiContextDraft } from "@/lib/ai/context-builder";
import { ensureLocalContactSynced } from "@/lib/crm/contact-sync";
import { ensureConversationHistory, syncMessageFromWebhook } from "@/lib/ghl/sync";


async function getAuthenticatedLocation() {
    const location = await getLocationContext();
    if (!location?.ghlAccessToken) {
        throw new Error("Unauthorized or GHL not connected");
    }

    // Ensure token is fresh
    try {
        const refreshed = await refreshGhlAccessToken(location);
        return refreshed;
    } catch (e) {
        console.error("Failed to refresh token:", e);
        // Fallback to existing token if refresh fails (might be valid but API error)
        return location;
    }
}

export async function fetchConversations(status: 'open' | 'closed' | 'all' = 'all') {
    try {
        const location = await getAuthenticatedLocation();

        const where: any = { locationId: location.id };
        if (status !== 'all') where.status = status;

        // Check if we need to bootstrap (Empty DB)
        const count = await db.conversation.count({ where: { locationId: location.id } });

        if (count === 0 && location.ghlAccessToken && location.ghlLocationId) {
            console.log("Local conversation DB empty. Bootstrapping from GHL...");
            try {
                // Import dynamically to avoid circular deps if any, though likely safe
                const { syncConversationBatch } = await import("@/lib/ghl/sync");
                await syncConversationBatch(location.ghlAccessToken, location.ghlLocationId, location.id);
            } catch (syncErr) {
                console.error("Bootstrap sync failed:", syncErr);
            }
        }

        const conversations = await db.conversation.findMany({
            where,
            orderBy: { lastMessageAt: 'desc' },
            take: 50,
            include: { contact: { select: { name: true, email: true, phone: true } } }
        });

        // Map to UI format matching the GHL Conversation interface
        const mapped = conversations.map(c => ({
            id: c.ghlConversationId,
            contactId: c.contactId, // Internal ID, UI might expect GHL contact ID? Let's check usages. 
            // Actually `conversation.contactId` in GHL interface is GHL ID.
            // We should probably pass GHL Contact ID to avoid confusion if UI calls GHL API.
            // But we want to move away from GHL API.
            // Let's inspect `Conversation` interface in `lib/ghl/conversations.ts`.
            // It defines `contactId: string`.

            // For now, let's look up the GHL contact ID from the relation?
            // Fetching it in include.
        }));

        // Re-fetch with ghlContactId
        const conversationsWithGhlId = await db.conversation.findMany({
            where,
            orderBy: { lastMessageAt: 'desc' },
            take: 50,
            include: { contact: { select: { name: true, email: true, phone: true, ghlContactId: true } } }
        });

        // 2. Fetch Active Deals relevant to these conversations
        const activeDeals = await db.dealContext.findMany({
            where: {
                locationId: location.id,
                stage: 'ACTIVE',
                conversationIds: {
                    hasSome: conversationsWithGhlId.map(c => c.ghlConversationId)
                }
            },
            select: { id: true, title: true, conversationIds: true }
        });

        // Map conversation ID to Deal (first match, assuming one active deal per convo usually)
        const dealMap = new Map<string, { id: string, title: string }>();
        for (const deal of activeDeals) {
            for (const id of deal.conversationIds) {
                // If collision, first one wins or overwrite? Overwrite is fine.
                dealMap.set(id, { id: deal.id, title: deal.title });
            }
        }

        return {
            conversations: conversationsWithGhlId.map(c => ({
                id: c.ghlConversationId,
                contactId: c.contact.ghlContactId || c.contactId, // Fallback to internal ID if GHL ID missing
                contactName: c.contact.name || "Unknown",
                contactPhone: c.contact.phone || undefined,
                contactEmail: c.contact.email || undefined,
                lastMessageBody: c.lastMessageBody || "",
                lastMessageDate: Math.floor(c.lastMessageAt.getTime() / 1000),
                unreadCount: c.unreadCount,
                status: c.status as any,
                type: c.lastMessageType || 'TYPE_SMS',
                lastMessageType: c.lastMessageType || undefined,
                locationId: location.ghlLocationId || "",
                // Injected Deal Info
                activeDealId: dealMap.get(c.ghlConversationId)?.id,
                activeDealTitle: dealMap.get(c.ghlConversationId)?.title
            })),
            total: conversationsWithGhlId.length
        };
    } catch (error: any) {
        console.error("fetchConversations error:", error);
        return { conversations: [], total: 0 };
    }
}

export async function fetchMessages(conversationId: string) {
    const location = await getAuthenticatedLocation();

    // 1. Find the conversation first to get Contact/Location Context
    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: conversationId },
        include: { contact: true }
    });

    // If not found, it might be that we haven't synced the conversation list yet?
    // Or it's a new conversation.
    if (!conversation) {
        // Fallback: Return empty or try to fetch from API?
        // Let's try to return empty and let the 'ensure' logic handle it if called properly.
        return [];
    }

    // Ensure we have history (Auto-backfill if empty)
    if (conversation.contactId) {
        await ensureConversationHistory(conversation.contactId, location.id, location.ghlAccessToken!);
    }

    // [Evolution History Fetch] Pull messages from Evolution API if connected
    if (location.evolutionInstanceId && conversation.contact?.phone) {
        try {
            const { evolutionClient } = await import("@/lib/evolution/client");
            const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

            const phoneNumber = conversation.contact.phone.replace(/\D/g, '');
            const remoteJid = `${phoneNumber}@s.whatsapp.net`;

            console.log(`[History Fetch] Fetching messages for ${remoteJid}...`);
            const evolutionMessages = await evolutionClient.fetchMessages(location.evolutionInstanceId, remoteJid, 50);

            let synced = 0;
            for (const msg of evolutionMessages) {
                try {
                    const key = msg.key;
                    const messageContent = msg.message;
                    if (!messageContent || !key?.id) continue;

                    const isFromMe = key.fromMe;
                    const normalized: any = {
                        from: isFromMe ? location.id : phoneNumber,
                        to: isFromMe ? phoneNumber : location.id,
                        body: messageContent.conversation || messageContent.extendedTextMessage?.text || '[Media]',
                        type: 'text',
                        wamId: key.id,
                        timestamp: new Date(msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()),
                        direction: isFromMe ? 'outbound' : 'inbound',
                        source: 'whatsapp_evolution',
                        locationId: location.id,
                        contactName: msg.pushName
                    };

                    await processNormalizedMessage(normalized);
                    synced++;
                } catch (msgErr) {
                    // Skip individual message errors
                }
            }
            if (synced > 0) {
                console.log(`[History Fetch] Synced ${synced} messages for conversation ${conversationId}`);
            }
        } catch (e) {
            console.error("[History Fetch] Error fetching Evolution messages:", e);
        }
    }

    // 4. Fetch messages from DB
    const messages = await db.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' }
    });

    console.log(`[DB Read] Fetched ${messages.length} messages from local database for conversation ${conversation.ghlConversationId}`);

    return messages.map(m => ({
        id: m.ghlMessageId,
        conversationId: m.conversationId,
        contactId: conversation.contact.ghlContactId || '',
        body: m.body || '',
        type: m.type,
        direction: m.direction as 'inbound' | 'outbound',
        status: m.status,
        dateAdded: m.createdAt.toISOString(),
        subject: m.subject || undefined,
        // Hydrated fields for UI
        html: m.body?.includes('<') ? m.body : undefined // Simple check
    }));
}

export async function sendReply(conversationId: string, contactId: string, messageBody: string, type: 'SMS' | 'Email' | 'WhatsApp') {
    const location = await getAuthenticatedLocation();
    if (!location?.ghlAccessToken) {
        throw new Error("Unauthorized");
    }

    try {
        // Direct WhatsApp Integration Logic
        if (type === 'WhatsApp') {
            const hasTwilio = location.twilioAccountSid && location.twilioAuthToken && location.twilioWhatsAppFrom;
            const hasMeta = location.whatsappPhoneNumberId && location.whatsappAccessToken;
            // Relaxed check: Trust existence of ID. If status is mismatched in DB, we still try.
            // If it fails, the try/catch will handle it.
            const hasEvolution = !!location.evolutionInstanceId;

            console.log('[sendReply] WhatsApp send check:', {
                type,
                hasEvolution,
                evolutionInstanceId: location.evolutionInstanceId,
                evolutionConnectionStatus: location.evolutionConnectionStatus,
                hasTwilio,
                hasMeta
            });

            // Try Evolution API First (Shadow WhatsApp)
            if (hasEvolution) {
                const contact = await db.contact.findFirst({
                    where: {
                        OR: [
                            { ghlContactId: contactId },
                            { id: contactId }
                        ],
                        locationId: location.id
                    },
                    select: { id: true, phone: true, ghlContactId: true, name: true }
                });

                console.log('[sendReply] Evolution contact lookup:', { contactId, found: !!contact, phone: contact?.phone });

                if (!contact) {
                    return { success: false, error: "Contact not found in database." };
                }

                if (!contact.phone) {
                    return { success: false, error: "Contact does not have a phone number. Please add a phone number to this contact." };
                }

                // Check for masked phone numbers (agencies use *** to protect client data)
                if (contact.phone.includes('*')) {
                    const contactName = contact.name || 'This contact';
                    return {
                        success: false,
                        error: `${contactName}'s phone number "${contact.phone}" is masked (contains ***). Masked numbers are used by agencies to protect client data. You cannot send WhatsApp messages to masked numbers.`
                    };
                }

                // Normalize phone: strip non-digits but preserve for validation
                const normalizedPhone = contact.phone.replace(/\D/g, '');

                // WhatsApp requires full international format (country code + number)
                // Most international numbers are 10+ digits with country code
                if (normalizedPhone.length < 10) {
                    const contactName = contact.name || 'This contact';
                    return {
                        success: false,
                        error: `${contactName}'s phone number "${contact.phone}" appears to be missing a country code. Please update the contact with the full international number (e.g., +357${contact.phone}).`
                    };
                }

                try {
                    const { evolutionClient } = await import("@/lib/evolution/client");
                    console.log('[sendReply] Calling Evolution API sendMessage:', {
                        instanceId: location.evolutionInstanceId,
                        phone: normalizedPhone,
                        messageLength: messageBody.length
                    });

                    const res = await evolutionClient.sendMessage(
                        location.evolutionInstanceId!,
                        normalizedPhone,
                        messageBody
                    );

                    console.log('[sendReply] Evolution API response:', res);

                    if (res?.key?.id) {
                        // Direct DB Save (More robust than re-using webhook sync)
                        // This ensures we link to the EXACT conversation ID we are viewing
                        await db.message.create({
                            data: {
                                ghlMessageId: res.key.id,
                                conversation: { connect: { ghlConversationId: conversationId } },
                                body: messageBody,
                                type: 'TYPE_WHATSAPP',
                                direction: 'outbound',
                                status: 'sent',
                                createdAt: new Date(),
                                updatedAt: new Date(),
                                source: 'app_user'
                            }
                        });

                        // Update Conversation Last Message
                        await db.conversation.update({
                            where: { ghlConversationId: conversationId },
                            data: {
                                lastMessageBody: messageBody,
                                lastMessageAt: new Date(),
                                lastMessageType: 'TYPE_WHATSAPP',
                                status: 'open'
                            }
                        });

                        // [GHL Sync] Fire-and-forget sync to GHL
                        // We now use JIT contact creation to ensure GHL ID exists
                        const accessToken = location.ghlAccessToken;
                        if (accessToken) {
                            (async () => {
                                try {
                                    console.log('[sendReply] Starting GHL Sync process...');
                                    let targetGhlId = contact.ghlContactId;

                                    // JIT: Create remote contact if missing
                                    if (!targetGhlId) {
                                        console.log('[sendReply] Contact has no GHL ID. Importing ensureRemoteContact...');
                                        const { ensureRemoteContact } = await import("@/lib/crm/contact-sync");
                                        console.log('[sendReply] Attempting JIT creation for contact:', contact.id);

                                        if (location.ghlLocationId) {
                                            const newId = await ensureRemoteContact(contact.id, location.ghlLocationId, accessToken);
                                            if (newId) {
                                                targetGhlId = newId;
                                                console.log('[sendReply] JIT Creation successful. New GHL ID:', targetGhlId);
                                            } else {
                                                console.warn('[sendReply] JIT Creation failed or returned null.');
                                            }
                                        } else {
                                            console.warn('[sendReply] Cannot JIT Create: Missing ghlLocationId on Location.');
                                        }
                                    } else {
                                        console.log('[sendReply] Contact already has GHL ID:', targetGhlId);
                                    }

                                    if (targetGhlId) {
                                        console.log('[sendReply] Syncing sent message to GHL...');

                                        // Use Custom Channel if configured (Shadow WhatsApp)
                                        // This prevents "Unsuccessful" errors due to missing strictly native WhatsApp subscription
                                        const customProviderId = process.env.GHL_CUSTOM_PROVIDER_ID;

                                        const ghlPayload: any = {
                                            contactId: targetGhlId,
                                            type: customProviderId ? 'Custom' : 'WhatsApp',
                                            message: messageBody
                                        };

                                        if (customProviderId) {
                                            ghlPayload.conversationProviderId = customProviderId;
                                        }

                                        await sendMessage(accessToken, ghlPayload);
                                        console.log('[sendReply] Synced to GHL successfully.');
                                    } else {
                                        console.warn('[sendReply] Skipping GHL sync: Could not resolve GHL Contact ID.');
                                    }
                                } catch (ghlErr) {
                                    console.error('[sendReply] CRITICAL FAILURE in GHL Sync:', ghlErr);
                                }
                            })();
                        } else {
                            console.warn('[sendReply] No access token available for GHL sync.');
                        }

                        return { success: true };
                    } else {
                        return { success: false, error: "Message sent but no confirmation received." };
                    }
                } catch (err: any) {
                    console.error("Evolution API send failed:", err);
                    return { success: false, error: `WhatsApp send failed: ${err.message || 'Unknown error'}` };
                }
            }

            // Try Twilio or Meta Cloud API
            if (hasTwilio || hasMeta) {
                // 1. Resolve Contact Phone
                const contact = await db.contact.findFirst({
                    where: {
                        OR: [
                            { ghlContactId: contactId },
                            { id: contactId }
                        ],
                        locationId: location.id
                    },
                    select: { id: true, phone: true, ghlContactId: true }
                });

                if (contact?.phone) {
                    let externalMessageId: string | undefined;

                    try {
                        if (hasTwilio) {
                            const { sendTwilioMessage } = await import("@/lib/twilio/client");
                            const res = await sendTwilioMessage(location.id, contact.phone, { body: messageBody });
                            externalMessageId = res.sid;
                        } else {
                            const { sendWhatsAppMessage } = await import("@/lib/whatsapp/client");
                            const res = await sendWhatsAppMessage(location.id, contact.phone, { type: "text", body: messageBody });
                            externalMessageId = res.messages?.[0]?.id;
                        }
                    } catch (err) {
                        console.error("Direct WhatsApp send failed, falling back to GHL:", err);
                        // Fallthrough to GHL logic below
                    }

                    // If successful, save to DB and return (skipping GHL)
                    if (externalMessageId) {
                        const msgData = {
                            messageId: externalMessageId,
                            ghlMessageId: externalMessageId, // Use external ID as GHL ID placeholder
                            id: externalMessageId,
                            conversationId: conversationId,
                            contactId: contact.ghlContactId || contact.id, // Prefer GHL ID if available for consistency
                            body: messageBody,
                            type: 'TYPE_WHATSAPP',
                            direction: 'outbound',
                            status: 'sent',
                            dateAdded: new Date(),
                            locationId: location.ghlLocationId || location.id
                        };

                        await syncMessageFromWebhook(msgData);
                        return { success: true };
                    }
                }
            }

            // If we have Evolution but no phone found, or Evolution failed, don't fall through to GHL
            // GHL doesn't support WhatsApp messaging in this setup
            if (hasEvolution) {
                return { success: false, error: "Could not send WhatsApp message. Contact may not have a phone number." };
            }
        }

        // Default GHL Logic (Legacy / Fallback)
        const payload: any = {
            contactId,
            type,
        };

        if (type === 'Email') {
            // GHL Email requires 'html' field, not 'message'
            payload.html = messageBody.replace(/\n/g, '<br/>'); // Convert line breaks to HTML
            payload.subject = 'Re: Your Inquiry'; // TODO: Extract from conversation context

            // Set custom sender for professional appearance
            // NOTE: This only works if the emailFrom domain is verified in GHL Email Services
            // or if the user has configured a custom SMTP provider
            const locationEmail = (location as any).email || (location as any).ghlEmail;
            const locationName = location.name || location.domain;
            if (locationEmail) {
                payload.emailFrom = locationEmail;
            }
            if (locationName) {
                payload.emailFromName = locationName;
            }
        } else {
            // SMS and WhatsApp use 'message'
            payload.message = messageBody;
        }

        const res = await sendMessage(location.ghlAccessToken, payload);

        // Optimistic Sync: Save to DB immediately
        if (res?.messageId) {
            const messageId = res.messageId;
            // Construct message object
            const msgData = {
                messageId: messageId,
                ghlMessageId: messageId,
                id: messageId,
                conversationId: conversationId,
                contactId: contactId,
                body: type === 'Email' ? payload.html : payload.message,
                type: type === 'Email' ? 'TYPE_EMAIL' : 'TYPE_SMS', // TODO: Map type
                direction: 'outbound',
                status: 'sent', // Assume sent
                dateAdded: new Date(),
                locationId: location.ghlLocationId
            };
            // Call sync
            await syncMessageFromWebhook(msgData);
        }

        return { success: true };
    } catch (error) {
        console.error("sendMessage error:", error);
        return { success: false, error };
    }
}

export async function generateAIDraft(conversationId: string, contactId: string) {
    const location = await getAuthenticatedLocation();
    if (!location?.ghlAccessToken) {
        throw new Error("Unauthorized");
    }

    if (!location.ghlLocationId) {
        throw new Error("Misconfigured: Location has no GHL Location ID");
    }

    // [JIT Sync] Ensure contact exists locally before asking AI
    // Resolve GHL ID if possible, otherwise rely on local data
    const existingContact = await db.contact.findFirst({
        where: { OR: [{ id: contactId }, { ghlContactId: contactId }], locationId: location.id },
        select: { ghlContactId: true }
    });

    if (existingContact?.ghlContactId) {
        await ensureLocalContactSynced(existingContact.ghlContactId, location.id, location.ghlAccessToken);
    } else if (!existingContact) {
        // Assume it's a GHL ID and try to sync
        await ensureLocalContactSynced(contactId, location.id, location.ghlAccessToken);
    }

    // Use internal location.id (for SiteConfig lookup), not ghlLocationId (external GHL ID)
    const result = await generateDraft({
        conversationId,
        contactId,
        locationId: location.id, // CRITICAL: SiteConfig uses internal Location.id
        accessToken: location.ghlAccessToken
    });

    return result;
}

export async function createDealContext(title: string, conversationIds: string[]) {
    const location = await getAuthenticatedLocation();
    const accessToken = location.ghlAccessToken!;

    // Auto-detect properties from the contacts involved
    let propertyIds: string[] = [];
    try {
        // [JIT Sync] & Fetch Details
        // We sync ALL contacts in the deal to ensure we have their full data
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

        // 2. Find local Contacts and their Property Roles
        if (ghlContactIds.length > 0) {
            const contacts = await db.contact.findMany({
                where: {
                    ghlContactId: { in: ghlContactIds },
                    locationId: location.id
                },
                include: {
                    propertyRoles: {
                        select: { propertyId: true }
                    }
                }
            });

            // 3. Extract unique Property IDs
            const allPropIds = contacts.flatMap(c => c.propertyRoles.map(r => r.propertyId));
            propertyIds = Array.from(new Set(allPropIds));
        }
    } catch (e) {
        console.warn("Failed to auto-detect properties for Deal Context", e);
        // non-fatal, proceed with empty properties
    }

    // Create the DB record
    const dealContext = await db.dealContext.create({
        data: {
            title,
            locationId: location.id,
            conversationIds,
            propertyIds, // Auto-populated
            stage: 'ACTIVE'
        }
    });

    return dealContext;
}

// ... existing code ...

export async function generateMultiContextDraftAction(dealContextId: string, targetAudience: 'LEAD' | 'OWNER') {
    const location = await getAuthenticatedLocation();

    if (!location.ghlAccessToken) throw new Error("Unauthorized");

    return generateMultiContextDraft({
        dealContextId,
        targetAudience,
        accessToken: location.ghlAccessToken
    });
}

export async function getContactContext(contactId: string) {
    const location = await getAuthenticatedLocation();

    if (!contactId || contactId === 'unknown') return null;

    // 1. Try to resolve locally first (as ID or GHL ID)
    let contact = await db.contact.findFirst({
        where: {
            OR: [
                { id: contactId },
                { ghlContactId: contactId }
            ],
            locationId: location.id
        },
        include: {
            propertyRoles: {
                include: {
                    property: {
                        select: {
                            id: true,
                            title: true,
                            reference: true,
                            price: true
                        }
                    }
                }
            },
            viewings: {
                take: 5,
                orderBy: { date: 'desc' },
                include: {
                    property: { select: { title: true } }
                }
            }
        }
    });

    // 2. If found locally and has GHL ID, try to Refresh (JIT Sync)
    // We wrap this in try-catch so we don't block the UI if GHL is down/slow
    if (contact && contact.ghlContactId) {
        try {
            await ensureLocalContactSynced(contact.ghlContactId, location.id, location.ghlAccessToken!);
        } catch (e) {
            console.warn("[getContactContext] JIT Sync refresh failed, returning local data:", e);
        }
    }

    // 3. If NOT found locally, assume it's a GHL ID and try to import it
    if (!contact) {
        try {
            const synced = await ensureLocalContactSynced(contactId, location.id, location.ghlAccessToken!);
            if (synced) {
                // Re-fetch with full includes
                contact = await db.contact.findUnique({
                    where: { id: synced.id },
                    include: {
                        propertyRoles: {
                            include: {
                                property: {
                                    select: {
                                        id: true,
                                        title: true,
                                        reference: true,
                                        price: true
                                    }
                                }
                            }
                        },
                        viewings: {
                            take: 5,
                            orderBy: { date: 'desc' },
                            include: {
                                property: { select: { title: true } }
                            }
                        }
                    }
                });
            }
        } catch (e) {
            console.error("[getContactContext] Failed to resolve contact from GHL ID:", e);
        }
    }

    // Fetch Lead Sources for the Edit Form
    const leadSources = await db.leadSource.findMany({
        where: { locationId: location.id, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' }
    });


    return {
        contact,
        leadSources: leadSources.map(s => s.name)
    };
}

// Helper to get location without strict GHL requirement
async function getBasicLocationContext() {
    const location = await getLocationContext();
    if (!location) {
        throw new Error("Unauthorized");
    }
    return location;
}

export async function getEvolutionStatus() {
    // Relaxed Auth: Don't require GHL token just to check WhatsApp status
    const location = await getBasicLocationContext();
    const instanceName = location.id;

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        let instance = await evolutionClient.fetchInstance(instanceName);

        // Auto-Revival Logic:
        // If Evolution API restarted, it might forget the instance handle but keep the session on disk.
        // If we get NOT_FOUND, we try to "revive" it by calling createInstance.
        if (!instance) {
            console.log(`Instance ${instanceName} not found. Attempting to revive...`);
            try {
                // Determine webhook URL
                const origin = process.env.APP_BASE_URL || 'https://estio.co';
                const webhookUrl = `${origin}/api/webhooks/evolution`;

                // Try to create (which loads from disk if exists)
                // We use a simplified call here implicitly relying on client.ts default behavior
                // But the client.ts `createInstance` is robust enough.
                const reviveRes = await evolutionClient.createInstance(location.id, instanceName);
                if (reviveRes) {
                    console.log(`Instance ${instanceName} revived successfully.`);
                    // Use the result as the instance
                    instance = reviveRes;
                }
            } catch (reviveError) {
                console.warn(`Failed to revive instance ${instanceName}:`, reviveError);
            }
        }

        // Map status
        let status = 'UNKNOWN';
        let qrcode = null;

        if (!instance) {
            status = 'NOT_FOUND';
        } else {
            // Evolution v2 structure might vary, check common paths
            // Revive response might be the instance object itself or have .instance
            // Also handle the case where it returns { connectionStatus: 'open' } directly (as seen in logs)
            const rawStatus = instance.instance?.status
                || (instance as any).status
                || (instance as any).connectionStatus
                || 'UNKNOWN';

            status = rawStatus;
        }

        // CRITICAL FIX: Update the Database with the real status
        // This ensures Settings page stays in sync with what we see here
        // SPLIT-BRAIN FIX: Only update status if running in PRODUCTION to avoid Local overwriting it
        if (process.env.NODE_ENV === 'production') {
            if (location.evolutionConnectionStatus !== status) {
                await db.location.update({
                    where: { id: location.id },
                    data: { evolutionConnectionStatus: status }
                }).catch(err => console.error("Failed to sync evolution status to DB:", err));
            }
        } else {
            console.log(`[getEvolutionStatus] Skipped DB update for status '${status}' (Local Dev Mode)`);
        }

        // If not connected, try to get QR code (but do not aggressively create instance just on check)
        // Only fetch QR if we are explicitly in a connecting state or if the user requested it?
        // Actually, if it's 'close', we usually might want to show QR if it's available.
        // But merely calling this shouldn't trigger a full connection flow unless necessary.
        // Let's just check if there is a QR in the fetch response first.

        if (instance?.qrcode?.base64) {
            qrcode = instance.qrcode.base64;
        }

        return { status, qrcode };
    } catch (error) {
        console.error("getEvolutionStatus error:", error);
        return { status: 'ERROR', qrcode: null };
    }
}

export async function triggerWhatsAppConnection() {
    // Relaxed Auth
    const location = await getBasicLocationContext();
    const instanceName = location.id;

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");

        // 1. Create if not exists (Idempotent-ish)
        let qrCodeBase64 = null;
        try {
            const createRes = await evolutionClient.createInstance(location.id, instanceName);
            if (createRes?.qrcode?.base64) {
                qrCodeBase64 = createRes.qrcode.base64;
            }
        } catch (e) {
            console.log("Instance might already exist, proceeding to connect...");
        }

        // 2. Connect
        if (!qrCodeBase64) {
            // Try explicit connect to generate QR
            try {
                const connectRes = await evolutionClient.connectInstance(instanceName);
                if (connectRes?.base64 || connectRes?.qrcode?.base64) {
                    qrCodeBase64 = connectRes.base64 || connectRes.qrcode.base64;
                }
            } catch (e) {
                console.warn("Connect instance warning:", e);
            }
        }

        // 3. Update DB
        await db.location.update({
            where: { id: location.id },
            data: {
                evolutionInstanceId: instanceName,
                // We don't set status to 'open' yet, we wait for the poll to find it
            }
        });

        // 4. Return result
        return {
            success: true,
            qrCode: qrCodeBase64,
            status: qrCodeBase64 ? 'qrcode' : 'connecting'
        };

    } catch (error: any) {
        console.error("triggerWhatsAppConnection error:", error);
        return { success: false, error: error.message };
    }
}

export async function resendMessage(messageId: string) {
    const location = await getAuthenticatedLocation();

    // 1. Fetch Message
    const message = await db.message.findFirst({
        where: {
            OR: [
                { id: messageId },
                { ghlMessageId: messageId }
            ],
            conversation: { locationId: location.id } // Security Check
        },
        include: { conversation: { include: { contact: true } } }
    });

    if (!message) {
        return { success: false, error: "Message not found" };
    }

    if (message.direction === 'inbound') {
        return { success: false, error: "Cannot resend inbound messages" };
    }

    const contact = message.conversation.contact;
    if (!contact || !contact.phone) {
        return { success: false, error: "Contact phone not found" };
    }

    // 2. Determine Transport (Same Logic as sendReply)
    const hasEvolution = !!location.evolutionInstanceId;

    if (message.type === 'TYPE_WHATSAPP' && hasEvolution) {
        try {
            const { evolutionClient } = await import("@/lib/evolution/client");
            const normalizedPhone = contact.phone.replace(/\D/g, '');

            console.log(`[resendMessage] Retrying wamId ${message.wamId || 'new'} via Evolution...`);

            const res = await evolutionClient.sendMessage(
                location.evolutionInstanceId!,
                normalizedPhone,
                message.body || ''
            );

            if (res?.key?.id) {
                // Update Existing or Create New?
                // Creating new avoids confusion, but for "Retry" UI typically we want to update the failed one if it never sent.
                // But wamId changes. So we should probably mark old as failed/retried and create new.
                // OR update the existing record with new wamId.

                await db.message.update({
                    where: { id: message.id },
                    data: {
                        wamId: res.key.id, // Update WAM ID
                        status: 'sent',
                        updatedAt: new Date(),
                        // error: null // Clear previous errors if any (field not in schema yet)
                    }
                });

                return { success: true };
            }
        } catch (err: any) {
            console.error("Resend failed:", err);
            return { success: false, error: err.message };
        }
    }

    return { success: false, error: "Unsupported message type or transport unavailable" };
}

// --- AI Autonomous Agent Action ---
export async function runAgentAction(conversationId: string, contactId: string) {
    const location = await getAuthenticatedLocation();

    // 1. Fetch conversation history
    const conversation = await db.conversation.findFirst({
        where: {
            ghlConversationId: conversationId,
            locationId: location.id,
            contactId
        },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 30 } }
    });

    if (!conversation) {
        return { success: false, error: "Conversation not found" };
    }

    // 2. Format history for Agent
    const historyText = conversation.messages.map(m =>
        `${m.direction === 'outbound' ? 'Agent' : 'Lead'}: ${m.body}`
    ).join("\n");

    // 3. Run Agent
    try {
        const { runAgent } = await import('@/lib/ai/agent');
        const result = await runAgent(contactId, location.id, historyText);

        return {
            success: result.success,
            thought: result.thought,
            draft: result.draft,
            actions: result.actions,
            error: result.message
        };
    } catch (e: any) {
        console.error("[runAgentAction] Failed:", e);
        return { success: false, error: e.message };
    }
}

