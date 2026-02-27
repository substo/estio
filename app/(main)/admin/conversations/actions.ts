'use server';

import { getLocationContext } from "@/lib/auth/location-context";
import { getConversations, getMessages, getConversation, sendMessage, getMessage, Conversation, Message } from "@/lib/ghl/conversations";
import { generateDraft } from "@/lib/ai/coordinator";
import { refreshGhlAccessToken } from "@/lib/location";
import db from "@/lib/db";
import { updateConversationLastMessage } from "@/lib/conversations/update";
import { seedConversationFromContactLeadText } from "@/lib/conversations/bootstrap";
import { generateMultiContextDraft } from "@/lib/ai/context-builder";
import { ensureLocalContactSynced } from "@/lib/crm/contact-sync";
import { ensureConversationHistory, syncMessageFromWebhook } from "@/lib/ghl/sync";
import { calculateRunCost, calculateRunCostFromUsage } from "@/lib/ai/pricing";
import { z } from "zod";
import { getModelForTask } from "@/lib/ai/model-router";
import { callLLM } from "@/lib/ai/llm";
import { auth } from "@clerk/nextjs/server";
import { runGoogleAutoSyncForContact } from "@/lib/google/automation";
import {
    buildWhatsAppOutboundUploadKey,
    createWhatsAppMediaReadUrl,
    createWhatsAppMediaUploadUrl,
    headWhatsAppMediaObject,
    toR2Uri,
} from "@/lib/whatsapp/media-r2";
import { ingestEvolutionImageAttachment, parseEvolutionMessageContent } from "@/lib/whatsapp/evolution-media";

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

export async function fetchConversations(
    status: 'active' | 'archived' | 'trash' | 'all' = 'active',
    selectedConversationId?: string | null,
    options?: { cursor?: string | null; limit?: number | null }
) {
    try {
        const DEFAULT_PAGE_SIZE = 50;
        const MAX_PAGE_SIZE = 200;
        const pageSize = Math.min(
            Math.max(Number(options?.limit || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1),
            MAX_PAGE_SIZE
        );

        const decodeCursor = (raw?: string | null): { id: string; lastMessageAtMs: number } | null => {
            if (!raw) return null;
            try {
                const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
                const id = String(parsed?.id || '');
                const lastMessageAtMs = Number(parsed?.lastMessageAtMs);
                if (!id || !Number.isFinite(lastMessageAtMs)) return null;
                return { id, lastMessageAtMs };
            } catch {
                return null;
            }
        };

        const encodeCursor = (input: { id: string; lastMessageAt: Date }) =>
            Buffer.from(JSON.stringify({
                id: input.id,
                lastMessageAtMs: input.lastMessageAt.getTime(),
            }), 'utf8').toString('base64');

        const cursor = decodeCursor(options?.cursor);
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
        const paginatedWhere: any = cursor
            ? {
                ...where,
                OR: [
                    { lastMessageAt: { lt: new Date(cursor.lastMessageAtMs) } },
                    {
                        AND: [
                            { lastMessageAt: { equals: new Date(cursor.lastMessageAtMs) } },
                            { id: { lt: cursor.id } }
                        ]
                    }
                ]
            }
            : where;

        const fetchedRows = await db.conversation.findMany({
            where: paginatedWhere,
            orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
            take: pageSize + 1,
            include: { contact: { select: { name: true, email: true, phone: true, ghlContactId: true } } }
        });

        const hasMore = fetchedRows.length > pageSize;
        const pageRows = hasMore ? fetchedRows.slice(0, pageSize) : fetchedRows;
        const lastRowForCursor = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
        const nextCursor = hasMore && lastRowForCursor
            ? encodeCursor({ id: lastRowForCursor.id, lastMessageAt: lastRowForCursor.lastMessageAt })
            : null;

        let conversationsWithGhlId = pageRows;

        // If a conversation is deep-linked via ?id=... but falls outside the top-50 window,
        // include it so the center/right panels can still render for that selection.
        if (
            !cursor &&
            selectedConversationId &&
            !conversationsWithGhlId.some((c: any) => c.ghlConversationId === selectedConversationId)
        ) {
            const selectedConversation = await db.conversation.findFirst({
                where: {
                    locationId: location.id,
                    ghlConversationId: selectedConversationId,
                },
                include: { contact: { select: { name: true, email: true, phone: true, ghlContactId: true } } }
            });

            if (selectedConversation) {
                conversationsWithGhlId = [selectedConversation, ...conversationsWithGhlId];
            }
        }

        // Optional UX pinning for the legacy CRM notifier thread (same contact thread used for old CRM lead emails).
        const legacyCrmPinSettings = await db.location.findUnique({
            where: { id: location.id },
            select: {
                legacyCrmLeadEmailPinConversation: true,
                legacyCrmLeadEmailSenders: true,
                legacyCrmLeadEmailSenderDomains: true,
            } as any
        });

        if ((legacyCrmPinSettings as any)?.legacyCrmLeadEmailPinConversation) {
            const configuredSenders = (((legacyCrmPinSettings as any)?.legacyCrmLeadEmailSenders || []) as string[])
                .map((s) => String(s || '').trim().toLowerCase())
                .filter(Boolean);
            const configuredDomains = (((legacyCrmPinSettings as any)?.legacyCrmLeadEmailSenderDomains || []) as string[])
                .map((d) => String(d || '').trim().toLowerCase().replace(/^@/, ''))
                .filter(Boolean);

            // If the pinned notifier thread falls outside the top page window, inject it so pinning
            // still works on the default conversations page (same behavior as deep-link inclusion).
            if (!cursor) {
                const hasPinnedConversationInWindow = conversationsWithGhlId.some((c: any) => {
                    const email = String(c.contact?.email || '').trim().toLowerCase();
                    if (!email) return false;
                    const matchMode = matchLegacyCrmLeadSender(email, {
                        senders: configuredSenders,
                        domains: configuredDomains,
                    });
                    return matchMode === 'exact' || matchMode === 'domain';
                });

                if (!hasPinnedConversationInWindow && (configuredSenders.length > 0 || configuredDomains.length > 0)) {
                    const emailFilters: any[] = [
                        ...configuredSenders.map((sender) => ({
                            contact: {
                                email: {
                                    equals: sender,
                                    mode: 'insensitive'
                                }
                            }
                        })),
                        ...configuredDomains.flatMap((domain) => ([
                            {
                                contact: {
                                    email: {
                                        endsWith: `@${domain}`,
                                        mode: 'insensitive'
                                    }
                                }
                            },
                            {
                                contact: {
                                    email: {
                                        endsWith: `.${domain}`,
                                        mode: 'insensitive'
                                    }
                                }
                            }
                        ]))
                    ];

                    if (emailFilters.length > 0) {
                        const pinnedConversationOffWindow = await db.conversation.findFirst({
                            where: {
                                ...where,
                                OR: emailFilters,
                            },
                            orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
                            include: { contact: { select: { name: true, email: true, phone: true, ghlContactId: true } } }
                        });

                        if (
                            pinnedConversationOffWindow &&
                            !conversationsWithGhlId.some((c: any) => c.id === pinnedConversationOffWindow.id)
                        ) {
                            conversationsWithGhlId = [pinnedConversationOffWindow, ...conversationsWithGhlId];
                        }
                    }
                }
            }

            const pinnedIndex = conversationsWithGhlId.findIndex((c: any) => {
                const email = String(c.contact?.email || '').trim().toLowerCase();
                if (!email) return false;
                const matchMode = matchLegacyCrmLeadSender(email, {
                    senders: configuredSenders,
                    domains: configuredDomains,
                });
                return matchMode === 'exact' || matchMode === 'domain';
            });

            if (pinnedIndex > 0) {
                const [pinnedConversation] = conversationsWithGhlId.splice(pinnedIndex, 1);
                conversationsWithGhlId.unshift(pinnedConversation);
            }
        }

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
            total: conversationsWithGhlId.length,
            hasMore,
            nextCursor,
            pageSize,
        };
    } catch (error: any) {
        console.error("fetchConversations error:", error);
        return { conversations: [], total: 0, hasMore: false, nextCursor: null, pageSize: 0 };
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
        orderBy: { createdAt: 'asc' },
        include: {
            attachments: true,
            legacyCrmLeadEmailProcessing: {
                select: {
                    status: true,
                    classification: true,
                    senderEmail: true,
                    legacyLeadUrl: true,
                    legacyLeadId: true,
                    error: true,
                    attempts: true,
                    processedAt: true,
                    processedContactId: true,
                    processedConversationId: true,
                    extracted: true,
                    processResult: true,
                }
            }
        }
    });

    console.log(`[DB Read] Fetched ${messages.length} messages from local database for conversation ${conversation.ghlConversationId}`);

    const hasEmailMessages = messages.some((m: any) => String(m.type || '').toUpperCase().includes('EMAIL'));
    const legacyCrmSettings = hasEmailMessages
        ? await db.location.findUnique({
            where: { id: location.id },
            select: {
                legacyCrmLeadEmailEnabled: true,
                legacyCrmLeadEmailSenders: true,
                legacyCrmLeadEmailSenderDomains: true,
                legacyCrmLeadEmailSubjectPatterns: true,
            } as any
        })
        : null;

    const legacyCrmDetectionEnabled = !!(legacyCrmSettings as any)?.legacyCrmLeadEmailEnabled;
    const legacyCrmConfiguredSenders = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSenders || []) as string[]);
    const legacyCrmConfiguredDomains = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSenderDomains || []) as string[]);
    const legacyCrmSubjectPatterns = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSubjectPatterns || []) as string[]);

    return messages.map((m: any) => ({
        ...(() => {
            const isEmail = String(m.type || '').toUpperCase().includes('EMAIL');
            if (!isEmail) return {};

            const processing = m.legacyCrmLeadEmailProcessing;
            const parsed = parseLegacyCrmLeadNotificationEmail({
                subject: m.subject,
                emailFrom: m.emailFrom,
                body: m.body,
                configuredSenders: legacyCrmConfiguredSenders,
                configuredDomains: legacyCrmConfiguredDomains,
                configuredSubjectPatterns: legacyCrmSubjectPatterns,
            });

            const extracted = processing?.extracted && typeof processing.extracted === 'object'
                ? (processing.extracted as any)
                : null;
            const extractedReason = extracted?.reason ? String(extracted.reason) : null;
            const sourceUpper = String(m.source || '').toUpperCase();
            const isOutlookSyncedEmail = sourceUpper.includes('OUTLOOK');
            // Manual processing should be available on Outlook-synced emails even before the parser
            // positively detects a legacy CRM lead format. This lets users trigger processing on
            // truncated/edge-case emails and inspect ignored reasons directly from the UI.
            const showLegacyCrmUi = !!processing || isOutlookSyncedEmail;

            if (!showLegacyCrmUi) return {};

            return {
                legacyCrmLead: {
                    status: processing?.status || undefined,
                    matched: processing ? !!extracted?.matched : parsed.matched,
                    classification: processing?.classification || parsed.classification || null,
                    senderMatchMode: processing
                        ? (extracted?.senderMatchMode ? String(extracted.senderMatchMode) : null)
                        : parsed.senderMatchMode,
                    reason: processing ? extractedReason : (parsed.reason || null),
                    error: processing?.error || null,
                    attempts: processing?.attempts || 0,
                    processedAt: processing?.processedAt ? new Date(processing.processedAt).toISOString() : null,
                    processedContactId: processing?.processedContactId || null,
                    processedConversationId: processing?.processedConversationId || null,
                    legacyLeadUrl: processing?.legacyLeadUrl || parsed.leadUrl || null,
                    canProcess: !processing || ['pending', 'failed', 'ignored'].includes(String(processing.status || '').toLowerCase()),
                    canReprocess: !!processing && ['processed', 'failed', 'ignored'].includes(String(processing.status || '').toLowerCase()),
                    detectionEnabled: legacyCrmDetectionEnabled,
                }
            };
        })(),
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
        emailFrom: m.emailFrom || undefined,
        emailTo: m.emailTo || undefined,
        source: m.source || undefined,
        attachments: (m.attachments || []).map((a: any) => ({
            url: String(a.url || "").startsWith("r2://")
                ? `/api/media/attachments/${a.id}`
                : a.url,
            mimeType: a.mimeType || null,
            fileName: a.fileName || null,
        })),
        // Hydrated fields for UI
        html: m.body?.includes('<') ? m.body : undefined // Simple check
    }));
}

function normalizeWhatsAppDigits(value: string | null | undefined): string {
    return String(value || "").replace(/\D/g, "");
}

function normalizeStoredLidJid(value: string | null | undefined): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (raw.endsWith("@lid")) return raw;
    if (raw.includes("@")) return null;
    return `${raw}@lid`;
}

function normalizeKnownChatJid(value: string | null | undefined): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (raw.endsWith("@s.whatsapp.net") || raw.endsWith("@g.us") || raw.endsWith("@lid")) {
        return raw;
    }
    return null;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const v = String(value || "").trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
}

function extractEvolutionLidJid(key: any): string | undefined {
    const remoteJid = typeof key?.remoteJid === "string" ? key.remoteJid : null;
    if (remoteJid?.endsWith("@lid")) return remoteJid;

    const participantJid = typeof key?.participant === "string" ? key.participant : null;
    if (participantJid?.endsWith("@lid")) return participantJid;

    return undefined;
}

async function resolveWhatsAppHistoryRemoteJids(
    evolutionClient: any,
    evolutionInstanceId: string,
    contact: { phone?: string | null; lid?: string | null; contactType?: string | null }
): Promise<{ candidates: string[]; isGroup: boolean; phoneDigits: string }> {
    const rawPhone = String(contact.phone || "").trim();
    const phoneDigits = normalizeWhatsAppDigits(rawPhone);
    const explicitPhoneJid = normalizeKnownChatJid(rawPhone);
    const explicitLidJid = normalizeStoredLidJid(contact.lid);
    const isGroup = contact.contactType === "WhatsAppGroup" || rawPhone.includes("@g.us");

    if (isGroup) {
        const groupJid =
            (explicitPhoneJid && explicitPhoneJid.endsWith("@g.us") ? explicitPhoneJid : null) ||
            (phoneDigits ? `${phoneDigits}@g.us` : null);
        return { candidates: dedupeStrings([groupJid]), isGroup: true, phoneDigits };
    }

    const candidates: Array<string | null> = [explicitLidJid];

    if (explicitPhoneJid && (explicitPhoneJid.endsWith("@s.whatsapp.net") || explicitPhoneJid.endsWith("@lid"))) {
        candidates.push(explicitPhoneJid);
    }

    if (phoneDigits.length >= 7) {
        try {
            const lookup = await evolutionClient.checkWhatsAppNumber(evolutionInstanceId, phoneDigits);
            if (lookup?.exists && typeof lookup.jid === "string" && lookup.jid) {
                candidates.push(lookup.jid);
            }
        } catch (err) {
            console.warn("[WhatsApp History] Failed to resolve phone to WhatsApp JID:", err);
        }

        candidates.push(`${phoneDigits}@s.whatsapp.net`);
    }

    return { candidates: dedupeStrings(candidates), isGroup: false, phoneDigits };
}

async function fetchEvolutionMessagesForContactHistory(params: {
    evolutionClient: any;
    evolutionInstanceId: string;
    contact: { phone?: string | null; lid?: string | null; contactType?: string | null };
    limit: number;
    offset?: number;
    logPrefix: string;
}): Promise<{
    messages: any[];
    remoteJid: string | null;
    candidates: string[];
    isGroup: boolean;
    phoneDigits: string;
}> {
    const { evolutionClient, evolutionInstanceId, contact, limit, offset = 0, logPrefix } = params;
    const { candidates, isGroup, phoneDigits } = await resolveWhatsAppHistoryRemoteJids(
        evolutionClient,
        evolutionInstanceId,
        contact
    );

    if (candidates.length === 0) {
        return { messages: [], remoteJid: null, candidates, isGroup, phoneDigits };
    }

    let lastTried: string | null = null;
    for (const candidate of candidates) {
        lastTried = candidate;
        console.log(`${logPrefix} Fetching messages for ${candidate} (Limit: ${limit}, Offset: ${offset})...`);
        const messages = await evolutionClient.fetchMessages(evolutionInstanceId, candidate, limit, offset);
        if ((messages || []).length > 0) {
            return { messages, remoteJid: candidate, candidates, isGroup, phoneDigits };
        }
    }

    return { messages: [], remoteJid: lastTried, candidates, isGroup, phoneDigits };
}

export async function syncWhatsAppHistory(conversationId: string, limit: number = 20, ignoreDuplicates: boolean = false, offset: number = 0) {
    const location = await getAuthenticatedLocation();

    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: conversationId },
        include: { contact: true }
    });

    if (!conversation) return { success: false, error: "Conversation not found" };
    if (!location.evolutionInstanceId) return { success: false, error: "WhatsApp not connected" };
    if (!conversation.contact?.phone && !conversation.contact?.lid) return { success: false, error: "Contact has no phone number or WhatsApp LID" };

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

        const fetchLimit = limit || 50;
        const {
            messages: evolutionMessages,
            remoteJid,
            candidates: remoteJidCandidates,
            phoneDigits: phone,
        } = await fetchEvolutionMessagesForContactHistory({
            evolutionClient,
            evolutionInstanceId: location.evolutionInstanceId,
            contact: {
                phone: conversation.contact.phone,
                lid: (conversation.contact as any).lid || null,
                contactType: (conversation.contact as any).contactType || null,
            },
            limit: fetchLimit,
            offset,
            logPrefix: `[Sync][${conversationId}]`,
        });

        console.log(
            `[Sync] History fetch candidates for ${conversationId}: ${remoteJidCandidates.join(", ") || "(none)"}; selected=${remoteJid || "none"}; found=${evolutionMessages.length}; ignoreDupes=${ignoreDuplicates}`
        );

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

                const parsedContent = parseEvolutionMessageContent(messageContent);
                const senderName = msg.pushName || realSenderPhone || "Unknown";
                const normalizedBody = isGroup && parsedContent.type !== 'text'
                    ? `[${senderName}]: ${parsedContent.body}`
                    : parsedContent.body;

                const normalized: any = {
                    from: isFromMe ? location.id : phone,
                    to: isFromMe ? phone : location.id,
                    body: normalizedBody,
                    type: parsedContent.type,
                    wamId: key.id,
                    timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                    direction: isFromMe ? 'outbound' : 'inbound',
                    source: 'whatsapp_evolution',
                    locationId: location.id,
                    contactName: isGroup ? undefined : (msg.pushName || realSenderPhone), // Don't rename group to sender name
                    isGroup: isGroup,
                    participant: participantPhone, // Pass resolved participant to sync
                    lid: !isGroup ? extractEvolutionLidJid(key) : undefined,
                    resolvedPhone: !isGroup && phone ? phone : undefined,
                };

                if (parsedContent.type === 'image' && location.evolutionInstanceId) {
                    normalized.__evolutionImageAttachmentPayload = {
                        instanceName: location.evolutionInstanceId,
                        evolutionMessageData: msg,
                    };
                }

                const result = await processNormalizedMessage(normalized);

                if (parsedContent.type === 'image' && location.evolutionInstanceId) {
                    if (result?.status === 'deferred_unresolved_lid') {
                        console.log(`[Sync] Delaying image attachment ingest until LID resolves (${key.id})`);
                    } else {
                        void ingestEvolutionImageAttachment({
                            instanceName: location.evolutionInstanceId,
                            evolutionMessageData: msg,
                            wamId: key.id,
                        }).catch((err) => {
                            console.error(`[Sync] Failed to ingest image attachment for ${key.id}:`, err);
                        });
                    }
                }

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

const WHATSAPP_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
]);
const MAX_WHATSAPP_IMAGE_BYTES = 16 * 1024 * 1024;

type WhatsAppImageUploadRef = {
    objectKey: string;
    fileName: string;
    contentType: string;
    size: number;
};

export async function createWhatsAppImageUploadUrl(
    conversationId: string,
    contactId: string,
    file: { fileName: string; contentType: string; size: number }
) {
    const location = await getAuthenticatedLocation();

    if (!location?.evolutionInstanceId) {
        return { success: false, error: "WhatsApp (Evolution) is not connected." };
    }

    const contentType = String(file.contentType || "").toLowerCase();
    const size = Number(file.size || 0);
    const fileName = String(file.fileName || "image");

    if (!WHATSAPP_IMAGE_MIME_TYPES.has(contentType)) {
        return { success: false, error: `Unsupported image type: ${contentType || "unknown"}` };
    }
    if (!size || size <= 0) {
        return { success: false, error: "Invalid file size." };
    }
    if (size > MAX_WHATSAPP_IMAGE_BYTES) {
        return { success: false, error: `Image is too large. Max size is ${Math.floor(MAX_WHATSAPP_IMAGE_BYTES / (1024 * 1024))}MB.` };
    }

    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: conversationId },
        select: { id: true, locationId: true, contactId: true }
    });

    if (!conversation || conversation.locationId !== location.id) {
        return { success: false, error: "Conversation not found." };
    }

    const contact = await db.contact.findFirst({
        where: {
            OR: [{ ghlContactId: contactId }, { id: contactId }],
            locationId: location.id
        },
        select: { id: true }
    });

    if (!contact) {
        return { success: false, error: "Contact not found." };
    }
    if (conversation.contactId !== contact.id) {
        return { success: false, error: "Conversation/contact mismatch." };
    }

    const key = buildWhatsAppOutboundUploadKey({
        locationId: location.id,
        contactId: contact.id,
        conversationId: conversation.id,
        fileName,
        contentType,
    });

    const upload = await createWhatsAppMediaUploadUrl({
        key,
        contentType,
        expiresInSeconds: 600,
    });

    return {
        success: true as const,
        uploadUrl: upload.uploadUrl,
        upload: {
            objectKey: key,
            fileName,
            contentType,
            size,
        },
        headers: {
            "Content-Type": contentType,
        },
    };
}

export async function sendWhatsAppImageReply(
    conversationId: string,
    contactId: string,
    caption: string,
    upload: WhatsAppImageUploadRef
) {
    const location = await getAuthenticatedLocation();
    if (!location?.ghlAccessToken) {
        throw new Error("Unauthorized");
    }

    const cleanCaption = (caption || "").trim();
    const previewBody = cleanCaption || "[Image]";

    try {
        const hasEvolution = !!location.evolutionInstanceId;
        if (!hasEvolution) {
            return { success: false, error: "WhatsApp (Evolution) is not connected." };
        }

        const contentType = String(upload?.contentType || "").toLowerCase();
        const size = Number(upload?.size || 0);
        const objectKey = String(upload?.objectKey || "");
        const fileName = String(upload?.fileName || "image");

        const conversation = await db.conversation.findUnique({
            where: { ghlConversationId: conversationId },
            select: { id: true, locationId: true, contactId: true }
        });
        if (!conversation || conversation.locationId !== location.id) {
            return { success: false, error: "Conversation not found." };
        }

        if (!objectKey.startsWith("whatsapp/evolution/v1/")) {
            return { success: false, error: "Invalid upload reference." };
        }
        if (!objectKey.includes(`/location/${location.id}/`) || !objectKey.includes(`/conversation/${conversation.id}/`)) {
            return { success: false, error: "Upload reference does not belong to this conversation." };
        }
        if (!WHATSAPP_IMAGE_MIME_TYPES.has(contentType)) {
            return { success: false, error: `Unsupported image type: ${contentType || "unknown"}` };
        }
        if (!size || size > MAX_WHATSAPP_IMAGE_BYTES) {
            return { success: false, error: "Invalid image size." };
        }

        const objectHead = await headWhatsAppMediaObject(objectKey);
        if (!objectHead.exists) {
            return { success: false, error: "Uploaded image not found in media storage. Please re-upload and try again." };
        }

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

        if (!contact) {
            return { success: false, error: "Contact not found in database." };
        }
        if (conversation.contactId !== contact.id) {
            return { success: false, error: "Conversation/contact mismatch." };
        }
        if (!contact.phone) {
            return { success: false, error: "Contact does not have a phone number. Please add a phone number to this contact." };
        }
        if (contact.phone.includes('*')) {
            const contactName = contact.name || 'This contact';
            return {
                success: false,
                error: `${contactName}'s phone number "${contact.phone}" is masked (contains ***). You cannot send WhatsApp images to masked numbers.`
            };
        }

        const normalizedPhone = contact.phone.replace(/\D/g, '');
        if (normalizedPhone.length < 10) {
            const contactName = contact.name || 'This contact';
            return {
                success: false,
                error: `${contactName}'s phone number "${contact.phone}" appears to be missing a country code. Please update the contact with the full international number.`
            };
        }

        const { evolutionClient } = await import("@/lib/evolution/client");
        const instanceState = await evolutionClient.fetchInstance(location.evolutionInstanceId!);
        const instanceData = Array.isArray(instanceState) ? instanceState[0] : instanceState;
        const connStatus = instanceData?.instance?.connectionStatus || instanceData?.connectionStatus || instanceData?.status;

        if (connStatus !== 'open') {
            return {
                success: false,
                error: `WhatsApp is disconnected (Status: ${connStatus || 'unknown'}). Please reconnect in Settings → WhatsApp.`
            };
        }

        const signedMediaUrl = await createWhatsAppMediaReadUrl({
            key: objectKey,
            contentType,
            fileName,
            expiresInSeconds: 300,
        });

        const res = await evolutionClient.sendMedia(
            location.evolutionInstanceId!,
            normalizedPhone,
            {
                mediaType: "image",
                mediaUrl: signedMediaUrl,
                caption: cleanCaption || undefined,
                mimetype: contentType,
                fileName,
            }
        );

        if (!res?.key?.id) {
            return { success: false, error: "Image sent but no confirmation received." };
        }

        const created = await db.message.create({
            data: {
                ghlMessageId: res.key.id,
                wamId: res.key.id,
                conversation: { connect: { ghlConversationId: conversationId } },
                body: previewBody,
                type: 'TYPE_WHATSAPP',
                direction: 'outbound',
                status: 'sent',
                createdAt: new Date(),
                updatedAt: new Date(),
                source: 'app_user',
                attachments: {
                    create: [{
                        fileName,
                        contentType,
                        size,
                        url: toR2Uri(objectKey),
                    }]
                }
            },
            include: { attachments: true }
        });

        const { updateConversationLastMessage } = await import('@/lib/conversations/update');
        const internalConv = await db.conversation.findUnique({
            where: { ghlConversationId: conversationId },
            select: { id: true }
        });

        if (internalConv) {
            await updateConversationLastMessage({
                conversationId: internalConv.id,
                messageBody: previewBody,
                messageType: 'TYPE_WHATSAPP',
                messageDate: new Date(),
                direction: 'outbound',
            });
        }

        const accessToken = location.ghlAccessToken;
        if (accessToken) {
            (async () => {
                try {
                    let targetGhlId = contact.ghlContactId;

                    if (!targetGhlId && location.ghlLocationId) {
                        const { ensureRemoteContact } = await import("@/lib/crm/contact-sync");
                        const newId = await ensureRemoteContact(contact.id, location.ghlLocationId, accessToken);
                        if (newId) targetGhlId = newId;
                    }

                    if (targetGhlId) {
                        const customProviderId = process.env.GHL_CUSTOM_PROVIDER_ID;
                        const ghlPayload: any = {
                            contactId: targetGhlId,
                            type: customProviderId ? 'Custom' : 'WhatsApp',
                            message: previewBody
                        };
                        if (customProviderId) ghlPayload.conversationProviderId = customProviderId;
                        await sendMessage(accessToken, ghlPayload);
                    }
                } catch (ghlErr) {
                    console.error('[sendWhatsAppImageReply] GHL sync failed:', ghlErr);
                }
            })();
        }

        return { success: true, messageId: created.id };
    } catch (err: any) {
        console.error("Evolution API image send failed:", err);
        return { success: false, error: `WhatsApp image send failed: ${err.message || 'Unknown error'}` };
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
                    select: { id: true, phone: true, ghlContactId: true, name: true, contactType: true }
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

                const eligibility = await checkWhatsAppPhoneEligibility(
                    { evolutionInstanceId: location.evolutionInstanceId },
                    contact.phone,
                    {
                        contactName: contact.name,
                        contactType: contact.contactType,
                    }
                );

                if (eligibility.status === 'ineligible') {
                    return {
                        success: false,
                        error: eligibility.reason || "This contact's phone number is not registered on WhatsApp."
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

    const explicitModel = typeof model === "string" && model.trim() ? model.trim() : undefined;
    let resolvedDraftModel = explicitModel;
    if (!resolvedDraftModel) {
        const { resolveAiDraftDefaultModel } = await import("@/lib/ai/fetch-models");
        resolvedDraftModel = await resolveAiDraftDefaultModel(location.id);
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

    // Resolve current agent display name (DB-first; no extra Clerk API calls).
    const { userId } = await auth();
    let agentName: string | undefined;
    if (userId) {
        const agentUser = await db.user.findUnique({
            where: { clerkId: userId },
            select: { name: true, firstName: true, lastName: true, email: true }
        });
        if (agentUser) {
            const fullName = [agentUser.firstName, agentUser.lastName].filter(Boolean).join(" ").trim();
            agentName = agentUser.name || fullName || agentUser.email || undefined;
        }
    }

    // Use internal location.id (for SiteConfig lookup), not ghlLocationId (external GHL ID)
    const result = await generateDraft({
        conversationId,
        contactId,
        locationId: location.id, // CRITICAL: SiteConfig uses internal Location.id
        accessToken: location.ghlAccessToken,
        agentName,
        businessName: location.name || undefined,
        instruction,
        model: resolvedDraftModel
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
        select: {
            id: true,
            contactId: true,
            lastMessageType: true,
            createdAt: true,
            contact: {
                select: {
                    id: true,
                    message: true,
                    name: true
                }
            }
        }
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

    // Heal empty shell conversations created from Contacts by seeding the lead inquiry text
    // when the Contact record already contains a captured message.
    const seedResult = await seedConversationFromContactLeadText({
        conversationId: conversation.id,
        contact: conversation.contact,
        messageType: conversation.lastMessageType || "TYPE_SMS",
        messageDate: conversation.createdAt,
        source: "contact_bootstrap"
    });
    if (seedResult.seeded) {
        console.log(`[ORCHESTRATE_ACTION] Seeded conversation ${conversationId} from contact.message before orchestration`);
    }

    // Fetch conversation history (ignore system notes; AI orchestration should operate on real dialog turns)
    const messages = await db.message.findMany({
        where: {
            conversationId: conversation.id,
            direction: { in: ['inbound', 'outbound'] }
        },
        orderBy: { createdAt: 'asc' },
        take: 20
    });

    let messageForOrchestration: string;
    let historyForOrchestration: string;
    let bootstrapMode: "none" | "empty_thread" = "none";

    if (messages.length === 0) {
        // Last-resort fallback: allow Smart Agent to draft the *first* outreach on a brand-new thread.
        // The classifier will typically route this to lead qualification (or UNKNOWN -> lead qualification).
        bootstrapMode = "empty_thread";
        messageForOrchestration = "I am interested in a property and would like more information. This is our first contact.";
        historyForOrchestration = "";
        console.warn(`[ORCHESTRATE_ACTION] No dialog messages for ${conversationId}; using empty-thread bootstrap prompt.`);
    } else {
        const lastMessage = messages[messages.length - 1];
        messageForOrchestration = (lastMessage.body || "").trim();
        if (!messageForOrchestration) {
            messageForOrchestration = `[${lastMessage.direction} ${lastMessage.type || "message"} with no text body]`;
        }
        historyForOrchestration = messages
            .map((m) => {
                const speaker = m.direction === 'inbound' ? 'User' : 'Agent';
                const body = (m.body || "").trim() || `[${m.type || "message"} with no text body]`;
                return `${speaker}: ${body}`;
            })
            .join("\n");
    }

    // Dynamic import to avoid build-time circular deps if any (though standard import is likely fine)
    const { orchestrate } = await import("@/lib/ai/orchestrator");

    const result = await orchestrate({
        conversationId: conversation.id, // Use real DB ID, not ghlConversationId
        contactId: resolvedContactId,
        message: messageForOrchestration,
        conversationHistory: historyForOrchestration,
        dealStage
    });

    if (bootstrapMode !== "none") {
        return {
            ...result,
            bootstrapMode
        };
    }

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

export async function getEmailSyncProvidersStatus() {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return { providers: [] as any[] };
        }

        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: {
                googleAccessToken: true,
                googleRefreshToken: true,
                googleSyncEnabled: true,
                gmailSyncState: {
                    select: {
                        emailAddress: true,
                        lastSyncedAt: true,
                        watchExpiration: true
                    }
                },
                outlookAuthMethod: true,
                outlookEmail: true,
                outlookAccessToken: true,
                outlookRefreshToken: true,
                outlookSyncEnabled: true,
                outlookSessionCookies: true,
                outlookPasswordEncrypted: true,
                outlookSessionExpiry: true,
                outlookSubscriptionExpiry: true,
                outlookSyncState: {
                    select: {
                        emailAddress: true,
                        lastSyncedAt: true
                    }
                }
            }
        });

        if (!user) {
            return { providers: [] as any[] };
        }

        const now = Date.now();
        const minutesAgo = (value?: Date | null) =>
            value ? Math.floor((now - value.getTime()) / 60000) : null;

        const gmailConnected = !!(
            user.googleSyncEnabled &&
            (user.googleAccessToken || user.googleRefreshToken)
        );
        const gmailConfigured = !!(
            user.googleAccessToken ||
            user.googleRefreshToken ||
            user.googleSyncEnabled ||
            user.gmailSyncState
        );
        const gmailLastSync = user.gmailSyncState?.lastSyncedAt ?? null;
        const gmailWatchExpiry = user.gmailSyncState?.watchExpiration ?? null;
        const gmailWatchExpired = !!(gmailWatchExpiry && gmailWatchExpiry.getTime() < now);
        const gmailAgeMins = minutesAgo(gmailLastSync);

        let gmailHealth: 'healthy' | 'warning' | 'stale' | 'error' = 'warning';
        if (gmailConnected) {
            if (!gmailLastSync) gmailHealth = 'warning';
            else if ((gmailAgeMins ?? 9999) > 120) gmailHealth = 'stale';
            else gmailHealth = 'healthy';

            if (gmailWatchExpired && gmailHealth === 'healthy') {
                gmailHealth = 'warning';
            }
        } else {
            gmailHealth = 'error';
        }

        const inferredOutlookMethod =
            (user.outlookAuthMethod as 'oauth' | 'puppeteer' | null)
            || (user.outlookSessionCookies ? 'puppeteer' : null)
            || ((user.outlookAccessToken || user.outlookRefreshToken) ? 'oauth' : null);
        const outlookConfigured = !!(
            user.outlookSyncEnabled ||
            user.outlookSessionCookies ||
            user.outlookAccessToken ||
            user.outlookRefreshToken ||
            user.outlookAuthMethod
        );
        const outlookCanAutoReconnect = inferredOutlookMethod === 'puppeteer' && !!user.outlookPasswordEncrypted;

        const outlookSessionExpired = inferredOutlookMethod === 'puppeteer'
            ? (user.outlookSessionExpiry ? user.outlookSessionExpiry.getTime() < now : true)
            : false;
        const outlookSubscriptionExpired = inferredOutlookMethod === 'oauth'
            ? !!(user.outlookSubscriptionExpiry && user.outlookSubscriptionExpiry.getTime() < now)
            : false;

        const outlookConnected = !!(
            user.outlookSyncEnabled &&
            (
                (inferredOutlookMethod === 'puppeteer' && user.outlookSessionCookies && !outlookSessionExpired) ||
                (inferredOutlookMethod === 'oauth' && (user.outlookAccessToken || user.outlookRefreshToken))
            )
        );

        const outlookLastSync = user.outlookSyncState?.lastSyncedAt ?? null;
        const outlookAgeMins = minutesAgo(outlookLastSync);

        let outlookHealth: 'healthy' | 'warning' | 'stale' | 'error' = 'warning';
        if (outlookConnected) {
            if (!outlookLastSync) outlookHealth = 'warning';
            else if ((outlookAgeMins ?? 9999) > 180) outlookHealth = 'stale';
            else outlookHealth = 'healthy';

            if ((outlookSessionExpired || outlookSubscriptionExpired) && outlookHealth === 'healthy') {
                outlookHealth = 'warning';
            }
        } else {
            outlookHealth = (outlookSessionExpired || outlookSubscriptionExpired) ? 'error' : 'error';
        }

        const providers = [
            {
                provider: 'gmail' as const,
                configured: gmailConfigured,
                connected: gmailConnected,
                health: gmailHealth,
                email: user.gmailSyncState?.emailAddress || null,
                lastSyncedAt: gmailLastSync?.toISOString() || null,
                expectedCadenceMinutes: 5,
                watchExpiration: gmailWatchExpiry?.toISOString() || null,
                watchExpired: gmailWatchExpired,
                settingsPath: '/admin/settings/integrations/google'
            },
            {
                provider: 'outlook' as const,
                configured: outlookConfigured,
                connected: outlookConnected,
                health: outlookHealth,
                method: inferredOutlookMethod,
                email: user.outlookEmail || user.outlookSyncState?.emailAddress || null,
                // This timestamp is treated as email sync freshness; contact sync no longer updates it.
                lastSyncedAt: outlookLastSync?.toISOString() || null,
                expectedCadenceMinutes: inferredOutlookMethod === 'puppeteer' ? 15 : 5,
                sessionExpiry: user.outlookSessionExpiry?.toISOString() || null,
                sessionExpired: outlookSessionExpired,
                canAutoReconnect: outlookCanAutoReconnect,
                subscriptionExpiry: user.outlookSubscriptionExpiry?.toISOString() || null,
                subscriptionExpired: outlookSubscriptionExpired,
                settingsPath: '/admin/settings/integrations/microsoft'
            }
        ];

        return { providers };
    } catch (error) {
        console.error('[getEmailSyncProvidersStatus] Error:', error);
        return { providers: [] as any[] };
    }
}

export async function getAvailableAiModelsAction() {
    const location = await getBasicLocationContext();
    const { getAvailableModels } = await import("@/lib/ai/fetch-models");
    return getAvailableModels(location.id);
}

export async function getAiDraftModelPickerStateAction() {
    const location = await getBasicLocationContext();
    const { getAiDraftModelPickerState } = await import("@/lib/ai/fetch-models");
    return getAiDraftModelPickerState(location.id);
}

export async function getAiModelPickerDefaultsAction() {
    const location = await getBasicLocationContext();
    const { getAiModelPickerDefaults } = await import("@/lib/ai/fetch-models");
    return getAiModelPickerDefaults(location.id);
}

export async function getWhatsAppChannelEligibility(conversationId: string) {
    try {
        const location = await getBasicLocationContext();

        const conversation = await db.conversation.findFirst({
            where: {
                ghlConversationId: conversationId,
                locationId: location.id,
            },
            select: {
                contact: {
                    select: {
                        name: true,
                        phone: true,
                        contactType: true,
                    }
                }
            }
        });

        if (!conversation?.contact) {
            return {
                success: false,
                eligible: null as boolean | null,
                status: 'unknown' as const,
                reason: 'Conversation contact not found.',
            };
        }

        const contact = conversation.contact;
        const eligibility = await checkWhatsAppPhoneEligibility(
            {
                evolutionInstanceId: location.evolutionInstanceId,
            },
            contact.phone,
            {
                contactName: contact.name,
                contactType: contact.contactType,
                verifyServiceHealth: true,
            }
        );

        return {
            success: true,
            eligible: eligibility.status === 'eligible' ? true : eligibility.status === 'ineligible' ? false : null,
            status: eligibility.status,
            reason: eligibility.reason,
            phone: contact.phone || null,
        };
    } catch (error: any) {
        console.error('[getWhatsAppChannelEligibility] Error:', error);
        return {
            success: false,
            eligible: null as boolean | null,
            status: 'unknown' as const,
            reason: error?.message || 'Failed to check WhatsApp eligibility.',
        };
    }
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

export async function markConversationAsRead(conversationId: string) {
    const location = await getAuthenticatedLocation();

    if (!conversationId) {
        return { success: false, error: "Missing conversationId" };
    }

    try {
        await db.conversation.updateMany({
            where: {
                ghlConversationId: conversationId,
                locationId: location.id,
            },
            data: {
                unreadCount: 0,
            }
        });

        return { success: true };
    } catch (error: any) {
        console.error("markConversationAsRead error:", error);
        return { success: false, error: error?.message || "Failed to mark conversation as read" };
    }
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

async function checkWhatsAppPhoneEligibility(
    location: { evolutionInstanceId?: string | null },
    phone: string | null | undefined,
    options?: {
        contactName?: string | null;
        contactType?: string | null;
        verifyServiceHealth?: boolean;
    }
): Promise<{ status: 'eligible' | 'ineligible' | 'unknown'; reason?: string; normalizedDigits?: string }> {
    const contactName = options?.contactName || 'This contact';
    const phoneValue = String(phone || '').trim();

    if (!phoneValue) {
        return {
            status: 'ineligible',
            reason: `${contactName} does not have a phone number.`,
        };
    }

    if (options?.contactType === 'WhatsAppGroup' || phoneValue.includes('@g.us')) {
        return { status: 'eligible' };
    }

    if (phoneValue.includes('*')) {
        return {
            status: 'ineligible',
            reason: `${contactName}'s phone number "${phoneValue}" is masked (contains ***), so WhatsApp cannot be verified.`,
        };
    }

    const rawDigits = phoneValue.replace(/\D/g, '');
    if (rawDigits.length < 7) {
        return {
            status: 'ineligible',
            reason: `${contactName}'s phone number "${phoneValue}" is invalid or too short.`,
            normalizedDigits: rawDigits,
        };
    }

    if (!location?.evolutionInstanceId) {
        return {
            status: 'unknown',
            reason: 'WhatsApp eligibility check is unavailable (Evolution is not connected).',
            normalizedDigits: rawDigits,
        };
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");

        if (options?.verifyServiceHealth) {
            const health = await evolutionClient.healthCheck();
            if (!health.ok) {
                return {
                    status: 'unknown',
                    reason: health.error || 'WhatsApp service is unavailable.',
                    normalizedDigits: rawDigits,
                };
            }
        }

        const lookup = await evolutionClient.checkWhatsAppNumber(location.evolutionInstanceId, rawDigits);
        if (lookup.exists) {
            return {
                status: 'eligible',
                normalizedDigits: rawDigits,
            };
        }

        return {
            status: 'ineligible',
            reason: `${contactName}'s phone number is not registered on WhatsApp.`,
            normalizedDigits: rawDigits,
        };
    } catch (err) {
        console.warn(`[WhatsAppEligibility] Lookup failed for ${rawDigits}:`, err);
        return {
            status: 'unknown',
            reason: 'Could not verify WhatsApp registration right now.',
            normalizedDigits: rawDigits,
        };
    }
}

async function resolvePreferredChannelTypeForPhone(
    location: { evolutionInstanceId?: string | null },
    phone: string | null | undefined
): Promise<'TYPE_WHATSAPP' | 'TYPE_SMS'> {
    const rawDigits = String(phone || '').replace(/\D/g, '');
    if (!location?.evolutionInstanceId || rawDigits.length < 7) {
        return 'TYPE_SMS';
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        const lookup = await evolutionClient.checkWhatsAppNumber(location.evolutionInstanceId, rawDigits);
        if (lookup.exists) {
            console.log(`[ChannelDetect] WhatsApp confirmed for ${rawDigits}`);
            return 'TYPE_WHATSAPP';
        }
    } catch (err) {
        console.warn(`[ChannelDetect] WhatsApp lookup failed for ${rawDigits}:`, err);
    }

    return 'TYPE_SMS';
}

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
                        const parsedContent = parseEvolutionMessageContent(messageContent);
                        const senderName = msg.pushName || realSenderPhone || "Unknown";
                        const normalizedBody = isGroup && parsedContent.type !== 'text'
                            ? `[${senderName}]: ${parsedContent.body}`
                            : parsedContent.body;

                        const normalized: any = {
                            from: isFromMe ? location.id : phone,
                            to: isFromMe ? phone : location.id,
                            body: normalizedBody,
                            type: parsedContent.type,
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
    const { userId: clerkUserId } = await auth();
    const currentUser = clerkUserId
        ? await db.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } })
        : null;
    const preferredUserId = currentUser?.id || null;

    // Normalize phone to E.164
    let normalizedPhone = phone.replace(/\s+/g, '').replace(/[-()]/g, '');
    if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = `+${normalizedPhone}`;
    }

    const rawDigits = normalizedPhone.replace(/\D/g, '');
    if (rawDigits.length < 7) {
        return { success: false, error: "Phone number is too short. Please include the country code." };
    }

    const preferredChannelType = await resolvePreferredChannelTypeForPhone(location, rawDigits);

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
        let isNewContact = false;

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
            isNewContact = true;
            console.log(`[NewConversation] Created new contact: ${contact.id} for ${normalizedPhone}`);
        } else {
            console.log(`[NewConversation] Found existing contact: ${contact.name} (${contact.id})`);
        }

        if (isNewContact) {
            await runGoogleAutoSyncForContact({
                locationId: location.id,
                contactId: contact.id,
                source: 'LEAD_CAPTURE',
                event: 'create',
                preferredUserId
            });
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
                    const { messages, remoteJid, candidates } = await fetchEvolutionMessagesForContactHistory({
                        evolutionClient,
                        evolutionInstanceId: location.evolutionInstanceId,
                        contact: {
                            phone: contact.phone,
                            lid: (contact as any).lid || null,
                            contactType: (contact as any).contactType || null,
                        },
                        limit: 30,
                        offset: 0,
                        logPrefix: `[NewConversation][existing:${existingConv.ghlConversationId}]`,
                    });
                    console.log(
                        `[NewConversation] Existing convo history candidates: ${candidates.join(", ") || "(none)"}; selected=${remoteJid || "none"}; found=${messages.length}`
                    );

                    let imported = 0;
                    for (const msg of (messages || [])) {
                        const key = msg.key;
                        const messageContent = msg.message;
                        if (!messageContent || !key?.id) continue;

                        const isFromMe = key.fromMe;
                        const parsedContent = parseEvolutionMessageContent(messageContent);
                        const normalized: any = {
                            from: isFromMe ? location.id : whatsappPhone,
                            to: isFromMe ? whatsappPhone : location.id,
                            body: parsedContent.body,
                            type: parsedContent.type,
                            wamId: key.id,
                            timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                            direction: isFromMe ? 'outbound' : 'inbound',
                            source: 'whatsapp_evolution',
                            locationId: location.id,
                            contactName: isFromMe ? undefined : msg.pushName,
                            lid: extractEvolutionLidJid(key),
                            resolvedPhone: whatsappPhone,
                        };

                        const result = await processNormalizedMessage(normalized);
                        if (result?.status === 'processed') imported++;
                    }

                    console.log(`[NewConversation] Backfilled ${imported} messages for existing conversation`);
                } catch (backfillErr) {
                    console.warn("[NewConversation] History backfill failed:", backfillErr);
                }
            }

            const seedResult = await seedConversationFromContactLeadText({
                conversationId: existingConv.id,
                contact,
                messageType: existingConv.lastMessageType || preferredChannelType,
                messageDate: existingConv.createdAt,
                source: "contact_bootstrap"
            });
            if (seedResult.seeded) {
                console.log(`[NewConversation] Seeded existing conversation ${existingConv.ghlConversationId} from contact.message`);
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
                lastMessageType: preferredChannelType,
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
                const { messages, remoteJid, candidates } = await fetchEvolutionMessagesForContactHistory({
                    evolutionClient,
                    evolutionInstanceId: location.evolutionInstanceId,
                    contact: {
                        phone: contact.phone,
                        lid: (contact as any).lid || null,
                        contactType: (contact as any).contactType || null,
                    },
                    limit: 30,
                    offset: 0,
                    logPrefix: `[NewConversation][new:${conversation.ghlConversationId}]`,
                });
                console.log(
                    `[NewConversation] New convo history candidates: ${candidates.join(", ") || "(none)"}; selected=${remoteJid || "none"}; found=${messages.length}`
                );

                for (const msg of (messages || [])) {
                    const key = msg.key;
                    const messageContent = msg.message;
                    if (!messageContent || !key?.id) continue;

                    const isFromMe = key.fromMe;
                    const parsedContent = parseEvolutionMessageContent(messageContent);
                    const normalized: any = {
                        from: isFromMe ? location.id : whatsappPhone,
                        to: isFromMe ? whatsappPhone : location.id,
                        body: parsedContent.body,
                        type: parsedContent.type,
                        wamId: key.id,
                        timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                        direction: isFromMe ? 'outbound' : 'inbound',
                        source: 'whatsapp_evolution',
                        locationId: location.id,
                        contactName: isFromMe ? undefined : msg.pushName,
                        lid: extractEvolutionLidJid(key),
                        resolvedPhone: whatsappPhone,
                    };

                    const result = await processNormalizedMessage(normalized);
                    if (result?.status === 'processed') messagesImported++;
                }

                console.log(`[NewConversation] Backfilled ${messagesImported} messages for new conversation`);
            } catch (backfillErr) {
                console.warn("[NewConversation] History backfill failed:", backfillErr);
            }
        }

        const seedResult = await seedConversationFromContactLeadText({
            conversationId: conversation.id,
            contact,
            messageType: conversation.lastMessageType || preferredChannelType,
            messageDate: conversation.createdAt,
            source: "contact_bootstrap"
        });
        if (seedResult.seeded) {
            console.log(`[NewConversation] Seeded new conversation ${conversation.ghlConversationId} from contact.message`);
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

const REQUIREMENT_DISTRICTS = ["Paphos", "Nicosia", "Famagusta", "Limassol", "Larnaca"] as const;
const REQUIREMENT_PRICE_OPTIONS = [
    200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 3000, 5000, 50000, 75000, 100000, 125000, 150000, 175000
] as const;

function mergeUniqueText(existing?: string | null, incoming?: string | null): string | undefined {
    const next = incoming?.trim();
    if (!next) return existing || undefined;
    const prev = existing?.trim();
    if (!prev) return next;
    if (prev.toLowerCase().includes(next.toLowerCase())) return prev;
    return `${prev}\n${next}`;
}

function extractPropertyRefsFromLeadText(text: string): string[] {
    const refs = new Set<string>();
    const refRegex = /\b(?:ref(?:erence)?[.:#\s-]*)?([A-Z]{1,4}\d{2,6}|[A-Z]{2,6}-\d{2,6})\b/gi;
    let match: RegExpExecArray | null;

    while ((match = refRegex.exec(text)) !== null) {
        refs.add(match[1].toUpperCase());
    }

    return Array.from(refs);
}

function extractPropertySlugsFromLeadUrls(text: string): string[] {
    const slugs = new Set<string>();
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const matches = text.match(urlRegex) || [];

    for (const rawUrl of matches) {
        try {
            const parsed = new URL(rawUrl);
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts.length === 0) continue;

            const last = parts[parts.length - 1];
            if (last) slugs.add(last.toLowerCase());
        } catch {
            // Ignore invalid URLs
        }
    }

    return Array.from(slugs);
}

function parseNumericToken(token: string): number | null {
    const cleaned = token.replace(/[, ]/g, "").toLowerCase();
    if (!cleaned) return null;

    const hasK = cleaned.endsWith("k");
    const base = hasK ? cleaned.slice(0, -1) : cleaned;
    const value = Number(base);
    if (!Number.isFinite(value)) return null;

    return hasK ? Math.round(value * 1000) : Math.round(value);
}

function parseBudgetRange(raw?: string | null): { min?: number; max?: number } {
    if (!raw) return {};
    const text = raw.toLowerCase();
    const tokens = text.match(/\d+(?:[.,]\d+)?\s*[k]?/g) || [];
    const values = tokens
        .map(parseNumericToken)
        .filter((v): v is number => Number.isFinite(v) && !!v)
        .map(v => Math.max(0, Math.round(v)));

    if (values.length === 0) return {};

    if (/[–—-]|\bto\b/.test(text) && values.length >= 2) {
        const min = Math.min(values[0], values[1]);
        const max = Math.max(values[0], values[1]);
        return { min, max };
    }

    return { max: values[0] };
}

function formatPriceOption(value: number): string {
    return `€${value.toLocaleString("en-US")}`;
}

function mapToMinPriceOption(value?: number): string | null {
    if (!value || value <= 0) return null;
    const eligible = REQUIREMENT_PRICE_OPTIONS.filter(p => p <= value);
    const selected = eligible.length > 0 ? eligible[eligible.length - 1] : REQUIREMENT_PRICE_OPTIONS[0];
    return formatPriceOption(selected);
}

function mapToMaxPriceOption(value?: number): string | null {
    if (!value || value <= 0) return null;
    const eligible = REQUIREMENT_PRICE_OPTIONS.filter(p => p <= value);
    const selected = eligible.length > 0 ? eligible[eligible.length - 1] : REQUIREMENT_PRICE_OPTIONS[0];
    return formatPriceOption(selected);
}

function normalizeRequirementDistrict(raw?: string | null): string | null {
    if (!raw) return null;
    const text = raw.toLowerCase();
    for (const district of REQUIREMENT_DISTRICTS) {
        if (text.includes(district.toLowerCase())) return district;
    }
    return null;
}

function normalizeRequirementBedrooms(raw?: string | null): string | null {
    if (!raw) return null;
    const match = raw.match(/\d+/);
    if (!match) return null;
    const count = Number(match[0]);
    if (!Number.isFinite(count) || count <= 0) return null;
    if (count >= 5) return "5+ Bedrooms";
    return `${count}+ Bedrooms`;
}

function inferRequirementStatusFromLead(rawLeadText: string, budgetText?: string | null): "For Rent" | "For Sale" | null {
    const text = `${rawLeadText}\n${budgetText || ""}`.toLowerCase();
    if (
        text.includes("for rent") ||
        text.includes("to rent") ||
        text.includes("goal\tto rent") ||
        text.includes("goal: to rent") ||
        text.includes("/month") ||
        text.includes(" per month") ||
        text.includes("unfurnished")
    ) {
        return "For Rent";
    }
    if (
        text.includes("for sale") ||
        text.includes("to buy") ||
        text.includes("purchase")
    ) {
        return "For Sale";
    }
    return null;
}

function inferRequirementStatusFromMatchedProperty(property: {
    goal?: string | null;
    title?: string | null;
    slug?: string | null;
}): "For Rent" | "For Sale" | null {
    const text = `${property.title || ""} ${property.slug || ""}`.toLowerCase();
    if (text.includes("for-rent") || text.includes("for rent") || text.includes("rent")) return "For Rent";
    if (text.includes("for-sale") || text.includes("for sale") || text.includes("sale")) return "For Sale";

    if (property.goal === "RENT") return "For Rent";
    if (property.goal === "SALE") return "For Sale";
    return null;
}

async function resolveLeadPropertyMatch(locationId: string, rawLeadText: string) {
    const refs = extractPropertyRefsFromLeadText(rawLeadText);
    const slugs = extractPropertySlugsFromLeadUrls(rawLeadText);

    if (refs.length === 0 && slugs.length === 0) return null;

    const orClauses: any[] = [];
    if (refs.length > 0) {
        orClauses.push({ reference: { in: refs } });
        for (const ref of refs) {
            orClauses.push({ reference: { contains: ref, mode: "insensitive" } });
            orClauses.push({ slug: { contains: ref.toLowerCase(), mode: "insensitive" } });
            orClauses.push({ title: { contains: ref, mode: "insensitive" } });
        }
    }
    if (slugs.length > 0) {
        orClauses.push({ slug: { in: slugs } });
    }

    const candidates = await db.property.findMany({
        where: {
            locationId,
            OR: orClauses
        },
        select: {
            id: true,
            reference: true,
            slug: true,
            title: true,
            goal: true,
            propertyLocation: true,
            city: true
        },
        take: 10
    });

    if (candidates.length === 0) return null;

    const refSet = new Set(refs.map(r => r.toUpperCase()));
    const slugSet = new Set(slugs.map(s => s.toLowerCase()));

    const exactRef = candidates.find(c => c.reference && refSet.has(c.reference.toUpperCase()));
    if (exactRef) return exactRef;

    const exactSlug = candidates.find(c => slugSet.has(c.slug.toLowerCase()));
    if (exactSlug) return exactSlug;

    const fuzzyRef = candidates.find(c => refs.some(ref => c.slug.toLowerCase().includes(ref.toLowerCase())));
    if (fuzzyRef) return fuzzyRef;

    return candidates[0];
}

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
        usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            thoughtsTokens: number;
            toolUsePromptTokens: number;
            cachedContentTokens: number;
            raw: string;
        };
    };
    estimatedCost: {
        usd: number;
        method: string;
        confidence: string;
        breakdown: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            thoughtsTokens: number;
            toolUsePromptTokens: number;
            inferredOutputTokens: number;
            billableInputTokens: number;
            billableOutputTokens: number;
            inputRatePerMillion: number;
            outputRatePerMillion: number;
        };
    };
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

const DEFAULT_LEGACY_CRM_LEAD_SUBJECT_PATTERNS = [
    "you have been assigned a new lead",
    "you need to follow up on a lead",
] as const;

const LEGACY_CRM_LEAD_LABELS = [
    "Name",
    "Tel",
    "Email",
    "Goal",
    "Source",
    "Follow Up",
    "Next Action",
    "Notes",
] as const;

type LegacyCrmLeadEmailClassification = "new_lead" | "follow_up";
type LegacyCrmLeadSenderMatchMode = "exact" | "domain" | "unconfigured" | "none";

interface LegacyCrmLeadEmailFields {
    name?: string | null;
    tel?: string | null;
    email?: string | null;
    goal?: string | null;
    source?: string | null;
    followUp?: string | null;
    nextAction?: string | null;
    notes?: string | null;
}

interface LegacyCrmLeadEmailParseResult {
    matched: boolean;
    reason?: string;
    classification?: LegacyCrmLeadEmailClassification;
    senderEmail: string | null;
    senderMatchMode: LegacyCrmLeadSenderMatchMode;
    subject: string | null;
    bodyText: string;
    leadUrl: string | null;
    leadId: string | null;
    fields: LegacyCrmLeadEmailFields;
    parsedLeadData?: ParsedLeadData;
}

function decodeHtmlEntitiesBasic(input: string): string {
    if (!input) return "";
    const named: Record<string, string> = {
        nbsp: " ",
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        ndash: "-",
        mdash: "-",
    };

    return input
        .replace(/&([a-zA-Z]+);/g, (full, name) => named[name.toLowerCase()] ?? full)
        .replace(/&#(\d+);/g, (_, num) => {
            const code = Number(num);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            const code = Number.parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        });
}

function stripHtmlForLeadParsing(input: string): string {
    if (!input) return "";

    const withLineBreaks = input
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(br|\/p|\/div|\/tr|\/li|\/ul|\/ol|\/table|\/tbody|\/thead|\/td|\/th|\/h\d)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ");

    return decodeHtmlEntitiesBasic(withLineBreaks)
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeEmailFromHeader(input?: string | null): string | null {
    const raw = String(input || "").trim();
    if (!raw) return null;
    const match = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : null;
}

function matchLegacyCrmLeadSender(
    senderEmail: string | null,
    config: { senders: string[]; domains: string[] }
): LegacyCrmLeadSenderMatchMode {
    if (!senderEmail) return "none";

    const senders = (config.senders || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
    const domains = (config.domains || []).map((d) => d.toLowerCase().replace(/^@/, "").trim()).filter(Boolean);

    if (senders.length === 0 && domains.length === 0) return "unconfigured";
    if (senders.includes(senderEmail)) return "exact";

    const senderDomain = senderEmail.split("@")[1] || "";
    if (domains.some((d) => senderDomain === d || senderDomain.endsWith(`.${d}`))) {
        return "domain";
    }

    return "none";
}

function extractLegacyCrmLeadUrl(input: string): string | null {
    if (!input) return null;
    const matches = input.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    const normalized = matches
        .map((u) => decodeHtmlEntitiesBasic(u).replace(/[)\],.;]+$/, ""))
        .filter(Boolean);

    const prioritized = normalized.find((u) => /\/admin\/leads\//i.test(u))
        || normalized.find((u) => /\/leads\//i.test(u))
        || null;

    return prioritized;
}

function extractLegacyCrmLeadId(url: string | null): string | null {
    if (!url) return null;
    const patterns = [
        /\/admin\/leads\/(\d+)(?:\/|$|\?)/i,
        /\/admin\/leads\/[^/]+\/(\d+)(?:\/|$|\?)/i,
        /[?&](?:lead_id|leadId|id)=(\d+)/i,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

function extractLegacyCrmLeadFields(bodyText: string): LegacyCrmLeadEmailFields {
    if (!bodyText) return {};

    let body = bodyText;
    const leadOverviewIndex = body.toLowerCase().indexOf("lead overview");
    if (leadOverviewIndex >= 0) {
        body = body.slice(leadOverviewIndex + "lead overview".length).trim();
    }

    const footerMarkers = [
        "kind regards",
        "always at your disposal",
        "down town cyprus sales & rentals",
    ];
    for (const marker of footerMarkers) {
        const idx = body.toLowerCase().indexOf(marker);
        if (idx > 0) {
            body = body.slice(0, idx).trim();
            break;
        }
    }

    const labelRegex = /\b(Name|Tel|Email|Goal|Source|Follow Up|Next Action|Notes)\b\s*/g;
    const matches: Array<{ label: string; index: number; fullLength: number }> = [];
    let m: RegExpExecArray | null;

    while ((m = labelRegex.exec(body)) !== null) {
        matches.push({
            label: m[1],
            index: m.index,
            fullLength: m[0].length,
        });
    }

    if (matches.length === 0) return {};

    const rawValues: Record<string, string | null> = {};
    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const next = matches[i + 1];
        const start = current.index + current.fullLength;
        const end = next ? next.index : body.length;
        const value = body.slice(start, end).replace(/\s+/g, " ").trim();
        rawValues[current.label] = value || null;
    }

    const clean = (label: string, value?: string | null) => {
        let next = String(value || "").replace(/\s+/g, " ").trim();
        if (!next) return null;

        // Preview fallbacks can truncate and sometimes bleed labels into values.
        for (const knownLabel of LEGACY_CRM_LEAD_LABELS) {
            if (knownLabel === label) continue;
            const idx = next.indexOf(` ${knownLabel} `);
            if (idx > 0) {
                next = next.slice(0, idx).trim();
            }
        }

        if (!next) return null;
        if (label === "Email" && !next.includes("@")) return null;
        if (label === "Tel" && !/\d/.test(next)) return null;

        return next;
    };

    const fields: LegacyCrmLeadEmailFields = {
        name: clean("Name", rawValues["Name"]),
        tel: clean("Tel", rawValues["Tel"]),
        email: clean("Email", rawValues["Email"]),
        goal: clean("Goal", rawValues["Goal"]),
        source: clean("Source", rawValues["Source"]),
        followUp: clean("Follow Up", rawValues["Follow Up"]),
        nextAction: clean("Next Action", rawValues["Next Action"]),
        notes: clean("Notes", rawValues["Notes"]),
    };

    // Fallback split when Follow Up leaks into Source or vice versa due truncation.
    if (fields.source && !fields.followUp) {
        const idx = fields.source.toLowerCase().indexOf(" follow up ");
        if (idx > 0) {
            fields.followUp = fields.source.slice(idx + 1).trim();
            fields.source = fields.source.slice(0, idx).trim();
        }
    }
    if (fields.followUp && !fields.nextAction) {
        const idx = fields.followUp.toLowerCase().indexOf(" next action ");
        if (idx > 0) {
            fields.nextAction = fields.followUp.slice(idx + 1).trim();
            fields.followUp = fields.followUp.slice(0, idx).trim();
        }
    }

    return fields;
}

function buildParsedLeadDataFromLegacyCrmEmail(
    classification: LegacyCrmLeadEmailClassification,
    fields: LegacyCrmLeadEmailFields,
    leadUrl: string | null
): ParsedLeadData {
    const sourceLabel = fields.source?.trim() || null;
    const source = sourceLabel ? `Old CRM (${sourceLabel})` : "Old CRM Email";

    const notes: string[] = [
        classification === "follow_up"
            ? "Old CRM follow-up reminder email notification"
            : "Old CRM new lead assignment email notification",
    ];

    if (fields.goal) notes.push(`Goal: ${fields.goal}`);
    if (sourceLabel) notes.push(`Source: ${sourceLabel}`);
    if (fields.followUp) notes.push(`Follow Up: ${fields.followUp}`);
    if (fields.nextAction) notes.push(`Next Action: ${fields.nextAction}`);
    if (fields.notes) notes.push(`Notes: ${fields.notes}`);
    if (leadUrl) notes.push(`Old CRM Lead URL: ${leadUrl}`);

    return {
        contact: {
            name: fields.name || null,
            phone: fields.tel || null,
            email: fields.email || null,
        },
        requirements: {
            budget: null,
            location: null,
            type: null,
            bedrooms: null,
        },
        messageContent: null,
        internalNotes: notes.join("\n"),
        source,
    };
}

function parseLegacyCrmFollowUpDate(input?: string | null): Date | null {
    if (!input) return null;
    const normalized = input
        .replace(/next action[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return null;

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function parseLegacyCrmLeadNotificationEmail(args: {
    subject?: string | null;
    emailFrom?: string | null;
    body?: string | null;
    configuredSenders?: string[] | null;
    configuredDomains?: string[] | null;
    configuredSubjectPatterns?: string[] | null;
}): LegacyCrmLeadEmailParseResult {
    const senderEmail = normalizeEmailFromHeader(args.emailFrom);
    const subject = String(args.subject || "").trim() || null;
    const bodyRaw = String(args.body || "");
    const bodyText = stripHtmlForLeadParsing(bodyRaw);

    const senderMatchMode = matchLegacyCrmLeadSender(senderEmail, {
        senders: (args.configuredSenders || []) as string[],
        domains: (args.configuredDomains || []) as string[],
    });

    const subjectPatterns = ((args.configuredSubjectPatterns || []) as string[])
        .map((s) => String(s || "").trim().toLowerCase())
        .filter(Boolean);
    const effectiveSubjectPatterns = subjectPatterns.length > 0
        ? subjectPatterns
        : Array.from(DEFAULT_LEGACY_CRM_LEAD_SUBJECT_PATTERNS);

    const subjectLower = (subject || "").toLowerCase();
    const subjectMatched = effectiveSubjectPatterns.some((pattern) => subjectLower.includes(pattern));
    const hasLeadOverview = bodyText.toLowerCase().includes("lead overview");

    if (!subjectMatched) {
        return {
            matched: false,
            reason: "Subject does not match legacy CRM lead notification patterns",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    if (!hasLeadOverview) {
        return {
            matched: false,
            reason: "Body does not contain 'Lead Overview' marker",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    if (senderMatchMode === "none") {
        return {
            matched: false,
            reason: "Sender does not match configured legacy CRM notifier email/domain",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    const classification: LegacyCrmLeadEmailClassification = subjectLower.includes("follow up on a lead")
        ? "follow_up"
        : "new_lead";

    const fields = extractLegacyCrmLeadFields(bodyText);
    const leadUrl = extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`);
    const leadId = extractLegacyCrmLeadId(leadUrl);

    if (!fields.name && !fields.tel && !fields.email) {
        return {
            matched: false,
            reason: "Could not extract key lead identity fields (name/phone/email)",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl,
            leadId,
            fields,
        };
    }

    return {
        matched: true,
        classification,
        senderEmail,
        senderMatchMode,
        subject,
        bodyText,
        leadUrl,
        leadId,
        fields,
        parsedLeadData: buildParsedLeadDataFromLegacyCrmEmail(classification, fields, leadUrl),
    };
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
        const costEstimate = calculateRunCostFromUsage(modelId, {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            thoughtsTokens: usage.thoughtsTokens,
            toolUsePromptTokens: usage.toolUsePromptTokens
        });

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
                parsed: result,
                usage
            },
            estimatedCost: {
                usd: costEstimate.amount,
                method: costEstimate.method,
                confidence: costEstimate.confidence,
                breakdown: costEstimate.breakdown
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

type CreateParsedLeadOptions = {
    locationOverride?: any;
    skipAuthUserLookup?: boolean;
    preferredUserIdOverride?: string | null;
};

export async function createParsedLead(
    data: ParsedLeadData,
    originalText: string,
    trace?: LeadAnalysisTrace,
    options?: CreateParsedLeadOptions
) {
    const location = options?.locationOverride || await getAuthenticatedLocation();

    let preferredUserId: string | null = options?.preferredUserIdOverride ?? null;
    if (!options?.skipAuthUserLookup && preferredUserId == null) {
        try {
            const { userId: clerkUserId } = await auth();
            const currentUser = clerkUserId
                ? await db.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } })
                : null;
            preferredUserId = currentUser?.id || null;
        } catch (authError) {
            console.warn("[createParsedLead] auth() unavailable in current context, continuing without preferred user id");
            preferredUserId = null;
        }
    }

    try {
        // 1. Resolve or Create Contact
        let contactId: string | null = null;
        let isNewContact = false;
        let existingContactForMerge: {
            id: string;
            propertiesInterested: string[];
            requirementOtherDetails: string | null;
            requirementPropertyLocations: string[];
            requirementDistrict: string;
            requirementStatus: string;
        } | null = null;

        const leadResolutionText = [
            originalText,
            data.internalNotes,
            data.messageContent,
            data.requirements?.location,
            data.requirements?.budget,
            data.requirements?.type
        ]
            .filter(Boolean)
            .join("\n");

        let preferredChannelType: 'TYPE_WHATSAPP' | 'TYPE_SMS' | 'TYPE_EMAIL' =
            await resolvePreferredChannelTypeForPhone(location, data.contact?.phone);
        const phoneDigits = String(data.contact?.phone || '').replace(/\D/g, '');
        if (phoneDigits.length < 7 && data.contact?.email) {
            preferredChannelType = 'TYPE_EMAIL';
        }

        // Try to find by Phone
        if (data.contact?.phone) {
            // Clean phone
            const phone = data.contact.phone.replace(/\D/g, "");
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

        if (contactId) {
            existingContactForMerge = await db.contact.findUnique({
                where: { id: contactId },
                select: {
                    id: true,
                    propertiesInterested: true,
                    requirementOtherDetails: true,
                    requirementPropertyLocations: true,
                    requirementDistrict: true,
                    requirementStatus: true
                }
            });
        }

        // Create or Update
        const contactData: any = {
            locationId: location.id,
            status: "New",
            leadSource: (data.source && String(data.source).trim()) ? String(data.source).trim() : "Manual Import"
        };

        if (data.contact?.name) contactData.name = data.contact.name;
        if (data.contact?.phone) contactData.phone = data.contact.phone;
        if (data.contact?.email) contactData.email = data.contact.email;

        const normalizedDistrict = normalizeRequirementDistrict(data.requirements?.location);
        const normalizedBedrooms = normalizeRequirementBedrooms(data.requirements?.bedrooms);
        const parsedBudget = parseBudgetRange(data.requirements?.budget);
        const normalizedMinPrice = mapToMinPriceOption(parsedBudget.min);
        const normalizedMaxPrice = mapToMaxPriceOption(parsedBudget.max);
        const inferredStatus = inferRequirementStatusFromLead(leadResolutionText, data.requirements?.budget);

        if (data.requirements) {
            if (normalizedMinPrice) contactData.requirementMinPrice = normalizedMinPrice;
            if (normalizedMaxPrice) contactData.requirementMaxPrice = normalizedMaxPrice;
            if (normalizedDistrict) contactData.requirementDistrict = normalizedDistrict;
            if (normalizedBedrooms) contactData.requirementBedrooms = normalizedBedrooms;
            if (data.requirements.type) contactData.requirementPropertyTypes = [data.requirements.type];
        }
        if (normalizedDistrict) contactData.requirementPropertyLocations = [normalizedDistrict];
        if (inferredStatus) contactData.requirementStatus = inferredStatus;
        if (data.internalNotes) contactData.requirementOtherDetails = data.internalNotes;

        const loadExistingContactForMerge = async (id: string) => {
            existingContactForMerge = await db.contact.findUnique({
                where: { id },
                select: {
                    id: true,
                    propertiesInterested: true,
                    requirementOtherDetails: true,
                    requirementPropertyLocations: true,
                    requirementDistrict: true,
                    requirementStatus: true
                }
            });
        };

        const updateExistingContact = async (id: string) => {
            if (!existingContactForMerge || existingContactForMerge.id !== id) {
                await loadExistingContactForMerge(id);
            }

            // Remove locationId, status, leadSource from update data to avoid overwriting existing state
            const { locationId, status, leadSource, ...updateData } = contactData;
            if (data.internalNotes) {
                updateData.requirementOtherDetails = mergeUniqueText(existingContactForMerge?.requirementOtherDetails, data.internalNotes);
            }
            if (Array.isArray(updateData.requirementPropertyLocations)) {
                updateData.requirementPropertyLocations = Array.from(new Set([
                    ...(existingContactForMerge?.requirementPropertyLocations || []),
                    ...updateData.requirementPropertyLocations
                ]));
            }

            await db.contact.update({
                where: { id },
                data: {
                    ...updateData,
                }
            });
        };

        if (contactId) {
            // Update existing
            await updateExistingContact(contactId);
        } else {
            // Create New
            if (data.internalNotes) contactData.notes = data.internalNotes;
            if (data.internalNotes) contactData.requirementOtherDetails = data.internalNotes;
            try {
                const newContact = await db.contact.create({ data: contactData });
                contactId = newContact.id;
                isNewContact = true;
            } catch (createErr: any) {
                const isUniqueConstraint =
                    createErr?.code === 'P2002' ||
                    String(createErr?.message || '').includes('Unique constraint failed');

                if (!isUniqueConstraint) {
                    throw createErr;
                }

                const duplicateMatchClauses: any[] = [];
                if (contactData.phone) duplicateMatchClauses.push({ phone: contactData.phone });
                if (contactData.email) duplicateMatchClauses.push({ email: contactData.email });

                const duplicateContact = duplicateMatchClauses.length > 0
                    ? await db.contact.findFirst({
                        where: {
                            locationId: location.id,
                            OR: duplicateMatchClauses,
                        },
                        select: { id: true }
                    })
                    : null;

                if (!duplicateContact?.id) {
                    throw createErr;
                }

                contactId = duplicateContact.id;
                isNewContact = false;
                await updateExistingContact(contactId);
            }
        }

        // Deterministic property matching/linking for paste imports (before orchestration)
        const matchedProperty = await resolveLeadPropertyMatch(location.id, leadResolutionText);
        if (matchedProperty && contactId) {
            const contactForProperty = await db.contact.findUnique({
                where: { id: contactId },
                select: {
                    propertiesInterested: true,
                    requirementStatus: true,
                    requirementDistrict: true,
                    requirementPropertyLocations: true
                }
            });

            const nextInterested = Array.from(new Set([
                ...(contactForProperty?.propertiesInterested || []),
                matchedProperty.id
            ]));

            const statusFromProperty = inferRequirementStatusFromMatchedProperty(matchedProperty);
            const derivedStatus = inferredStatus || statusFromProperty;
            const propertyDistrict = normalizeRequirementDistrict(matchedProperty.propertyLocation || matchedProperty.city || null);

            const propertyPatch: any = {
                propertiesInterested: nextInterested
            };

            if (derivedStatus) {
                propertyPatch.requirementStatus = derivedStatus;
            }

            if ((!contactForProperty?.requirementDistrict || contactForProperty.requirementDistrict === "Any District") && propertyDistrict) {
                propertyPatch.requirementDistrict = propertyDistrict;
            }

            if (propertyDistrict) {
                propertyPatch.requirementPropertyLocations = Array.from(new Set([
                    ...(contactForProperty?.requirementPropertyLocations || []),
                    propertyDistrict
                ]));
            }

            // Do not auto-create ContactPropertyRole for lead imports.
            // "Roles & Associations" is reserved for explicit relationship roles, not initial lead interest.
            await db.contact.update({
                where: { id: contactId },
                data: propertyPatch
            });
        }

        if (contactId) {
            await runGoogleAutoSyncForContact({
                locationId: location.id,
                contactId,
                source: 'LEAD_CAPTURE',
                event: isNewContact ? 'create' : 'update',
                preferredUserId
            });
        }

        // 2. Ensure Conversation Exists
        let conversation = await db.conversation.findFirst({
            where: { locationId: location.id, contactId: contactId! }
        });
        let conversationWasCreated = false;

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
                    lastMessageType: preferredChannelType,
                    unreadCount: 0
                }
            });
            conversationWasCreated = true;
        } else if (
            preferredChannelType === 'TYPE_WHATSAPP' &&
            (!conversation.lastMessageType || String(conversation.lastMessageType).toUpperCase().includes('SMS'))
        ) {
            // Upgrade default composer channel for imported leads without overriding email threads.
            conversation = await db.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageType: preferredChannelType }
            });
        }

        // 2.5 Save Analysis Trace if provided
        if (trace) {
            try {
                const estimatedCost = trace.estimatedCost || (() => {
                    const fallbackEstimate = calculateRunCostFromUsage(trace.model || 'default', {
                        promptTokens: trace.promptTokens || 0,
                        completionTokens: trace.completionTokens || 0,
                        totalTokens: trace.totalTokens || 0
                    });
                    return {
                        usd: fallbackEstimate.amount,
                        method: fallbackEstimate.method,
                        confidence: fallbackEstimate.confidence,
                        breakdown: fallbackEstimate.breakdown
                    };
                })();

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
                            },
                            {
                                step: 3,
                                description: "Usage & cost estimate",
                                conclusion: `Estimated run cost (${estimatedCost.confidence} confidence)`,
                                data: estimatedCost
                            },
                            {
                                step: 4,
                                description: "Import enrichment",
                                conclusion: matchedProperty
                                    ? `Resolved property link: ${matchedProperty.reference || matchedProperty.slug}`
                                    : "No deterministic property reference match found during import",
                                data: matchedProperty
                                    ? {
                                        propertyId: matchedProperty.id,
                                        reference: matchedProperty.reference,
                                        slug: matchedProperty.slug,
                                        goal: matchedProperty.goal
                                    }
                                    : null
                            }
                        ],
                        toolCalls: [
                            {
                                tool: "gemini.generateContent",
                                arguments: trace.llmRequest,
                                result: trace.llmResponse,
                                error: null
                            },
                            {
                                tool: "lead_import.resolve_property",
                                arguments: {
                                    source: "paste_lead",
                                    locationId: location.id
                                },
                                result: matchedProperty
                                    ? {
                                        id: matchedProperty.id,
                                        reference: matchedProperty.reference,
                                        slug: matchedProperty.slug,
                                        goal: matchedProperty.goal
                                    }
                                    : null,
                                error: null
                            }
                        ],
                        promptTokens: trace.promptTokens,
                        completionTokens: trace.completionTokens,
                        totalTokens: trace.totalTokens,
                        cost: estimatedCost.usd,
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
            const messageCreatedAt = new Date();
            const message = await db.message.create({
                data: {
                    conversationId: conversation.id,
                    body: data.messageContent,
                    direction: 'inbound',
                    type: preferredChannelType,
                    status: 'received',
                    createdAt: messageCreatedAt,
                    source: data.source || 'paste_import'
                }
            });

            await updateConversationLastMessage({
                conversationId: conversation.id,
                messageBody: data.messageContent,
                messageType: preferredChannelType,
                messageDate: messageCreatedAt,
                direction: 'inbound'
            });

            // Trigger AI
            await orchestrateAction(conversation.ghlConversationId, contactId!);

            return {
                success: true,
                conversationId: conversation.ghlConversationId,
                internalConversationId: conversation.id,
                contactId,
                action: 'replied'
            };
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

            if (conversationWasCreated && preferredChannelType === 'TYPE_WHATSAPP' && conversation.lastMessageType !== 'TYPE_WHATSAPP') {
                await db.conversation.update({
                    where: { id: conversation.id },
                    data: { lastMessageType: 'TYPE_WHATSAPP' }
                });
            }

            return {
                success: true,
                conversationId: conversation.ghlConversationId,
                internalConversationId: conversation.id,
                contactId,
                action: 'imported'
            };
        }
    } catch (e: any) {
        console.error("createParsedLead Error:", e);
        return { success: false, error: e.message };
    }
}

async function maybeGenerateLegacyCrmAutoFirstContactDraft(args: {
    location: any;
    contactId: string | null;
    internalConversationId: string | null;
    ghlConversationId: string | null;
    force?: boolean;
}) {
    const force = !!args.force;
    const enabled = !!args.location?.legacyCrmLeadEmailAutoDraftFirstContact;
    if (!enabled) {
        return { attempted: false, skipped: true, reason: "Auto-draft disabled in settings" };
    }

    if (!args.contactId || !args.internalConversationId || !args.ghlConversationId) {
        return { attempted: false, skipped: true, reason: "Missing conversation/contact identifiers for auto-draft" };
    }

    const existingOutbound = await db.message.count({
        where: {
            conversationId: args.internalConversationId,
            direction: 'outbound',
            NOT: [{ type: 'TYPE_NOTE' }]
        }
    });

    if (existingOutbound > 0 && !force) {
        return { attempted: false, skipped: true, reason: "Conversation already has outbound messages" };
    }

    let draftLocation = args.location;
    try {
        if (draftLocation?.ghlAccessToken || draftLocation?.ghlRefreshToken) {
            draftLocation = await refreshGhlAccessToken(draftLocation);
        }
    } catch (tokenError) {
        console.warn("[Legacy CRM Lead Email] Auto-draft token refresh failed; continuing with current token", tokenError);
    }

    const instruction = "This lead was imported automatically from a legacy CRM lead notification email. Draft a proactive first outreach message that introduces the agent, acknowledges the enquiry, references any property/goal context from the notes if present, and asks the best next-step qualifying questions. Do not mention automation.";

    try {
        const draftResult = await generateDraft({
            conversationId: args.ghlConversationId,
            contactId: args.contactId,
            locationId: args.location.id,
            accessToken: draftLocation?.ghlAccessToken || '',
            businessName: draftLocation?.name || undefined,
            instruction,
        } as any);

        const draftText = String(draftResult?.draft || "").trim();
        if (!draftText || /^error:/i.test(draftText)) {
            return {
                attempted: true,
                status: "failed",
                error: draftText || "Auto-draft returned empty content",
            };
        }

        return {
            attempted: true,
            status: "generated",
            draftPreview: draftText.slice(0, 220),
        };
    } catch (error: any) {
        return {
            attempted: true,
            status: "failed",
            error: error?.message || "Auto-draft generation failed",
        };
    }
}

export async function processLegacyCrmLeadEmailForLocation(args: {
    locationId: string;
    messageId: string;
    force?: boolean;
    runAutoDraftFromSettings?: boolean;
    triggerSource?: string;
}) {
    const force = !!args.force;

    if (!args.locationId || !args.messageId || args.messageId.trim().length < 3) {
        return { success: false, error: "locationId and messageId are required" };
    }

    const location = await db.location.findUnique({
        where: { id: args.locationId },
        select: {
            id: true,
            name: true,
            evolutionInstanceId: true,
            ghlAccessToken: true,
            ghlRefreshToken: true,
            ghlExpiresAt: true,
            legacyCrmLeadEmailEnabled: true,
            legacyCrmLeadEmailSenders: true,
            legacyCrmLeadEmailSenderDomains: true,
            legacyCrmLeadEmailSubjectPatterns: true,
            legacyCrmLeadEmailAutoDraftFirstContact: true,
        } as any
    });

    if (!location) {
        return { success: false, error: "Location not found" };
    }
    const locationId = String((location as any).id);

    const message = await db.message.findFirst({
        where: {
            OR: [
                { id: args.messageId.trim() },
                { emailMessageId: args.messageId.trim() },
            ],
            conversation: { is: { locationId } },
        },
        select: {
            id: true,
            conversationId: true,
            type: true,
            subject: true,
            body: true,
            emailFrom: true,
            emailTo: true,
            emailMessageId: true,
            createdAt: true,
            source: true,
            conversation: {
                select: {
                    id: true,
                    locationId: true,
                }
            }
        }
    });

    if (!message) {
        return { success: false, error: "Email message not found in this location" };
    }

    if (!String(message.type || "").toUpperCase().includes("EMAIL")) {
        return { success: false, error: "Selected message is not an email" };
    }

    const processingStore = (db as any).legacyCrmLeadEmailProcessing;
    if (!processingStore?.findUnique) {
        return {
            success: false,
            error: "Legacy CRM lead email processing model is unavailable. Run Prisma migration + generate first."
        };
    }

    const existingProcessing = await processingStore.findUnique({
        where: { messageId: message.id }
    });

    if (existingProcessing?.status === "processing" && !force) {
        return {
            success: true,
            skipped: true,
            inProgress: true,
            processing: existingProcessing
        };
    }

    if (existingProcessing?.status === "processed" && !force) {
        return {
            success: true,
            skipped: true,
            alreadyProcessed: true,
            processing: existingProcessing
        };
    }

    const parsed = parseLegacyCrmLeadNotificationEmail({
        subject: message.subject,
        emailFrom: message.emailFrom,
        body: message.body,
        configuredSenders: (location as any)?.legacyCrmLeadEmailSenders || [],
        configuredDomains: (location as any)?.legacyCrmLeadEmailSenderDomains || [],
        configuredSubjectPatterns: (location as any)?.legacyCrmLeadEmailSubjectPatterns || [],
    });

    const processingSeed = {
        locationId,
        senderEmail: parsed.senderEmail,
        subject: parsed.subject,
        classification: parsed.classification || null,
        legacyLeadUrl: parsed.leadUrl,
        legacyLeadId: parsed.leadId,
        extracted: {
            senderMatchMode: parsed.senderMatchMode,
            configuredDetectionEnabled: (location as any)?.legacyCrmLeadEmailEnabled ?? false,
            matched: parsed.matched,
            reason: parsed.reason || null,
            fields: parsed.fields,
            triggerSource: args.triggerSource || null,
            emailSource: message.source || null,
        },
        parsedLeadPayload: parsed.parsedLeadData || null,
    };

    await processingStore.upsert({
        where: { messageId: message.id },
        create: {
            messageId: message.id,
            status: "processing",
            attempts: 1,
            ...processingSeed,
            error: null,
        },
        update: {
            status: "processing",
            attempts: { increment: 1 },
            error: null,
            ...processingSeed,
        }
    });

    if (!parsed.matched || !parsed.parsedLeadData) {
        const ignored = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "ignored",
                processedAt: new Date(),
                error: parsed.reason || null,
            }
        });

        return {
            success: true,
            skipped: true,
            reason: parsed.reason || "Not a recognized legacy CRM lead notification email",
            processing: ignored,
            parsed,
        };
    }

    try {
        const importResult = await createParsedLead(
            parsed.parsedLeadData,
            parsed.bodyText,
            undefined,
            { locationOverride: { ...(location as any), id: locationId }, skipAuthUserLookup: true }
        );

        if (!importResult?.success) {
            const failed = await processingStore.update({
                where: { messageId: message.id },
                data: {
                    status: "failed",
                    error: importResult?.error || "createParsedLead failed",
                }
            });
            return {
                success: false,
                error: importResult?.error || "Failed to import lead from email",
                processing: failed,
                parsed,
            };
        }

        const contactId = (importResult as any).contactId || null;
        const internalConversationId = (importResult as any).internalConversationId || null;
        const ghlConversationId = (importResult as any).conversationId || null;

        const contactPatch: any = {};
        if (parsed.fields.goal) contactPatch.leadGoal = parsed.fields.goal;
        if (parsed.fields.source) contactPatch.leadSource = parsed.fields.source;
        if (parsed.fields.nextAction) contactPatch.leadNextAction = parsed.fields.nextAction;
        const followUpDate = parseLegacyCrmFollowUpDate(parsed.fields.followUp);
        if (followUpDate) contactPatch.leadFollowUpDate = followUpDate;

        if (contactId && Object.keys(contactPatch).length > 0) {
            await db.contact.update({
                where: { id: contactId },
                data: contactPatch
            });
        }

        let autoDraftResult: any = null;
        if (args.runAutoDraftFromSettings && (location as any)?.legacyCrmLeadEmailAutoDraftFirstContact) {
            autoDraftResult = await maybeGenerateLegacyCrmAutoFirstContactDraft({
                location,
                contactId,
                internalConversationId,
                ghlConversationId,
                force,
            });
        }

        const processed = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "processed",
                error: null,
                processedAt: new Date(),
                processedContactId: contactId,
                processedConversationId: internalConversationId || ghlConversationId || null,
                processResult: {
                    force,
                    triggerSource: args.triggerSource || null,
                    importResult,
                    contactPatch,
                    autoDraft: autoDraftResult,
                }
            }
        });

        return {
            success: true,
            parsed,
            importResult,
            autoDraft: autoDraftResult,
            processing: processed,
        };
    } catch (error: any) {
        const failed = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "failed",
                error: error?.message || "Unexpected processing error",
            }
        });

        return {
            success: false,
            error: error?.message || "Unexpected processing error",
            processing: failed,
            parsed,
        };
    }
}

export async function processLegacyCrmLeadEmailAction(
    messageId: string,
    options?: { force?: boolean }
) {
    const location = await getAuthenticatedLocation();
    return processLegacyCrmLeadEmailForLocation({
        locationId: location.id,
        messageId,
        force: !!options?.force,
        runAutoDraftFromSettings: true,
        triggerSource: "manual_action",
    });
}
