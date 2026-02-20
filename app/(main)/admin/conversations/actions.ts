'use server';

import { getLocationContext } from "@/lib/auth/location-context";
import { getConversations, getMessages, getConversation, sendMessage, getMessage, Conversation, Message } from "@/lib/ghl/conversations";
import { generateDraft } from "@/lib/ai/coordinator";
import { refreshGhlAccessToken } from "@/lib/location";
import db from "@/lib/db";
import { generateMultiContextDraft } from "@/lib/ai/context-builder";
import { ensureLocalContactSynced } from "@/lib/crm/contact-sync";
import { ensureConversationHistory, syncMessageFromWebhook } from "@/lib/ghl/sync";
import { calculateRunCost } from "@/lib/ai/pricing";
import { z } from "zod";
import { getModelForTask } from "@/lib/ai/model-router";
import { callLLM } from "@/lib/ai/llm";

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

export async function fetchConversations(status: 'active' | 'archived' | 'trash' | 'all' = 'active') {
    try {
        const location = await getAuthenticatedLocation();

        const where: any = { locationId: location.id };

        // Apply soft delete and archive filters
        if (status === 'active') {
            // Active conversations: not deleted and not archived
            where.deletedAt = null;
            where.archivedAt = null;
        } else if (status === 'archived') {
            // Archived conversations: not deleted but archived
            where.deletedAt = null;
            where.archivedAt = { not: null };
        } else if (status === 'trash') {
            // Trash: only deleted conversations
            where.deletedAt = { not: null };
        }
        // 'all' applies no filter (shows everything)

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

        // 1. Fetch Conversations from DB
        // We fetch with ghlContactId to potentially simplify mapping


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
                    hasSome: conversationsWithGhlId.map((c: any) => c.ghlConversationId)
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
            conversations: conversationsWithGhlId.map((c: any) => ({
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
                activeDealTitle: dealMap.get(c.ghlConversationId)?.title,
                suggestedActions: c.suggestedActions || []
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

    // [Evolution History Fetch] Removed automatic fetch on read to improve performance.
    // Use syncWhatsAppHistory(conversationId) for manual sync.



    // 4. Fetch messages from DB
    const messages = await db.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' }
    });

    console.log(`[DB Read] Fetched ${messages.length} messages from local database for conversation ${conversation.ghlConversationId}`);


    return messages.map((m: any) => ({
        id: m.id, // Use internal CUID
        ghlMessageId: m.ghlMessageId, // Optional
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

export async function syncWhatsAppHistory(conversationId: string, limit: number = 20, ignoreDuplicates: boolean = false, offset: number = 0) {
    const location = await getAuthenticatedLocation();

    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: conversationId },
        include: { contact: true }
    });

    if (!conversation) return { success: false, error: "Conversation not found" };
    if (!location.evolutionInstanceId) return { success: false, error: "WhatsApp not connected" };
    if (!conversation.contact?.phone) return { success: false, error: "Contact has no phone number" };

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

        const phone = conversation.contact.phone.replace(/\D/g, '');

        let remoteJid = `${phone}@s.whatsapp.net`;
        const isGroup = conversation.contact.contactType === 'WhatsAppGroup' || conversation.contact.phone.includes('@g.us');

        if (isGroup) {
            remoteJid = `${phone}@g.us`;
        }

        const fetchLimit = limit || 50;
        console.log(`[Sync] Fetching messages for ${remoteJid} (Limit: ${fetchLimit}, Offset: ${offset}, IgnoreDupes: ${ignoreDuplicates})...`);
        const evolutionMessages = await evolutionClient.fetchMessages(location.evolutionInstanceId, remoteJid, fetchLimit, offset);

        let synced = 0;
        let skipped = 0;
        let consecutiveDuplicates = 0;
        const STOP_ON_DUPLICATES = 5;

        for (const msg of evolutionMessages) {
            try {
                const key = msg.key;
                const messageContent = msg.message;
                if (!messageContent || !key?.id) continue;

                const isFromMe = key.fromMe;

                // Detect group chat
                const isGroup = key.remoteJid?.includes('@g.us') || false;

                // Enhanced Participant Resolution (LID Fix)
                const realSenderPhone = (msg as any).senderPn || (key.participant?.includes('@s.whatsapp.net') ? key.participant.replace('@s.whatsapp.net', '') : null);
                let participantPhone = realSenderPhone || (key.participant ? key.participant.replace('@s.whatsapp.net', '').replace('@lid', '') : undefined);

                // For group messages, the participant is the sender; for 1:1, it's the phone from the contact
                // We use the Group Phone for 'from' to keep the conversation unified.
                // The participant field identifies the actual sender.

                const normalized: any = {
                    from: isFromMe ? location.id : phone,
                    to: isFromMe ? phone : location.id,
                    body: messageContent.conversation || messageContent.extendedTextMessage?.text || '[Media]',
                    type: 'text',
                    wamId: key.id,
                    timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                    direction: isFromMe ? 'outbound' : 'inbound',
                    source: 'whatsapp_evolution',
                    locationId: location.id,
                    contactName: isGroup ? undefined : (msg.pushName || realSenderPhone), // Don't rename group to sender name
                    isGroup: isGroup,
                    participant: participantPhone // Pass resolved participant to sync
                };

                const result = await processNormalizedMessage(normalized);

                if (result?.status === 'skipped') {
                    skipped++;
                    consecutiveDuplicates++;
                } else {
                    synced++;
                    consecutiveDuplicates = 0;
                }

                if (!ignoreDuplicates && consecutiveDuplicates >= STOP_ON_DUPLICATES) {
                    console.log(`[Sync] Stopped after ${consecutiveDuplicates} consecutive duplicates.`);
                    break;
                }
            } catch (msgErr) {
                // Skip
            }
        }

        return { success: true, count: synced, skipped };
    } catch (e: any) {
        console.error("Manual sync failed:", e);
        return { success: false, error: e.message };
    }
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

                    // Verify connection is actually alive (DB status can be stale)
                    const instanceState = await evolutionClient.fetchInstance(location.evolutionInstanceId!);
                    // Handle different response structures (array or object)
                    const instanceData = Array.isArray(instanceState) ? instanceState[0] : instanceState;
                    const connStatus = instanceData?.instance?.connectionStatus || instanceData?.connectionStatus || instanceData?.status;

                    if (connStatus !== 'open') {
                        console.warn(`[sendReply] Aborting send: WhatsApp instance ${location.evolutionInstanceId} is not connected (Status: ${connStatus})`);
                        return {
                            success: false,
                            error: `WhatsApp is disconnected (Status: ${connStatus || 'unknown'}). Please reconnect in Settings → WhatsApp.`
                        };
                    }

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
                                wamId: res.key.id, // CRITICAL: Store wamId so sync.ts dedup check works
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

                        // Unified Update Logic
                        const { updateConversationLastMessage } = await import('@/lib/conversations/update');

                        // We need the internal ID
                        const internalConv = await db.conversation.findUnique({
                            where: { ghlConversationId: conversationId },
                            select: { id: true }
                        });

                        if (internalConv) {
                            await updateConversationLastMessage({
                                conversationId: internalConv.id,
                                messageBody: messageBody,
                                messageType: 'TYPE_WHATSAPP',
                                messageDate: new Date(),
                                direction: 'outbound',
                                // Outbound does not increment unread count by default
                            });
                        }

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

export async function generateAIDraft(conversationId: string, contactId: string, instruction?: string, model?: string) {
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
        accessToken: location.ghlAccessToken,
        instruction,
        model
    });

    return result;
}

export async function orchestrateAction(conversationId: string, contactId: string, dealStage?: string) {
    const location = await getAuthenticatedLocation();

    // Resolve real conversation DB ID (AgentExecution FK requires Conversation.id, not ghlConversationId)
    const conversation = await db.conversation.findFirst({
        where: {
            ghlConversationId: conversationId,
            locationId: location.id
        },
        select: { id: true, contactId: true }
    });

    if (!conversation) {
        throw new Error(`Conversation not found for ghlConversationId: ${conversationId}`);
    }

    // Canonicalize contact ID to local DB Contact.id.
    // UI sometimes passes GHL contact IDs; tools and tracing require local IDs.
    let resolvedContactId = conversation.contactId;
    if (contactId && contactId !== conversation.contactId) {
        const mapped = await db.contact.findFirst({
            where: {
                locationId: location.id,
                OR: [{ id: contactId }, { ghlContactId: contactId }]
            },
            select: { id: true }
        });
        if (mapped?.id) resolvedContactId = mapped.id;
    }

    // Fetch conversation history
    const messages = await db.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        take: 20
    });

    if (messages.length === 0) {
        throw new Error("No messages found in conversation");
    }

    const lastMessage = messages[messages.length - 1];

    const history = messages.map(m => `${m.direction === 'inbound' ? 'User' : 'Agent'}: ${m.body}`).join("\n");

    // Dynamic import to avoid build-time circular deps if any (though standard import is likely fine)
    const { orchestrate } = await import("@/lib/ai/orchestrator");

    const result = await orchestrate({
        conversationId: conversation.id, // Use real DB ID, not ghlConversationId
        contactId: resolvedContactId,
        message: lastMessage.body || "",
        conversationHistory: history,
        dealStage
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
            const allPropIds = contacts.flatMap((c: any) => c.propertyRoles.map((r: any) => r.propertyId));
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
        leadSources: leadSources.map((s: any) => s.name)
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

export async function getAvailableAiModelsAction() {
    const location = await getBasicLocationContext();
    const { getAvailableModels } = await import("@/lib/ai/fetch-models");
    return getAvailableModels(location.id);
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
                }).catch((err: any) => console.error("Failed to sync evolution status to DB:", err));
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


// --- AI Planner Actions ---

export async function generatePlanAction(conversationId: string, contactId: string, goal: string) {
    const location = await getAuthenticatedLocation();

    // 1. Fetch History
    const conversation = await db.conversation.findFirst({
        where: { ghlConversationId: conversationId, locationId: location.id },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 30 } }
    });

    if (!conversation) return { success: false, error: "Conversation not found" };

    const historyText = conversation.messages.map((m: any) =>
        `${m.direction === 'outbound' ? 'Agent' : 'Lead'}: ${m.body}`
    ).join("\n");

    try {
        const { generateAgentPlan } = await import('@/lib/ai/agent');
        const result = await generateAgentPlan(contactId, location.id, historyText, goal);

        if (result.success && result.plan) {
            // Calculate Cost
            const runCost = calculateRunCost(
                result.usage?.model || 'default',
                result.usage?.promptTokenCount || 0,
                result.usage?.candidatesTokenCount || 0
            );

            // Update Conversation Stats & Save Plan
            await db.conversation.update({
                where: { id: conversation.id },
                data: {
                    agentPlan: result.plan,
                    promptTokens: { increment: result.usage?.promptTokenCount || 0 },
                    completionTokens: { increment: result.usage?.candidatesTokenCount || 0 },
                    totalTokens: { increment: result.usage?.totalTokenCount || 0 },
                    totalCost: { increment: runCost }
                } as any
            });

            // Log Execution Trace for History
            await db.agentExecution.create({
                data: {
                    conversationId: conversation.id,
                    taskId: 'PLANNING', // Special ID for planning phase
                    taskTitle: "Generate Mission Plan",
                    taskStatus: "done",
                    thoughtSummary: result.thought || "Generated new mission plan based on goal.",
                    thoughtSteps: [], // Planner doesn't return steps currently
                    toolCalls: [],
                    draftReply: null,
                    promptTokens: result.usage?.promptTokenCount,
                    completionTokens: result.usage?.candidatesTokenCount,
                    totalTokens: result.usage?.totalTokenCount,
                    model: result.usage?.model,
                    cost: runCost
                }
            });

            return { success: true, plan: result.plan, thought: result.thought };
        } else {
            return { success: false, error: "Failed to generate plan" };
        }
    } catch (e: any) {
        console.error("Plan Action Failed", e);
        return { success: false, error: e.message };
    }
}

export async function executeNextTaskAction(conversationId: string, contactId: string) {
    const location = await getAuthenticatedLocation();

    // 1. Fetch Plan
    const conversation = await db.conversation.findFirst({
        where: { ghlConversationId: conversationId, locationId: location.id },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 30 } }
    });

    if (!conversation || !(conversation as any).agentPlan) return { success: false, error: "No plan found" };

    const plan = (conversation as any).agentPlan as any[];
    const nextTask = plan.find(t => t.status === 'pending');

    if (!nextTask) return { success: false, message: "All tasks completed!" };

    // 2. Mark In-Progress
    nextTask.status = 'in-progress';
    await db.conversation.update({
        where: { id: conversation.id },
        data: { agentPlan: plan } as any
    });

    const historyText = conversation.messages.map((m: any) =>
        `${m.direction === 'outbound' ? 'Agent' : 'Lead'}: ${m.body}`
    ).join("\n");

    // 3. Execute
    try {
        const { executeAgentTask } = await import('@/lib/ai/agent');
        const result = await executeAgentTask(contactId, location.id, historyText, nextTask, plan);

        if (result.success) {
            // 4. Update Task Status
            if (result.taskCompleted) {
                nextTask.status = 'done';
                nextTask.result = result.taskResult || "Completed";
            } else {
                nextTask.status = 'pending';
                nextTask.result = "Partial: " + result.taskResult;
            }

            const runCost = calculateRunCost(
                result.usage?.model || 'default',
                result.usage?.promptTokenCount || 0,
                result.usage?.candidatesTokenCount || 0
            );

            let updatedConversation = await db.conversation.update({
                where: { id: conversation.id },
                data: {
                    agentPlan: plan,
                    promptTokens: { increment: result.usage?.promptTokenCount || 0 },
                    completionTokens: { increment: result.usage?.candidatesTokenCount || 0 },
                    totalTokens: { increment: result.usage?.totalTokenCount || 0 },
                    totalCost: { increment: runCost }
                } as any
            });

            // Self-healing: If totals were 0 (pre-tracking) but we have history, recalculate everything
            if (conversation.totalTokens === 0) {
                const allExecs = await db.agentExecution.findMany({
                    where: { conversationId: conversation.id }
                });

                const totalPrompt = allExecs.reduce((acc, e) => acc + (e.promptTokens || 0), 0) + (result.usage?.promptTokenCount || 0);
                const totalCompletion = allExecs.reduce((acc, e) => acc + (e.completionTokens || 0), 0) + (result.usage?.candidatesTokenCount || 0);
                const totalToks = totalPrompt + totalCompletion;

                // Recalculate cost (approximate for old runs if model not saved, assume default/current)
                // For new run we have exact cost. For old runs, we might not have cost saved.
                // But we can try to estimate if we had model, or just leave it as is.
                // Actually, let's just sum up tokens properly.

                // If we want to backfill cost for old runs:
                let historicalCost = 0;
                for (const ex of allExecs) {
                    // If cost already saved, use it. Else calculate.
                    if (ex.cost) {
                        historicalCost += ex.cost;
                    } else if (ex.promptTokens || ex.completionTokens) {
                        historicalCost += calculateRunCost(ex.model || 'default', ex.promptTokens || 0, ex.completionTokens || 0);
                    }
                }
                historicalCost += runCost; // Add current run

                updatedConversation = await db.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        promptTokens: totalPrompt,
                        completionTokens: totalCompletion,
                        totalTokens: totalToks,
                        totalCost: historicalCost
                    }
                });
            }

            // Save execution to history
            await db.agentExecution.create({
                data: {
                    conversationId: conversation.id,
                    taskId: nextTask.id,
                    taskTitle: nextTask.title,
                    taskStatus: nextTask.status,
                    thoughtSummary: result.thoughtSummary,
                    thoughtSteps: result.thoughtSteps,
                    toolCalls: result.actions,
                    draftReply: result.draft,
                    promptTokens: result.usage?.promptTokenCount,
                    completionTokens: result.usage?.candidatesTokenCount,
                    totalTokens: result.usage?.totalTokenCount,
                    model: result.usage?.model,
                    cost: runCost
                }
            });

            return {
                success: true,
                task: nextTask,
                draft: result.draft,
                thoughtSummary: result.thoughtSummary,
                thoughtSteps: result.thoughtSteps,
                actions: result.actions,
                usage: result.usage,
                conversationUsage: {
                    promptTokens: updatedConversation.promptTokens,
                    completionTokens: updatedConversation.completionTokens,
                    totalTokens: updatedConversation.totalTokens,
                    totalCost: updatedConversation.totalCost
                }
            };
        } else {
            nextTask.status = 'failed';
            await db.conversation.update({
                where: { id: conversation.id },
                data: { agentPlan: plan } as any
            });
            return { success: false, error: result.message };
        }

    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getAgentPlan(conversationId: string) {
    const location = await getAuthenticatedLocation();
    const conversation = await db.conversation.findFirst({
        where: { ghlConversationId: conversationId, locationId: location.id },
        select: {
            agentPlan: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true
        } as any
    });

    if (!conversation) return null;

    return {
        plan: (conversation as any).agentPlan,
        usage: {
            promptTokens: (conversation as any).promptTokens || 0,
            completionTokens: (conversation as any).completionTokens || 0,
            totalTokens: (conversation as any).totalTokens || 0
        }
    };
}

// [Updated] Return full tracing fields
export async function getAgentExecutions(conversationId: string) {
    const location = await getAuthenticatedLocation();
    const conversation = await db.conversation.findFirst({
        where: { ghlConversationId: conversationId, locationId: location.id },
        select: { id: true }
    });

    if (!conversation) return [];

    // Fetch root spans (where parentSpanId is null OR spanId == traceId)
    // The current schema treats AgentExecution as a flattened span log. 
    // We want the 'Root' entries which usually correspond to 'runAgent' or top-level tasks.
    const executions = await db.agentExecution.findMany({
        where: {
            conversationId: conversation.id,
            // Simple heuristic for root spans: parentSpanId is null
            parentSpanId: null
        },
        orderBy: { createdAt: 'desc' },
        take: 20
    });

    const parseJsonField = (value: any, fallback: any) => {
        if (value == null) return fallback;
        if (typeof value === "string") {
            try {
                return JSON.parse(value);
            } catch {
                return fallback;
            }
        }
        return value;
    };

    return executions.map(e => ({
        id: e.id,
        traceId: e.traceId,
        spanId: e.spanId,
        taskId: e.taskId,
        taskTitle: e.taskTitle,
        taskStatus:
            e.taskStatus === "done" ? "success" :
                e.taskStatus === "failed" ? "error" :
                    e.taskStatus || (e.status === "success" ? "success" : e.status === "error" ? "error" : e.status),
        thoughtSummary: e.thoughtSummary,
        thoughtSteps: parseJsonField(e.thoughtSteps, []),
        toolCalls: parseJsonField(e.toolCalls, []),
        draftReply: e.draftReply,
        usage: {
            promptTokenCount: e.promptTokens,
            candidatesTokenCount: e.completionTokens,
            totalTokenCount: e.totalTokens,
            cost: e.cost,
            model: e.model
        },
        latencyMs: e.latencyMs,
        errorMessage: e.errorMessage,
        createdAt: e.createdAt.toISOString()
    }));
}

import { getTrace } from "@/lib/ai/tracing-queries";

export async function getTraceTreeAction(traceId: string) {
    const location = await getAuthenticatedLocation();
    if (!location) throw new Error("Unauthorized");
    return getTrace(traceId);
}

export async function getContactInsightsAction(contactId: string) {
    const location = await getAuthenticatedLocation();

    // Resolve contact ID first (could be GHL ID)
    const contact = await db.contact.findFirst({
        where: {
            OR: [{ id: contactId }, { ghlContactId: contactId }],
            locationId: location.id
        },
        select: { id: true }
    });

    if (!contact) return [];

    return db.insight.findMany({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
}

/**
 * Get aggregate AI usage across all conversations for the current location.
 * Returns usage broken down by time period (today, this month, all-time)
 * and top conversations for the detailed modal.
 */
export async function getAggregateAIUsage() {
    try {
        const location = await getLocationContext();
        if (!location) {
            return {
                today: { totalTokens: 0, totalCost: 0 },
                thisMonth: { totalTokens: 0, totalCost: 0 },
                allTime: { totalTokens: 0, totalCost: 0, conversationCount: 0 },
                topConversations: []
            };
        }

        // Calculate date boundaries
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Aggregate from AgentExecution for time-based filtering (more accurate)
        const [todayUsage, monthUsage, allTimeUsage, topConversations] = await Promise.all([
            // Today's usage
            db.agentExecution.aggregate({
                where: {
                    conversation: { locationId: location.id },
                    createdAt: { gte: startOfToday }
                },
                _sum: {
                    totalTokens: true,
                    cost: true
                }
            }),
            // This month's usage
            db.agentExecution.aggregate({
                where: {
                    conversation: { locationId: location.id },
                    createdAt: { gte: startOfMonth }
                },
                _sum: {
                    totalTokens: true,
                    cost: true
                }
            }),
            // All-time usage (from Conversation for efficiency)
            db.conversation.aggregate({
                where: { locationId: location.id },
                _sum: {
                    totalTokens: true,
                    totalCost: true
                },
                _count: {
                    id: true
                }
            }),
            // Top conversations by cost (for modal breakdown)
            db.conversation.findMany({
                where: {
                    locationId: location.id,
                    totalCost: { gt: 0 }
                },
                orderBy: { totalCost: 'desc' },
                take: 10,
                select: {
                    id: true,
                    ghlConversationId: true,
                    totalTokens: true,
                    totalCost: true,
                    lastMessageAt: true,
                    contact: {
                        select: {
                            name: true,
                            email: true
                        }
                    }
                }
            })
        ]);

        return {
            today: {
                totalTokens: todayUsage._sum.totalTokens || 0,
                totalCost: todayUsage._sum.cost || 0
            },
            thisMonth: {
                totalTokens: monthUsage._sum.totalTokens || 0,
                totalCost: monthUsage._sum.cost || 0
            },
            allTime: {
                totalTokens: allTimeUsage._sum.totalTokens || 0,
                totalCost: allTimeUsage._sum.totalCost || 0,
                conversationCount: allTimeUsage._count.id || 0
            },
            topConversations: topConversations.map(c => ({
                id: c.id,
                conversationId: c.ghlConversationId,
                contactName: c.contact?.name || 'Unknown',
                contactEmail: c.contact?.email,
                totalTokens: c.totalTokens,
                totalCost: c.totalCost,
                lastMessageAt: c.lastMessageAt.toISOString()
            }))
        };
    } catch (e) {
        console.error('[getAggregateAIUsage] Error:', e);
        return {
            today: { totalTokens: 0, totalCost: 0 },
            thisMonth: { totalTokens: 0, totalCost: 0 },
            allTime: { totalTokens: 0, totalCost: 0, conversationCount: 0 },
            topConversations: []
        };
    }
}


export async function refreshConversation(conversationId: string) {
    const location = await getAuthenticatedLocation();

    // Fetch from DB to get latest fields like suggestedActions
    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: conversationId },
        include: { contact: true }
    });

    if (!conversation) return null;

    // Map to UI format (Conversation interface)
    return {
        id: conversation.ghlConversationId,
        contactId: conversation.contact.ghlContactId || conversation.contactId,
        contactName: conversation.contact.name || "Unknown",
        contactPhone: conversation.contact.phone || undefined,
        contactEmail: conversation.contact.email || undefined,
        lastMessageBody: conversation.lastMessageBody || "",
        lastMessageDate: Math.floor(conversation.lastMessageAt.getTime() / 1000),
        unreadCount: conversation.unreadCount,
        status: conversation.status as any,
        type: conversation.lastMessageType || 'TYPE_SMS',
        lastMessageType: conversation.lastMessageType || undefined,
        locationId: location.ghlLocationId || "",
        suggestedActions: conversation.suggestedActions || []
    };
}

export async function deleteConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocation();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Soft Delete: Mark conversations as deleted instead of removing them
        // This allows users to restore them from the trash within 30 days
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id, // Security check to ensure ownership
                deletedAt: null // Only delete non-deleted conversations (prevent double-delete)
            },
            data: {
                deletedAt: new Date(),
                // Note: deletedBy would require user context from auth
                // For now, we'll track via deletedAt timestamp only
            }
        });

        console.log(`[Soft Delete] Moved ${result.count} conversations to trash.`);
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("deleteConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function restoreConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocation();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Restore: Remove deletedAt timestamp to bring back from trash
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id,
                deletedAt: { not: null } // Only restore deleted conversations
            },
            data: {
                deletedAt: null,
                deletedBy: null
            }
        });

        console.log(`[Restore] Restored ${result.count} conversations from trash.`);
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("restoreConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function permanentlyDeleteConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocation();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Hard Delete: Permanently remove from database
        // Can only delete conversations that are already in trash (have deletedAt)
        const result = await db.conversation.deleteMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id,
                deletedAt: { not: null } // Security: Only allow permanent deletion of trashed items
            }
        });

        console.log(`[Permanent Delete] Permanently deleted ${result.count} conversations.`);
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("permanentlyDeleteConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function archiveConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocation();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Archive: Hide from inbox without deleting
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id,
                archivedAt: null, // Only archive non-archived conversations
                deletedAt: null // Don't archive deleted conversations
            },
            data: {
                archivedAt: new Date()
            }
        });

        console.log(`[Archive] Archived ${result.count} conversations.`);
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("archiveConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function unarchiveConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocation();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Unarchive: Return to inbox
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id,
                archivedAt: { not: null } // Only unarchive archived conversations
            },
            data: {
                archivedAt: null
            }
        });

        console.log(`[Unarchive] Unarchived ${result.count} conversations.`);
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("unarchiveConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function emptyTrash() {
    const location = await getAuthenticatedLocation();

    try {
        // Permanently delete all conversations in trash
        const result = await db.conversation.deleteMany({
            where: {
                locationId: location.id,
                deletedAt: { not: null }
            }
        });

        console.log(`[Empty Trash] Permanently deleted ${result.count} conversations from trash.`);
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("emptyTrash error:", error);
        return { success: false, error: error.message };
    }
}

export async function getConversationParticipants(conversationId: string) {
    try {
        const location = await getLocationContext();
        if (!location) throw new Error("Unauthorized");

        const conversation = await db.conversation.findFirst({
            where: {
                OR: [
                    { id: conversationId },
                    { ghlConversationId: conversationId }
                ],
                locationId: location.id
            }
        });

        if (!conversation) return { success: false, error: "Conversation not found" };

        const participants = await db.conversationParticipant.findMany({
            where: { conversationId: conversation.id },
            include: {
                contact: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                        contactType: true
                    }
                }
            },
            orderBy: { role: 'asc' }
        });

        return { success: true, participants };
    } catch (error: any) {
        console.error("Failed to fetch participants:", error);
        return { success: false, error: error.message };
    }
}

// =============================================
// WhatsApp Chat Sync & New Conversation Actions
// =============================================

/**
 * Bulk-sync all WhatsApp chats from Evolution API into local DB.
 * Safe to call multiple times — dedup handled at message, conversation, and contact levels.
 */
export async function syncAllEvolutionChats() {
    const location = await getAuthenticatedLocation();
    if (!location.evolutionInstanceId) {
        return { success: false, error: "WhatsApp not connected. Please connect via Settings." };
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

        // 1. Health check
        const health = await evolutionClient.healthCheck();
        if (!health.ok) {
            return { success: false, error: "Evolution API is unreachable. Please check the server." };
        }

        // 2. Fetch all chats from the phone
        const allChats = await evolutionClient.fetchChats(location.evolutionInstanceId);
        if (!allChats || allChats.length === 0) {
            return { success: true, chatsProcessed: 0, messagesImported: 0, messagesSkipped: 0, errors: 0 };
        }

        // 3. Filter to valid WhatsApp chats only (1:1 and groups)
        const validChats = allChats.filter((chat: any) => {
            const jid = chat.id || chat.remoteJid || chat.jid;
            if (!jid) return false;
            return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us');
        });

        console.log(`[SyncAll] Found ${validChats.length} valid chats (filtered from ${allChats.length} total)`);

        let chatsProcessed = 0;
        let totalImported = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        // 4. Process each chat
        const MESSAGES_PER_CHAT = 30;
        const STOP_ON_DUPLICATES = 5;

        for (const chat of validChats) {
            const remoteJid = chat.id || chat.remoteJid || chat.jid;
            const isGroup = remoteJid.endsWith('@g.us');
            const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');

            try {
                // Fetch recent messages for this chat
                const messages = await evolutionClient.fetchMessages(
                    location.evolutionInstanceId,
                    remoteJid,
                    MESSAGES_PER_CHAT
                );

                if (!messages || messages.length === 0) {
                    chatsProcessed++;
                    continue;
                }

                let consecutiveDuplicates = 0;

                for (const msg of messages) {
                    try {
                        const key = msg.key;
                        const messageContent = msg.message;
                        if (!messageContent || !key?.id) continue;

                        const isFromMe = key.fromMe;

                        // Enhanced Participant Resolution (same as syncWhatsAppHistory)
                        const realSenderPhone = (msg as any).senderPn ||
                            (key.participant?.includes('@s.whatsapp.net') ? key.participant.replace('@s.whatsapp.net', '') : null);
                        let participantPhone = realSenderPhone ||
                            (key.participant ? key.participant.replace('@s.whatsapp.net', '').replace('@lid', '') : undefined);

                        const normalized: any = {
                            from: isFromMe ? location.id : phone,
                            to: isFromMe ? phone : location.id,
                            body: messageContent.conversation || messageContent.extendedTextMessage?.text || '[Media]',
                            type: 'text',
                            wamId: key.id,
                            timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                            direction: isFromMe ? 'outbound' : 'inbound',
                            source: 'whatsapp_evolution',
                            locationId: location.id,
                            contactName: isGroup ? (chat.name || chat.subject) : (isFromMe ? undefined : (msg.pushName || realSenderPhone)),
                            isGroup: isGroup,
                            participant: participantPhone
                        };

                        const result = await processNormalizedMessage(normalized);

                        if (result?.status === 'skipped') {
                            totalSkipped++;
                            consecutiveDuplicates++;
                        } else if (result?.status === 'processed') {
                            totalImported++;
                            consecutiveDuplicates = 0;
                        } else {
                            totalErrors++;
                            consecutiveDuplicates = 0;
                        }

                        // Early stop if we hit known history
                        if (consecutiveDuplicates >= STOP_ON_DUPLICATES) {
                            console.log(`[SyncAll] Chat ${remoteJid}: stopped after ${STOP_ON_DUPLICATES} consecutive dupes`);
                            break;
                        }
                    } catch (msgErr) {
                        totalErrors++;
                    }
                }

                chatsProcessed++;
            } catch (chatErr) {
                console.error(`[SyncAll] Error processing chat ${remoteJid}:`, chatErr);
                totalErrors++;
                chatsProcessed++;
            }
        }

        console.log(`[SyncAll] Complete: ${chatsProcessed} chats, ${totalImported} imported, ${totalSkipped} skipped, ${totalErrors} errors`);

        return {
            success: true,
            chatsProcessed,
            totalChats: validChats.length,
            messagesImported: totalImported,
            messagesSkipped: totalSkipped,
            errors: totalErrors
        };
    } catch (e: any) {
        console.error("[SyncAll] Failed:", e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch the list of WhatsApp chats from Evolution API for the picker UI.
 * Cross-references with existing DB conversations to mark "already synced".
 */
export async function fetchEvolutionChats() {
    const location = await getAuthenticatedLocation();
    if (!location.evolutionInstanceId) {
        return { success: false, error: "WhatsApp not connected", chats: [] };
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");

        const health = await evolutionClient.healthCheck();
        if (!health.ok) {
            return { success: false, error: "Evolution API unreachable", chats: [] };
        }

        const allChats = await evolutionClient.fetchChats(location.evolutionInstanceId);
        if (!allChats || allChats.length === 0) {
            return { success: true, chats: [] };
        }

        // Filter to valid chats
        const validChats = allChats.filter((chat: any) => {
            const jid = chat.id || chat.remoteJid || chat.jid;
            if (!jid) return false;
            return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us');
        });

        // Cross-reference with existing contacts/conversations in DB
        const existingContacts = await db.contact.findMany({
            where: { locationId: location.id, phone: { not: null } },
            select: { phone: true, name: true }
        });

        const existingConversations = await db.conversation.findMany({
            where: { locationId: location.id },
            include: { contact: { select: { phone: true } } }
        });

        // Build a set of normalized phones that already have conversations
        const syncedPhones = new Set(
            existingConversations
                .map((c: any) => c.contact?.phone?.replace(/\D/g, ''))
                .filter(Boolean)
        );

        const formatted = validChats.map((chat: any) => {
            const jid = chat.id || chat.remoteJid || chat.jid;
            const isGroup = jid.endsWith('@g.us');
            const phone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const rawPhone = phone.replace(/\D/g, '');

            // Check if already synced
            const alreadySynced = syncedPhones.has(rawPhone) ||
                Array.from(syncedPhones).some(p => p?.endsWith(rawPhone) || rawPhone.endsWith(p || ''));

            // Try to find a name from existing contacts
            const matchedContact = existingContacts.find(c => {
                const cp = c.phone?.replace(/\D/g, '') || '';
                return cp === rawPhone || cp.endsWith(rawPhone) || rawPhone.endsWith(cp);
            });

            return {
                jid,
                phone: `+${phone}`,
                name: chat.name || chat.subject || chat.pushName || matchedContact?.name || `+${phone}`,
                isGroup,
                alreadySynced,
                lastMessageTimestamp: chat.conversationTimestamp || chat.lastMessageTimestamp || null
            };
        });

        // Sort: non-synced first, then by last message
        formatted.sort((a: any, b: any) => {
            if (a.alreadySynced !== b.alreadySynced) return a.alreadySynced ? 1 : -1;
            return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
        });

        return { success: true, chats: formatted };
    } catch (e: any) {
        console.error("[FetchChats] Failed:", e);
        return { success: false, error: e.message, chats: [] };
    }
}

/**
 * Create a new conversation for a phone number, with history backfill from Evolution.
 */
export async function startNewConversation(phone: string) {
    const location = await getAuthenticatedLocation();

    // Normalize phone to E.164
    let normalizedPhone = phone.replace(/\s+/g, '').replace(/[-()]/g, '');
    if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = `+${normalizedPhone}`;
    }

    const rawDigits = normalizedPhone.replace(/\D/g, '');
    if (rawDigits.length < 7) {
        return { success: false, error: "Phone number is too short. Please include the country code." };
    }

    try {
        // 1. Find or create contact
        const searchSuffix = rawDigits.length > 2 ? rawDigits.slice(-2) : rawDigits;
        const candidates = await db.contact.findMany({
            where: {
                locationId: location.id,
                phone: { contains: searchSuffix }
            }
        });

        let contact = candidates.find(c => {
            if (!c.phone) return false;
            const cp = c.phone.replace(/\D/g, '');
            return cp === rawDigits ||
                (cp.endsWith(rawDigits) && rawDigits.length >= 7) ||
                (rawDigits.endsWith(cp) && cp.length >= 7);
        });

        if (!contact) {
            // Create new contact
            contact = await db.contact.create({
                data: {
                    locationId: location.id,
                    phone: normalizedPhone,
                    name: `WhatsApp ${normalizedPhone}`,
                    status: "New",
                    contactType: "Lead"
                }
            });
            console.log(`[NewConversation] Created new contact: ${contact.id} for ${normalizedPhone}`);
        } else {
            console.log(`[NewConversation] Found existing contact: ${contact.name} (${contact.id})`);
        }

        // 2. Check if conversation already exists for this contact
        const existingConv = await db.conversation.findFirst({
            where: {
                locationId: location.id,
                contactId: contact.id
            }
        });

        if (existingConv) {
            console.log(`[NewConversation] Existing conversation found: ${existingConv.ghlConversationId}`);

            // Still try to backfill recent messages if Evolution is connected
            if (location.evolutionInstanceId) {
                try {
                    const { evolutionClient } = await import("@/lib/evolution/client");
                    const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

                    const whatsappPhone = rawDigits;
                    const remoteJid = `${whatsappPhone}@s.whatsapp.net`;
                    const messages = await evolutionClient.fetchMessages(location.evolutionInstanceId, remoteJid, 30);

                    let imported = 0;
                    for (const msg of (messages || [])) {
                        const key = msg.key;
                        const messageContent = msg.message;
                        if (!messageContent || !key?.id) continue;

                        const isFromMe = key.fromMe;
                        const normalized: any = {
                            from: isFromMe ? location.id : whatsappPhone,
                            to: isFromMe ? whatsappPhone : location.id,
                            body: messageContent.conversation || messageContent.extendedTextMessage?.text || '[Media]',
                            type: 'text',
                            wamId: key.id,
                            timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                            direction: isFromMe ? 'outbound' : 'inbound',
                            source: 'whatsapp_evolution',
                            locationId: location.id,
                            contactName: isFromMe ? undefined : msg.pushName
                        };

                        const result = await processNormalizedMessage(normalized);
                        if (result?.status === 'processed') imported++;
                    }

                    console.log(`[NewConversation] Backfilled ${imported} messages for existing conversation`);
                } catch (backfillErr) {
                    console.warn("[NewConversation] History backfill failed:", backfillErr);
                }
            }

            return {
                success: true,
                conversationId: existingConv.ghlConversationId,
                isNew: false,
                contactName: contact.name
            };
        }

        // 3. Create new conversation
        const syntheticId = `wa_${Date.now()}_${contact.id}`;
        const conversation = await db.conversation.create({
            data: {
                ghlConversationId: syntheticId,
                locationId: location.id,
                contactId: contact.id,
                lastMessageBody: null,
                lastMessageAt: new Date(0), // Epoch — will sort to bottom until a real message arrives
                lastMessageType: 'TYPE_WHATSAPP',
                unreadCount: 0,
                status: 'open'
            }
        });

        console.log(`[NewConversation] Created conversation: ${conversation.ghlConversationId}`);

        // 4. Try to backfill history from Evolution
        let messagesImported = 0;
        if (location.evolutionInstanceId) {
            try {
                const { evolutionClient } = await import("@/lib/evolution/client");
                const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

                const whatsappPhone = rawDigits;
                const remoteJid = `${whatsappPhone}@s.whatsapp.net`;
                const messages = await evolutionClient.fetchMessages(location.evolutionInstanceId, remoteJid, 30);

                for (const msg of (messages || [])) {
                    const key = msg.key;
                    const messageContent = msg.message;
                    if (!messageContent || !key?.id) continue;

                    const isFromMe = key.fromMe;
                    const normalized: any = {
                        from: isFromMe ? location.id : whatsappPhone,
                        to: isFromMe ? whatsappPhone : location.id,
                        body: messageContent.conversation || messageContent.extendedTextMessage?.text || '[Media]',
                        type: 'text',
                        wamId: key.id,
                        timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                        direction: isFromMe ? 'outbound' : 'inbound',
                        source: 'whatsapp_evolution',
                        locationId: location.id,
                        contactName: isFromMe ? undefined : msg.pushName
                    };

                    const result = await processNormalizedMessage(normalized);
                    if (result?.status === 'processed') messagesImported++;
                }

                console.log(`[NewConversation] Backfilled ${messagesImported} messages for new conversation`);
            } catch (backfillErr) {
                console.warn("[NewConversation] History backfill failed:", backfillErr);
            }
        }

        return {
            success: true,
            conversationId: conversation.ghlConversationId,
            isNew: true,
            contactName: contact.name,
            messagesImported
        };
    } catch (e: any) {
        console.error("[NewConversation] Failed:", e);
        return { success: false, error: e.message };
    }
}

// ------------------------------------------------------------------
// Paste Lead Feature Actions
// ------------------------------------------------------------------

const LeadParsingSchema = z.object({
    contact: z.object({
        name: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
    }),
    requirements: z.object({
        budget: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        bedrooms: z.string().nullable().optional(),
    }),
    messageContent: z.string().nullable().optional().describe("The actual message text written by the lead. Null if only metadata/notes/summary."),
    internalNotes: z.string().nullable().optional().describe("Summary of the lead request or context if no direct message."),
    source: z.string().nullable().optional().describe("Inferred source e.g. Bazaraki, Facebook, WhatsApp")
});

export type ParsedLeadData = z.infer<typeof LeadParsingSchema>;

export interface LeadAnalysisTrace {
    traceId: string; // Temporary ID for client side reference if needed
    start: number;
    end: number;
    model: string;
    thoughtSummary: string;
    llmRequest: {
        model: string;
        prompt: string;
        options: {
            jsonMode: boolean;
        };
    };
    llmResponse: {
        rawText: string;
        cleanJson: string;
        parsed: ParsedLeadData;
    };
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export async function parseLeadFromText(text: string) {
    const location = await getAuthenticatedLocation();

    if (!text || text.length < 5) {
        return { success: false, error: "Text is too short" };
    }

    try {
        const prompt = `You are an expert real estate lead parser. 
Analyze the following text and extract structured lead information.
Distinguish between the "Lead's actual message" (messageContent) and "Context/Notes" (internalNotes).

Input Text:
"""
${text}
"""

Return JSON matching this schema:
{
  "contact": { "name": string|null, "phone": string|null, "email": string|null },
  "requirements": { "budget": string|null, "location": string|null, "type": string|null, "bedrooms": string|null },
  "messageContent": string|null,
  "internalNotes": string|null,
  "source": string|null
}
`;

        // Use Flash model for speed/cost
        const modelId = getModelForTask("lead_parsing");

        const start = Date.now();
        // Pass jsonMode: true to force JSON output if supported, or rely on prompt instruction
        // callLLM supports options.jsonMode
        // Use callLLMWithMetadata to get token usage
        const { callLLMWithMetadata } = await import("@/lib/ai/llm");
        const { text: jsonStr, usage } = await callLLMWithMetadata(modelId, prompt, undefined, { jsonMode: true });
        const end = Date.now();

        // Clean markdown code blocks if present (Gemini sometimes adds ```json ... ```)
        const cleanJson = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();

        const parsed = JSON.parse(cleanJson);
        const result = LeadParsingSchema.parse(parsed);

        const trace: LeadAnalysisTrace = {
            traceId: `trace_${Date.now()}`, // Temp
            start,
            end,
            model: modelId,
            thoughtSummary: `Lead Analysis (Gemini Flash):\n- Extracted structured data from raw text.\n- Identified Source: ${result.source || 'Unknown'}\n- Message Status: ${result.messageContent ? 'Has Message' : 'Notes Only'}`,
            llmRequest: {
                model: modelId,
                prompt,
                options: {
                    jsonMode: true
                }
            },
            llmResponse: {
                rawText: jsonStr,
                cleanJson,
                parsed: result
            },
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens
        };

        return { success: true, data: result, trace };
    } catch (error: any) {
        console.error("parseLeadFromText Error:", error);
        return { success: false, error: error.message };
    }
}

export async function createParsedLead(data: ParsedLeadData, originalText: string, trace?: LeadAnalysisTrace) {
    const location = await getAuthenticatedLocation();

    try {
        // 1. Resolve or Create Contact
        let contactId: string | null = null;
        let isNewContact = false;

        // Try to find by Phone
        if (data.contact?.phone) {
            // Clean phone
            const phone = data.contact.phone.replace(/\s+/g, "");
            const existing = await db.contact.findFirst({
                where: {
                    locationId: location.id,
                    phone: { contains: phone.slice(-8) } // Simple suffix match
                }
            });
            if (existing) contactId = existing.id;
        }

        // Try to find by Email
        if (!contactId && data.contact?.email) {
            const existing = await db.contact.findFirst({
                where: { locationId: location.id, email: data.contact.email }
            });
            if (existing) contactId = existing.id;
        }

        // Create or Update
        const contactData: any = {
            locationId: location.id,
            status: "New",
            leadSource: "Manual Import"
        };

        if (data.contact?.name) contactData.name = data.contact.name;
        if (data.contact?.phone) contactData.phone = data.contact.phone;
        if (data.contact?.email) contactData.email = data.contact.email;

        // Append notes
        if (data.internalNotes) {
            // We can't access 'notes' here easily if we don't know if we are updating, 
            // but let's just set it for new, or update for existing?
            // For update, we might overwrite. Safe implies appending.
            // We'll handle this in the update call.
        }

        // Requirements to Notes? Or specific fields? 
        // We have specific requirement fields in Contact schema
        if (data.requirements) {
            if (data.requirements.budget) contactData.requirementMaxPrice = data.requirements.budget;
            if (data.requirements.location) contactData.requirementDistrict = data.requirements.location;
            if (data.requirements.bedrooms) contactData.requirementBedrooms = data.requirements.bedrooms;
            if (data.requirements.type) contactData.requirementPropertyTypes = [data.requirements.type];
        }

        if (contactId) {
            // Update existing
            // Remove locationId, status, leadSource from update data to avoid overwriting existing state
            const { locationId, status, leadSource, ...updateData } = contactData;

            await db.contact.update({
                where: { id: contactId },
                data: {
                    ...updateData,
                    // safe note update?
                }
            });
        } else {
            // Create New
            if (data.internalNotes) contactData.notes = data.internalNotes;
            const newContact = await db.contact.create({ data: contactData });
            contactId = newContact.id;
            isNewContact = true;
        }

        // 2. Ensure Conversation Exists
        let conversation = await db.conversation.findFirst({
            where: { locationId: location.id, contactId: contactId! }
        });

        if (!conversation) {
            // Create dummy GHL ID if needed, or use cuid
            const ghlId = `import_${Date.now()}`;
            conversation = await db.conversation.create({
                data: {
                    locationId: location.id,
                    contactId: contactId!,
                    ghlConversationId: ghlId,
                    status: 'open',
                    lastMessageAt: new Date(),
                    unreadCount: 0
                }
            });
        }

        // 2.5 Save Analysis Trace if provided
        if (trace) {
            try {
                await db.agentExecution.create({
                    data: {
                        conversationId: conversation.id,
                        traceId: trace.traceId,
                        spanId: trace.traceId,
                        taskTitle: "Analyze Lead Text",
                        status: "success",
                        taskStatus: "success",
                        skillName: "lead_parser",
                        intent: "analysis",
                        model: trace.model,
                        thoughtSummary: trace.thoughtSummary,
                        thoughtSteps: [
                            {
                                step: 1,
                                description: "LLM request payload",
                                conclusion: "Captured full request sent to model",
                                data: trace.llmRequest
                            },
                            {
                                step: 2,
                                description: "LLM response payload",
                                conclusion: "Captured raw response and parsed JSON output",
                                data: trace.llmResponse
                            }
                        ],
                        toolCalls: [
                            {
                                tool: "gemini.generateContent",
                                arguments: trace.llmRequest,
                                result: trace.llmResponse,
                                error: null
                            }
                        ],
                        promptTokens: trace.promptTokens,
                        completionTokens: trace.completionTokens,
                        totalTokens: trace.totalTokens,
                        latencyMs: trace.end - trace.start,
                        createdAt: new Date(trace.start)
                    }
                });
            } catch (err) {
                console.warn("Failed to save analysis trace:", err);
            }
        }

        // 3. Handle Message & Orchestration
        if (data.messageContent) {
            // USER SENT A MESSAGE
            const message = await db.message.create({
                data: {
                    conversationId: conversation.id,
                    body: data.messageContent,
                    direction: 'inbound',
                    type: 'TYPE_SMS', // Default
                    status: 'received',
                    createdAt: new Date(),
                    source: data.source || 'paste_import'
                }
            });

            // Trigger AI
            await orchestrateAction(conversation.ghlConversationId, contactId!);

            return { success: true, conversationId: conversation.ghlConversationId, action: 'replied' };
        } else {
            // NO MESSAGE (Just Notes)
            // Create a System Note in the thread
            await db.message.create({
                data: {
                    conversationId: conversation.id,
                    body: `[Lead Imported] Source: ${data.source || 'Manual'}\nNotes: ${data.internalNotes || originalText}`,
                    direction: 'system', // Use reserved direction specific to internal/system
                    type: 'TYPE_NOTE',
                    status: 'read', // Internal
                    createdAt: new Date(),
                    source: 'system'
                }
            });

            return { success: true, conversationId: conversation.ghlConversationId, action: 'imported' };
        }
    } catch (e: any) {
        console.error("createParsedLead Error:", e);
        return { success: false, error: e.message };
    }
}
