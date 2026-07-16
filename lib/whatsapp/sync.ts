import db from "@/lib/db";
import { generateSmartReplies } from "@/lib/ai/smart-replies";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { detectAndHandleWhatsAppCallConsent } from "@/lib/whatsapp/calling";
import {
    isHighConfidenceResolvedPhone,
    normalizeDigits,
    normalizeLidJid,
    normalizeLidRaw,
} from "@/lib/whatsapp/identity";
import { extractGroupParticipantIdentity } from "@/lib/whatsapp/group-participants";
import { computeWhatsAppCustomerServiceExpiresAt } from "@/lib/whatsapp/customer-window";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/whatsapp/client";
import { WHATSAPP_WEB_BRIDGE_PROVIDER } from "@/lib/whatsapp/web-bridge";
import { upsertWebBridgeIdentityMap } from "@/lib/whatsapp/web-bridge-identity";
import { getWebBridgeDuplicateBodyReconciliation } from "@/lib/whatsapp/web-bridge-message-reconciliation";
import { queueRequirementProposalForNewActivity } from "@/lib/ai/requirements-intelligence/service";
import { markScheduledMessagesReviewRecommended } from "@/lib/conversations/scheduled-messages";
import { findContactsByPhoneDigitsWithFallback, phoneDigitsLikelyMatch } from "@/lib/contacts/phone-lookup";
import { isGhlIntegrationEnabled } from "@/lib/ghl/integration-gate";
export { mapWhatsAppDeliveryStatus, processStatusUpdate } from "@/lib/whatsapp/status-updates";

const LID_RETRY_INTERVAL_MS = Number(process.env.WHATSAPP_LID_RETRY_INTERVAL_MS || 30000);
const LID_RETRY_MAX_ATTEMPTS = Number(process.env.WHATSAPP_LID_MAX_ATTEMPTS || 240);
const OUTBOUND_WEB_BRIDGE_RECENT_RECONCILE_WINDOW_MS = 5 * 60 * 1000;
const OUTBOUND_WEB_BRIDGE_MANUAL_RETRY_WINDOW_MS = 30 * 60 * 1000;
const OUTBOUND_WEB_BRIDGE_AMBIGUITY_GAP_MS = 5000;

function getMessageSyncProvider(source: NormalizedMessage["source"]) {
    if (source === "whatsapp_native") return WHATSAPP_CLOUD_PROVIDER;
    if (source === "whatsapp_twilio") return "twilio";
    if (source === "whatsapp_web_bridge") return WHATSAPP_WEB_BRIDGE_PROVIDER;
    return "whatsapp_retired";
}

export function shouldRejectWebBridgeResolvedPhoneAsOwnPhone(args: {
    source: NormalizedMessage["source"];
    direction?: NormalizedMessage["direction"];
    resolvedPhone?: string | null;
    ownPhone?: string | null;
    locationPhone?: string | null;
}) {
    if (args.source !== "whatsapp_web_bridge" || args.direction !== "outbound") return false;
    const resolvedDigits = normalizeDigits(args.resolvedPhone);
    if (!resolvedDigits) return false;
    return [args.ownPhone, args.locationPhone].some((value) => {
        const ownDigits = normalizeDigits(value);
        return !!ownDigits && ownDigits === resolvedDigits;
    });
}

export function shouldRejectWebBridgeOutboundLidForOwnContact(args: {
    source: NormalizedMessage["source"];
    direction?: NormalizedMessage["direction"];
    isGroup?: boolean;
    messageLid?: string | null;
    contactPhone?: string | null;
    ownPhone?: string | null;
}) {
    if (args.source !== "whatsapp_web_bridge" || args.direction !== "outbound" || args.isGroup) return false;
    if (!normalizeLidJid(args.messageLid)) return false;
    const contactDigits = normalizeDigits(args.contactPhone);
    const ownDigits = normalizeDigits(args.ownPhone);
    return !!contactDigits && !!ownDigits && contactDigits === ownDigits;
}

type WhatsAppLidContactCandidate = {
    id: string;
    contactType?: string | null;
    phone?: string | null;
};

type WhatsAppIdentityNamedContact = WhatsAppLidContactCandidate & {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    lid?: string | null;
};

function normalizeNameToken(value: unknown) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9]+/i)
        .find((token) => token.length >= 2 && !["lead", "sale", "rent", "rental", "owner", "agent", "whatsapp", "contact", "user"].includes(token))
        || "";
}

function getWebBridgeIdentityName(identity: any) {
    return String(
        identity?.displayName
        || identity?.verifiedName
        || identity?.rawContactIdentity?.displayName
        || identity?.rawContactIdentity?.verifiedName
        || identity?.rawContactIdentity?.name
        || identity?.rawContactIdentity?.pushname
        || identity?.name
        || identity?.pushname
        || ""
    ).trim();
}

export function normalizeOutboundWebBridgeRetryBodyForMatch(value: unknown) {
    return String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function getOutboundWebBridgeOutboxStatusPriority(status: unknown) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "delivery_unconfirmed") return 0;
    if (normalized === "dispatch_accepted") return 1;
    if (normalized === "processing") return 2;
    if (normalized === "failed") return 3;
    if (normalized === "pending") return 4;
    return 5;
}

function getOutboundWebBridgeManualRetryMatch(candidate: any, args: {
    timestamp: Date;
    body?: string | null;
}) {
    const diffMs = Math.abs(new Date(candidate?.createdAt).getTime() - args.timestamp.getTime());
    const webhookBody = normalizeOutboundWebBridgeRetryBodyForMatch(args.body);
    const candidateBody = normalizeOutboundWebBridgeRetryBodyForMatch(candidate?.body);
    const bodyMatches = !!webhookBody && !!candidateBody && webhookBody === candidateBody;
    const recentTimestampMatch = Number.isFinite(diffMs) && diffMs <= OUTBOUND_WEB_BRIDGE_RECENT_RECONCILE_WINDOW_MS;
    const manualRetryBodyMatch = bodyMatches && Number.isFinite(diffMs) && diffMs <= OUTBOUND_WEB_BRIDGE_MANUAL_RETRY_WINDOW_MS;
    const outboxStatusPriority = getOutboundWebBridgeOutboxStatusPriority(candidate?.outboundWhatsAppOutbox?.status);

    return {
        diffMs,
        bodyMatches,
        outboxStatusPriority,
        matches: recentTimestampMatch || manualRetryBodyMatch,
    };
}

function hasStableWebBridgeContactIdentityMatch(identity: any, contact: WhatsAppIdentityNamedContact) {
    const contactLid = normalizeLidJid(contact.lid);
    const identityLid = normalizeLidJid(
        identity?.lid
        || identity?.lidJid
        || identity?.rawContactIdentity?.lidJid
    );
    if (!contactLid || !identityLid || contactLid !== identityLid) return false;

    const contactPhone = normalizeDigits(contact.phone);
    const identityPhone = normalizeDigits(
        identity?.phone
        || identity?.phoneJid
        || identity?.rawContactIdentity?.phone
        || identity?.rawContactIdentity?.phoneJid
    );
    if (!isHighConfidenceResolvedPhone(contactPhone) || !isHighConfidenceResolvedPhone(identityPhone)) return false;

    return phoneDigitsLikelyMatch(identityPhone, contactPhone);
}

function isEstablishedNamedContact(contact: WhatsAppIdentityNamedContact) {
    const name = String(contact.name || "").trim();
    if (!name) return false;
    if (/^(whatsapp contact|whatsapp user|group member)\b/i.test(name)) return false;
    return Boolean(contact.email || contact.firstName || contact.lastName || contact.contactType !== "Lead");
}

export function hasWebBridgeIdentityNameConflict(args: {
    source: NormalizedMessage["source"];
    isGroup?: boolean;
    identity?: any;
    contact?: WhatsAppIdentityNamedContact | null;
}) {
    if (args.source !== "whatsapp_web_bridge" || args.isGroup || !args.contact) return false;
    if (!isEstablishedNamedContact(args.contact)) return false;
    if (hasStableWebBridgeContactIdentityMatch(args.identity, args.contact)) return false;

    const identityToken = normalizeNameToken(getWebBridgeIdentityName(args.identity));
    const contactToken = normalizeNameToken(args.contact.firstName || args.contact.name);
    return Boolean(identityToken && contactToken && identityToken !== contactToken);
}

function isRefGroupMemberContact(candidate: WhatsAppLidContactCandidate) {
    return candidate.contactType === "Ref-GroupMember";
}

function hasHighConfidenceContactPhone(candidate: WhatsAppLidContactCandidate) {
    return isHighConfidenceResolvedPhone(normalizeDigits(candidate.phone));
}

export function selectPreferredWhatsAppLidContact<T extends WhatsAppLidContactCandidate>(
    matches: T[],
    options: { mappedContactId?: string | null } = {}
): T | undefined {
    if (matches.length === 0) return undefined;

    const mapped = options.mappedContactId
        ? matches.filter((candidate) => candidate.id === options.mappedContactId)
        : [];

    return mapped.find((candidate) => !isRefGroupMemberContact(candidate) && hasHighConfidenceContactPhone(candidate))
        || mapped.find((candidate) => !isRefGroupMemberContact(candidate))
        || mapped.find(hasHighConfidenceContactPhone)
        || mapped[0]
        || matches.find((candidate) => !isRefGroupMemberContact(candidate) && hasHighConfidenceContactPhone(candidate))
        || matches.find(hasHighConfidenceContactPhone)
        || matches.find((candidate) => !isRefGroupMemberContact(candidate))
        || matches[0];
}

export interface NormalizedMessage {
    locationId: string;
    from: string; // E.164 phone number (Sender)
    to: string;   // E.164 phone number (Recipient)
    type: "text" | "image" | "document" | "audio" | "video" | "sticker" | "reaction" | "contact" | "other";
    body: string;
    wamId: string; // Unique Message ID
    timestamp: Date;
    mediaUrl?: string; // For improved media handling
    contactName?: string;
    source: "whatsapp_native" | "whatsapp_twilio" | "whatsapp_evolution" | "whatsapp_web_bridge";
    direction?: "inbound" | "outbound";
    isGroup?: boolean;
    participant?: string;
    participantJid?: string;
    participantPhoneJid?: string;
    participantLidJid?: string;
    participantDisplayName?: string;
    lid?: string; // WhatsApp Lightweight ID
    resolvedPhone?: string; // Explicitly passed resolved phone from webhook
    remoteJid?: string;
    chatId?: string;
    webBridgeIdentity?: any;
    __skipUnresolvedLidDeferral?: boolean; // Internal: avoid enqueue loop during retry
    __deferredAttempt?: number; // Internal: deferred retry count for logging/limits
}

// ... handleWhatsAppMessage ...

async function reconcileExistingWebBridgeMessageBody(args: {
    message: any;
    incomingBody: string;
    source: NormalizedMessage["source"];
    wamId: string;
}) {
    const reconciliation = getWebBridgeDuplicateBodyReconciliation({
        source: args.source,
        existingBody: args.message?.body,
        incomingBody: args.incomingBody,
    });
    if (!reconciliation.shouldUpdate || reconciliation.body === null) return false;

    await db.message.update({
        where: { id: args.message.id },
        data: {
            body: reconciliation.body,
            updatedAt: new Date(),
        },
    });

    const conversation = args.message?.conversation;
    if (conversation?.id) {
        const existingCreatedAt = args.message?.createdAt instanceof Date
            ? args.message.createdAt
            : null;
        const shouldPatchConversationSummary = (
            String(conversation.lastMessageBody || "") === String(args.message?.body || "")
            || (existingCreatedAt && conversation.lastMessageAt instanceof Date && conversation.lastMessageAt.getTime() === existingCreatedAt.getTime())
        );

        if (shouldPatchConversationSummary) {
            await db.conversation.update({
                where: { id: conversation.id },
                data: {
                    lastMessageBody: reconciliation.body,
                    updatedAt: new Date(),
                },
            }).catch((error) => {
                console.warn(`[WhatsApp Sync] Failed to reconcile conversation summary for ${args.wamId}:`, error);
            });
        }
    }

    console.log(`[WhatsApp Sync] Reconciled Web Bridge duplicate body for ${args.wamId}`);
    return true;
}

async function reconcileExistingWebBridgeMessageBodySafely(args: {
    message: any;
    incomingBody: string;
    source: NormalizedMessage["source"];
    wamId: string;
}) {
    try {
        return await reconcileExistingWebBridgeMessageBody(args);
    } catch (err) {
        console.error(`[WhatsApp Sync] Failed to reconcile duplicate Web Bridge body for ${args.wamId}:`, err);
        return false;
    }
}

type DeferredLidMessage = {
    msg: NormalizedMessage;
    lidJid: string;
    attempts: number;
    createdAt: Date;
    timer?: NodeJS.Timeout;
};

const deferredLidMessages = new Map<string, DeferredLidMessage>();

function isRefGroupMemberPlaceholder(contact: {
    contactType?: string | null;
    name?: string | null;
}) {
    return contact.contactType === "Ref-GroupMember"
        || (contact.name || "").startsWith("Group Member ");
}

function isWebBridgeLidPlaceholderContact(contact: {
    phone?: string | null;
    name?: string | null;
}) {
    const name = String(contact.name || "");
    return !contact.phone && (
        name === "WhatsApp Contact"
        || name.startsWith("WhatsApp User")
    );
}

function buildContactLidLookup(locationId: string, lidValue: string | null | undefined) {
    const normalizedLid = normalizeLidJid(lidValue);
    const lidRaw = normalizeLidRaw(lidValue);
    if (!normalizedLid || !lidRaw) return null;

    return {
        locationId,
        OR: [
            { lid: normalizedLid },
            { lid: lidRaw },
            { lid: { contains: lidRaw } },
        ],
    } as any;
}

async function tryResolveLidToPhone(locationId: string, lidJid: string): Promise<string | null> {
    const lidRaw = String(lidJid || '').replace('@lid', '');
    if (!lidRaw) return null;

    const existing = await db.contact.findFirst({
        where: {
            locationId,
            lid: { contains: lidRaw },
            phone: { not: null }
        },
        select: { phone: true }
    });

    const dbPhone = normalizeDigits(existing?.phone);
    if (isHighConfidenceResolvedPhone(dbPhone)) return dbPhone;
    if (dbPhone) {
        console.warn(`[LID Resolve] Ignoring low-confidence DB phone mapping for ${lidJid}: +${dbPhone}`);
    }
    return null;
}

function deferredLidKey(msg: NormalizedMessage) {
    return `${msg.locationId}:${msg.wamId}`;
}

function clearDeferredLidEntry(key: string) {
    const existing = deferredLidMessages.get(key);
    if (existing?.timer) clearTimeout(existing.timer);
    deferredLidMessages.delete(key);
}


function scheduleDeferredLidRetry(key: string) {
    const entry = deferredLidMessages.get(key);
    if (!entry) return;

    if (entry.attempts >= LID_RETRY_MAX_ATTEMPTS) {
        console.warn(`[WhatsApp Sync] Dropping unresolved LID message after ${entry.attempts} attempts (${entry.lidJid}, wamId: ${entry.msg.wamId})`);
        clearDeferredLidEntry(key);
        return;
    }

    entry.timer = setTimeout(async () => {
        const current = deferredLidMessages.get(key);
        if (!current) return;

        current.attempts += 1;
        const attempt = current.attempts;
        console.log(`[WhatsApp Sync] Retrying deferred LID message ${current.msg.wamId} (attempt ${attempt}/${LID_RETRY_MAX_ATTEMPTS})`);

        try {
            const result = await processNormalizedMessage({
                ...current.msg,
                __skipUnresolvedLidDeferral: true,
                __deferredAttempt: attempt
            });

            if (result?.status === 'deferred_unresolved_lid') {
                scheduleDeferredLidRetry(key);
                return;
            }

            clearDeferredLidEntry(key);
            console.log(`[WhatsApp Sync] Deferred LID message resolved/processed: ${current.msg.wamId}`);
        } catch (err) {
            console.error(`[WhatsApp Sync] Deferred LID retry failed for ${current.msg.wamId}:`, err);
            scheduleDeferredLidRetry(key);
        }
    }, LID_RETRY_INTERVAL_MS);
}

function enqueueInMemoryDeferredLidMessage(msg: NormalizedMessage, lidJid: string) {
    const key = deferredLidKey(msg);
    if (deferredLidMessages.has(key)) {
        return;
    }

    deferredLidMessages.set(key, {
        msg: { ...msg },
        lidJid,
        attempts: 0,
        createdAt: new Date()
    });

    console.warn(`[WhatsApp Sync] Deferred unresolved inbound LID message in-memory (fallback) ${msg.wamId} (${lidJid}).`);
    scheduleDeferredLidRetry(key);
}

async function tryReconcileOutboundWebhookToPendingMessage(args: {
    locationId: string;
    conversationId: string;
    conversationGhlId: string;
    wamId: string;
    body?: string | null;
    timestamp: Date;
    source: NormalizedMessage["source"];
}) {
    if (args.source !== "whatsapp_web_bridge") {
        return null;
    }
    const webhookBody = normalizeOutboundWebBridgeRetryBodyForMatch(args.body);
    const candidateWindowStart = new Date(args.timestamp.getTime() - (
        webhookBody ? OUTBOUND_WEB_BRIDGE_MANUAL_RETRY_WINDOW_MS : OUTBOUND_WEB_BRIDGE_RECENT_RECONCILE_WINDOW_MS
    ));
    const candidates = await (db as any).message.findMany({
        where: {
            conversationId: args.conversationId,
            direction: "outbound",
            source: { in: ["app_user", "scheduled_message"] },
            OR: [
                { wamId: null },
                { status: { in: ["dispatch_accepted", "delivery_unconfirmed"] } },
            ],
            clientMessageId: { not: null },
            createdAt: { gte: candidateWindowStart },
            outboundWhatsAppOutbox: {
                is: {
                    transport: "web_bridge",
                    status: { in: ["pending", "processing", "failed", "completed", "dispatch_accepted", "delivery_unconfirmed"] },
                },
            },
        },
        select: {
            id: true,
            clientMessageId: true,
            body: true,
            createdAt: true,
            outboundWhatsAppOutbox: {
                select: {
                    id: true,
                    transport: true,
                    status: true,
                },
            },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 12,
    });

    if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }

    const ranked = candidates
        .map((row: any) => ({
            ...row,
            ...getOutboundWebBridgeManualRetryMatch(row, { timestamp: args.timestamp, body: args.body }),
        }))
        .filter((row: any) => row.matches)
        .sort((left: any, right: any) => {
            if (Number(left.bodyMatches) !== Number(right.bodyMatches)) return Number(right.bodyMatches) - Number(left.bodyMatches);
            if (left.outboxStatusPriority !== right.outboxStatusPriority) return left.outboxStatusPriority - right.outboxStatusPriority;
            return left.diffMs - right.diffMs;
        });

    const best = ranked[0];
    if (!best || !Number.isFinite(best.diffMs)) {
        return null;
    }

    const second = ranked[1];
    const ambiguous = !!second
        && Boolean(second.bodyMatches) === Boolean(best.bodyMatches)
        && Number(second.outboxStatusPriority) === Number(best.outboxStatusPriority)
        && Math.abs(Number(second.diffMs) - Number(best.diffMs)) < OUTBOUND_WEB_BRIDGE_AMBIGUITY_GAP_MS;
    if (ambiguous) {
        console.warn(`[WhatsApp Sync] Outbound webhook reconcile ambiguous for wamId=${args.wamId}; skipping heuristic adopt.`);
        return null;
    }

    try {
        await (db as any).message.update({
            where: { id: best.id },
            data: {
                wamId: args.wamId,
                ghlMessageId: args.wamId,
                status: "dispatch_accepted",
                updatedAt: new Date(),
            },
        });
    } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        const existing = await db.message.findUnique({
            where: { wamId: args.wamId },
            select: { id: true },
        });
        if (!existing?.id) throw error;
    }

    await (db as any).whatsAppOutboundOutbox.updateMany({
        where: {
            messageId: best.id,
            status: { in: ["pending", "processing", "failed", "delivery_unconfirmed"] },
        },
        data: {
            status: "dispatch_accepted",
            processedAt: null,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
        },
    }).catch(() => undefined);

    void publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: args.conversationGhlId,
        type: "message.outbound",
        payload: {
            channel: "whatsapp",
            mode: "text",
            messageId: best.id,
            clientMessageId: best.clientMessageId || null,
            wamId: args.wamId,
            status: "dispatch_accepted",
        },
    });
    void publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: args.conversationGhlId,
        type: "message.status",
        payload: {
            messageId: best.id,
            clientMessageId: best.clientMessageId || null,
            wamId: args.wamId,
            status: "dispatch_accepted",
            rawStatus: "MESSAGE_CREATE",
        },
    });

    console.log(`[WhatsApp Sync] Reconciled outbound webhook to pending app message ${best.id} for wamId=${args.wamId}`);
    return {
        id: String(best.id),
        clientMessageId: best.clientMessageId ? String(best.clientMessageId) : null,
    };
}

async function persistWebBridgeConversationSync(args: {
    locationId: string;
    conversationId: string;
    providerAccountId: string;
    providerThreadId: string;
    source: NormalizedMessage["source"];
}) {
    const providerThreadId = String(args.providerThreadId || "").trim();
    if (!providerThreadId) return;

    await (db as any).conversationSync.upsert({
        where: {
            conversationId_provider_providerAccountId: {
                conversationId: args.conversationId,
                provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
                providerAccountId: args.providerAccountId,
            },
        },
        create: {
            conversationId: args.conversationId,
            locationId: args.locationId,
            provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
            providerAccountId: args.providerAccountId,
            providerConversationId: providerThreadId,
            status: "synced",
            lastSyncedAt: new Date(),
            metadata: { source: args.source },
        },
        update: {
            providerConversationId: providerThreadId,
            status: "synced",
            lastSyncedAt: new Date(),
            lastError: null,
            metadata: { source: args.source },
        },
    }).catch(async (error: any) => {
        if (error?.code === "P2002") {
            const reused = await (db as any).conversationSync.updateMany({
                where: {
                    provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
                    providerAccountId: args.providerAccountId,
                    providerConversationId: providerThreadId,
                },
                data: {
                    conversationId: args.conversationId,
                    locationId: args.locationId,
                    status: "synced",
                    lastSyncedAt: new Date(),
                    lastError: null,
                    metadata: { source: args.source, reusedAfterUniqueConflict: true },
                },
            }).catch(() => null);
            if (reused?.count) {
                console.warn(`[WhatsApp Sync] Reused ${WHATSAPP_WEB_BRIDGE_PROVIDER} conversation sync after providerConversationId conflict: ${providerThreadId}`);
                return;
            }
        }
        console.warn(`[WhatsApp Sync] Failed to persist ${WHATSAPP_WEB_BRIDGE_PROVIDER} conversation sync:`, error?.message || error);
    });
}

async function attachWebBridgeLidToExistingOutboundMessage(args: {
    locationId: string;
    message: any;
    lid?: string | null;
    timestamp: Date;
    source: NormalizedMessage["source"];
    webBridgeIdentity?: any;
    providerThreadId?: string | null;
    providerAccountId?: string | null;
    ownPhone?: string | null;
}) {
    const normalizedLid = normalizeLidJid(args.lid);
    if (!normalizedLid || !args.message?.conversation?.contact?.id) return;

    const realContact = args.message.conversation.contact;
    if (shouldRejectWebBridgeOutboundLidForOwnContact({
        source: args.source,
        direction: "outbound",
        isGroup: false,
        messageLid: normalizedLid,
        contactPhone: realContact.phone,
        ownPhone: args.ownPhone,
    })) {
        console.warn(`[LID Capture] Refusing to attach outbound Web Bridge LID ${normalizedLid} to connected account contact ${realContact.id}`);
        return;
    }

    const currentLid = normalizeLidJid(realContact.lid);
    if (!currentLid || currentLid === normalizedLid) {
        if (currentLid !== normalizedLid) {
            await db.contact.update({
                where: { id: realContact.id },
                data: { lid: normalizedLid },
            }).catch((error) => console.error("Failed to save LID:", error));
            console.log(`[LID Capture] Saved outbound LID mapping: ${normalizedLid} -> ${realContact.phone}`);
        }

        await upsertWebBridgeIdentityMap({
            locationId: args.locationId,
            contactId: realContact.id,
            identityType: "lid",
            identityValue: normalizedLid,
            lid: normalizedLid,
            phone: realContact.phone || null,
            displayName: realContact.name || null,
            confidence: realContact.phone ? "high" : "unresolved",
            source: "outbound_message_lid_capture",
            lastSeenAt: args.timestamp,
            metadata: args.webBridgeIdentity || undefined,
        });
        if (args.providerThreadId) {
            await upsertWebBridgeIdentityMap({
                locationId: args.locationId,
                contactId: realContact.id,
                identityType: "chat",
                identityValue: String(args.providerThreadId),
                lid: normalizedLid,
                phone: realContact.phone || null,
                displayName: realContact.name || null,
                confidence: realContact.phone ? "high" : "unresolved",
                source: "outbound_message_lid_capture",
                lastSeenAt: args.timestamp,
                metadata: args.webBridgeIdentity || undefined,
            });
        }
    } else {
        console.warn(`[LID Capture] Refusing to overwrite existing LID ${realContact.lid} on contact ${realContact.id} with outbound LID ${normalizedLid}`);
    }

    const placeholderWhere = buildContactLidLookup(args.locationId, normalizedLid);
    const placeholder = placeholderWhere
        ? await db.contact.findFirst({
            where: {
                AND: [
                    placeholderWhere,
                    { id: { not: realContact.id } },
                ],
            } as any,
        })
        : null;

    if (placeholder && isWebBridgeLidPlaceholderContact(placeholder)) {
        const placeholderConvos = await db.conversation.findMany({ where: { contactId: placeholder.id } });
        let totalPlaceholderMessages = 0;
        for (const convo of placeholderConvos) {
            totalPlaceholderMessages += await db.message.count({ where: { conversationId: convo.id } });
        }

        if (totalPlaceholderMessages > 50) {
            console.warn(`[LID Merge Guard] Blocking outbound LID placeholder merge: placeholder ${placeholder.id} has ${totalPlaceholderMessages} messages. LID=${normalizedLid}, realContact=${realContact.id}`);
        } else {
            for (const convo of placeholderConvos) {
                const targetConvo = await db.conversation.findUnique({
                    where: { locationId_contactId: { locationId: args.locationId, contactId: realContact.id } },
                });

                if (targetConvo) {
                    await db.message.updateMany({
                        where: { conversationId: convo.id },
                        data: { conversationId: targetConvo.id },
                    });
                    await db.conversation.delete({ where: { id: convo.id } });
                    console.log(`[LID Capture] Merged placeholder conversation ${convo.id} -> ${targetConvo.id}`);
                } else {
                    await db.conversation.update({
                        where: { id: convo.id },
                        data: { contactId: realContact.id },
                    });
                    console.log(`[LID Capture] Reassigned placeholder conversation ${convo.id} to ${realContact.id}`);
                }
            }
            await db.contact.delete({ where: { id: placeholder.id } });
            console.log(`[LID Capture] Deleted outbound LID placeholder contact ${placeholder.id}`);
        }
    } else if (placeholder) {
        console.warn(`[LID Merge Guard] Skipping outbound LID placeholder merge: contact ${placeholder.id} ("${placeholder.name}", phone=${placeholder.phone}) is not a placeholder. LID=${normalizedLid}`);
    }

    if (args.providerThreadId && args.providerAccountId && args.message.conversation?.id) {
        await persistWebBridgeConversationSync({
            locationId: args.locationId,
            conversationId: args.message.conversation.id,
            providerAccountId: args.providerAccountId,
            providerThreadId: args.providerThreadId,
            source: args.source,
        });
    }
}

async function tryAdoptOutboundWebBridgeLidWebhookToAppMessage(args: {
    locationId: string;
    wamId: string;
    body: string;
    timestamp: Date;
    lid?: string | null;
    providerThreadId?: string | null;
    webBridgeIdentity?: any;
    ownPhone?: string | null;
}) {
    const normalizedLid = normalizeLidJid(args.lid);
    if (!normalizedLid || !args.wamId) return null;

    const providerAccountId = args.locationId;
    const existingByWam = await db.message.findUnique({
        where: { wamId: args.wamId },
        include: { conversation: { include: { contact: true } } },
    }).catch(() => null);
    if (existingByWam?.id) {
        await attachWebBridgeLidToExistingOutboundMessage({
            locationId: args.locationId,
            message: existingByWam,
            lid: normalizedLid,
            timestamp: args.timestamp,
            source: "whatsapp_web_bridge",
            webBridgeIdentity: args.webBridgeIdentity,
            providerThreadId: args.providerThreadId,
            providerAccountId,
            ownPhone: args.ownPhone,
        });
        return { id: String(existingByWam.id), clientMessageId: existingByWam.clientMessageId ? String(existingByWam.clientMessageId) : null };
    }

    const webhookBody = normalizeOutboundWebBridgeRetryBodyForMatch(args.body);
    const windowStart = new Date(args.timestamp.getTime() - (
        webhookBody ? OUTBOUND_WEB_BRIDGE_MANUAL_RETRY_WINDOW_MS : OUTBOUND_WEB_BRIDGE_RECENT_RECONCILE_WINDOW_MS
    ));
    const windowEnd = new Date(args.timestamp.getTime() + 60 * 1000);
    const candidates = await (db as any).message.findMany({
        where: {
            direction: "outbound",
            source: { in: ["app_user", "scheduled_message"] },
            OR: [
                { wamId: null },
                { status: { in: ["dispatch_accepted", "delivery_unconfirmed"] } },
            ],
            createdAt: { gte: windowStart, lte: windowEnd },
            conversation: { locationId: args.locationId },
            outboundWhatsAppOutbox: {
                is: {
                    transport: "web_bridge",
                    status: { in: ["pending", "processing", "completed", "failed", "dispatch_accepted", "delivery_unconfirmed"] },
                },
            },
        },
        include: {
            conversation: { include: { contact: true } },
            outboundWhatsAppOutbox: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 12,
    });

    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const ranked = candidates
        .map((row: any) => ({
            ...row,
            ...getOutboundWebBridgeManualRetryMatch(row, { timestamp: args.timestamp, body: args.body }),
        }))
        .filter((row: any) => row.matches)
        .sort((left: any, right: any) => {
            if (Number(left.bodyMatches) !== Number(right.bodyMatches)) return Number(right.bodyMatches) - Number(left.bodyMatches);
            if (left.outboxStatusPriority !== right.outboxStatusPriority) return left.outboxStatusPriority - right.outboxStatusPriority;
            return left.diffMs - right.diffMs;
        });

    const best = ranked[0];
    const second = ranked[1];
    if (!best) return null;
    if (second
        && Boolean(second.bodyMatches) === Boolean(best.bodyMatches)
        && Number(second.outboxStatusPriority) === Number(best.outboxStatusPriority)
        && Math.abs(Number(second.diffMs) - Number(best.diffMs)) < 10_000) {
        console.warn(`[WhatsApp Sync] Outbound LID webhook adopt ambiguous for wamId=${args.wamId}; skipping heuristic adopt.`);
        return null;
    }

    try {
        await (db as any).message.update({
            where: { id: best.id },
            data: {
                wamId: args.wamId,
                ghlMessageId: args.wamId,
                status: "dispatch_accepted",
                updatedAt: new Date(),
            },
        });
    } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        const existing = await db.message.findUnique({
            where: { wamId: args.wamId },
            include: { conversation: { include: { contact: true } } },
        });
        if (!existing?.id) throw error;
        await attachWebBridgeLidToExistingOutboundMessage({
            locationId: args.locationId,
            message: existing,
            lid: normalizedLid,
            timestamp: args.timestamp,
            source: "whatsapp_web_bridge",
            webBridgeIdentity: args.webBridgeIdentity,
            providerThreadId: args.providerThreadId,
            providerAccountId,
            ownPhone: args.ownPhone,
        });
        return { id: String(existing.id), clientMessageId: existing.clientMessageId ? String(existing.clientMessageId) : null };
    }

    await (db as any).whatsAppOutboundOutbox.updateMany({
        where: {
            messageId: best.id,
            status: { in: ["pending", "processing", "failed", "delivery_unconfirmed"] },
        },
        data: {
            status: "dispatch_accepted",
            processedAt: null,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
        },
    }).catch(() => undefined);

    await (db as any).messageSync.upsert({
        where: {
            messageId_provider_providerAccountId: {
                messageId: best.id,
                provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
                providerAccountId,
            },
        },
        create: {
            messageId: best.id,
            conversationId: best.conversationId,
            locationId: args.locationId,
            provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
            providerAccountId,
            providerMessageId: args.wamId,
            providerThreadId: args.providerThreadId || normalizedLid,
            status: "synced",
            remoteUpdatedAt: args.timestamp,
            lastSyncedAt: new Date(),
            metadata: { source: "whatsapp_web_bridge", adoptedOutboundLidWebhook: true },
        },
        update: {
            providerMessageId: args.wamId,
            providerThreadId: args.providerThreadId || normalizedLid,
            status: "synced",
            remoteUpdatedAt: args.timestamp,
            lastSyncedAt: new Date(),
            lastError: null,
            metadata: { source: "whatsapp_web_bridge", adoptedOutboundLidWebhook: true },
        },
    }).catch((error: any) => {
        console.warn(`[WhatsApp Sync] Failed to persist adopted Web Bridge outbound message sync:`, error?.message || error);
    });

    await attachWebBridgeLidToExistingOutboundMessage({
        locationId: args.locationId,
        message: best,
        lid: normalizedLid,
        timestamp: args.timestamp,
        source: "whatsapp_web_bridge",
        webBridgeIdentity: args.webBridgeIdentity,
        providerThreadId: args.providerThreadId,
        providerAccountId,
        ownPhone: args.ownPhone,
    });

    void publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: best.conversation?.ghlConversationId || best.conversationId,
        type: "message.outbound",
        payload: {
            channel: "whatsapp",
            mode: "text",
            messageId: best.id,
            clientMessageId: best.clientMessageId || null,
            wamId: args.wamId,
            status: "dispatch_accepted",
            adoptedOutboundLidWebhook: true,
        },
    });

    console.log(`[WhatsApp Sync] Adopted outbound Web Bridge LID webhook ${args.wamId} to app message ${best.id}`);
    return { id: String(best.id), clientMessageId: best.clientMessageId ? String(best.clientMessageId) : null };
}

async function upsertGroupParticipantShadow(params: {
    conversationId: string;
    timestamp: Date;
    role?: string | null;
    participantJid?: string | null;
    participantPhoneJid?: string | null;
    participantLidJid?: string | null;
    participantDisplayName?: string | null;
}) {
    const identity = extractGroupParticipantIdentity({
        participantJid: params.participantJid || params.participantLidJid || params.participantPhoneJid || null,
        senderPhoneJid: params.participantPhoneJid || null,
        pushName: params.participantDisplayName || null,
    });

    if (!identity.identityKey) {
        return null;
    }

    const existing = await db.conversationParticipant.findFirst({
        where: {
            conversationId: params.conversationId,
            OR: [
                { identityKey: identity.identityKey },
                ...(identity.phoneJid ? [{ phoneJid: identity.phoneJid }] : []),
                ...(identity.lidJid ? [{ lidJid: identity.lidJid }] : []),
                ...(identity.participantJid ? [{ participantJid: identity.participantJid }] : []),
            ],
        },
        select: { id: true, contactId: true },
    });

    const data = {
        identityKey: identity.identityKey,
        role: params.role || "member",
        participantJid: identity.participantJid,
        lidJid: identity.lidJid,
        phoneJid: identity.phoneJid,
        phoneDigits: identity.phoneDigits,
        displayName: identity.displayName,
        lastSeenAt: params.timestamp,
        resolutionConfidence: identity.resolutionConfidence,
        source: identity.source,
    };

    if (existing?.id) {
        return db.conversationParticipant.update({
            where: { id: existing.id },
            data,
        });
    }

    return db.conversationParticipant.create({
        data: {
            conversationId: params.conversationId,
            ...data,
        },
    });
}

export async function processNormalizedMessage(msg: NormalizedMessage) {
    if (msg.source === "whatsapp_evolution") {
        console.warn(`[WhatsApp Sync] Ignoring Evolution message ${msg.wamId}; Evolution API is retired.`);
        return { status: "ignored", reason: "evolution_retired" };
    }
    console.log(`[WhatsApp Sync] processNormalizedMessage Called for ${msg.wamId} (${msg.direction})`);
    const { locationId, from, to, body, type, wamId, timestamp, contactName, source, isGroup, participant } = msg;
    const direction = msg.direction || "inbound";

    const existing = await db.message.findUnique({
        where: { wamId },
        include: { conversation: { include: { contact: true } } }
    });
    if (existing) {
        console.log(`[WhatsApp Sync] Skipped existing message: ${wamId}`);
        await reconcileExistingWebBridgeMessageBodySafely({
            message: existing,
            incomingBody: body,
            source,
            wamId,
        });

        // Backfill/heal older generic placeholders when newer parsers can classify the content.
        if ((existing.body || "").trim() === "[Media]" && (body || "").trim() && (body || "").trim() !== "[Media]") {
            await db.message.update({
                where: { id: existing.id },
                data: { body }
            }).catch((err) => {
                console.error(`[WhatsApp Sync] Failed to heal placeholder body for ${wamId}:`, err);
            });
        }

        // --- LAYER 2: Auto-Capture LID from Outbound Webhook ---
        // If this is an outbound message we sent from the App, we already have the real contact.
        // But the webhook provides the LID (msg.lid). We can use this to map LID -> Real Contact.
        if (msg.lid && existing.conversation?.contact) {
            const realContact = existing.conversation.contact;
            const existingOwnPhone = msg.direction === "outbound" ? msg.from : msg.to;

            if (msg.source === "whatsapp_web_bridge" && msg.direction === "outbound") {
                await attachWebBridgeLidToExistingOutboundMessage({
                    locationId,
                    message: existing,
                    lid: msg.lid,
                    timestamp,
                    source: msg.source,
                    webBridgeIdentity: msg.webBridgeIdentity,
                    providerThreadId: msg.remoteJid || msg.chatId || null,
                    providerAccountId: locationId,
                    ownPhone: existingOwnPhone,
                });
                return { status: 'skipped', id: existing.id };
            }

            const lidRaw = msg.lid.replace('@lid', '');
            const currentLidRaw = (realContact.lid || '').replace('@lid', '');

            if (lidRaw !== currentLidRaw) {
                console.log(`[LID Capture] Found new LID ${msg.lid} for contact ${realContact.name} (${realContact.phone})`);

                // 1. Update the Real Contact with the LID
                await db.contact.update({
                    where: { id: realContact.id },
                    data: { lid: msg.lid }
                }).catch(e => console.error("Failed to save LID:", e));
                await upsertWebBridgeIdentityMap({
                    locationId,
                    contactId: realContact.id,
                    identityType: "lid",
                    identityValue: normalizeLidJid(msg.lid) || msg.lid,
                    lid: normalizeLidJid(msg.lid) || msg.lid,
                    phone: realContact.phone || null,
                    displayName: realContact.name || null,
                    confidence: realContact.phone ? "high" : "unresolved",
                    source: "existing_message_lid_capture",
                    lastSeenAt: timestamp,
                    metadata: msg.webBridgeIdentity || undefined,
                });
                console.log(`[LID Capture] Saved LID mapping: ${msg.lid} -> ${realContact.phone}`);

                // 2. Check for Placeholder Contacts to Merge
                // If we previously received messages from this LID, a placeholder "WhatsApp User ...@lid" might exist.
                // We should merge it now.
                const placeholderWhere = buildContactLidLookup(locationId, msg.lid);
                const placeholder = placeholderWhere
                    ? await db.contact.findFirst({
                        where: {
                            AND: [
                                placeholderWhere,
                                { id: { not: realContact.id } },
                            ],
                        } as any,
                    })
                    : null;

                if (placeholder) {
                    // --- SAFETY GUARD: Verify placeholder is truly a placeholder ---
                    const isPlaceholder = isWebBridgeLidPlaceholderContact(placeholder);
                    if (!isPlaceholder) {
                        console.warn(`[LID Merge Guard] Skipping merge: contact ${placeholder.id} ("${placeholder.name}", phone=${placeholder.phone}) is not a placeholder. LID=${lidRaw}`);
                    } else {
                        console.log(`[LID Capture] Found placeholder contact to merge: ${placeholder.name} (${placeholder.id})`);

                        // --- SAFETY GUARD: Message count check ---
                        const placeholderConvos = await db.conversation.findMany({ where: { contactId: placeholder.id } });
                        let totalPlaceholderMessages = 0;
                        for (const convo of placeholderConvos) {
                            const count = await db.message.count({ where: { conversationId: convo.id } });
                            totalPlaceholderMessages += count;
                        }

                        if (totalPlaceholderMessages > 50) {
                            console.warn(`[LID Merge Guard] Blocking merge: placeholder ${placeholder.id} has ${totalPlaceholderMessages} messages (threshold: 50). Manual review required. LID=${lidRaw}, realContact=${realContact.id}`);
                        } else {
                            console.log(`[LID Merge Guard] Proceeding with merge: placeholder ${placeholder.id} has ${totalPlaceholderMessages} messages. Target: ${realContact.id} (${realContact.phone})`);

                            for (const convo of placeholderConvos) {
                                const targetConvo = await db.conversation.findUnique({
                                    where: { locationId_contactId: { locationId, contactId: realContact.id } }
                                });

                                if (targetConvo) {
                                    // Move messages & delete old convo
                                    await db.message.updateMany({
                                        where: { conversationId: convo.id },
                                        data: { conversationId: targetConvo.id }
                                    });
                                    await db.conversation.delete({ where: { id: convo.id } });
                                    console.log(`[LID Capture] Merged conversation ${convo.id} -> ${targetConvo.id}`);
                                } else {
                                    // Reassign
                                    await db.conversation.update({
                                        where: { id: convo.id },
                                        data: { contactId: realContact.id }
                                    });
                                    console.log(`[LID Capture] Reassigned conversation ${convo.id} to ${realContact.id}`);
                                }
                            }

                            // Delete placeholder
                            await db.contact.delete({ where: { id: placeholder.id } });
                            console.log(`[LID Capture] Deleted placeholder contact ${placeholder.id}`);
                        }
                    }
                }
            }
        }

        return { status: 'skipped', id: existing.id };
    }

    // Fetch Location for Access Token
    const locationDef = await db.location.findUnique({
        where: { id: locationId },
        select: { id: true, ghlLocationId: true, ghlAccessToken: true, whatsappPhoneNumberId: true, twilioAccountSid: true }
    });
    if (!locationDef) {
        console.error(`[WhatsApp Sync] Location ${locationId} not found`);
        return { status: 'error', reason: 'location_not_found' };
    }

    // Normalize Phones
    const normalizedFrom = from.startsWith('+') ? from : `+${from}`;
    const normalizedTo = to.startsWith('+') ? to : `+${to}`;

    // Determine the "Contact" phone number (The external party)
    // If inbound, Contact is "from". If outbound, Contact is "to".
    let contactPhone = direction === "inbound" ? normalizedFrom : normalizedTo;
    const ownPhone = direction === "inbound" ? normalizedTo : normalizedFrom;
    if (shouldRejectWebBridgeResolvedPhoneAsOwnPhone({
        source,
        direction,
        resolvedPhone: msg.resolvedPhone,
        ownPhone,
        locationPhone: locationDef.whatsappPhoneNumberId,
    })) {
        console.warn(`[WhatsApp Sync] Ignoring Web Bridge resolved phone equal to connected account for outbound message`, {
            wamId,
            remoteJid: msg.remoteJid,
            contactLid: msg.lid,
            direction,
            resolvedIdentitySource: msg.webBridgeIdentity?.source,
        });
        msg.resolvedPhone = undefined;
    }
    let contactIdentityIsLid = !isGroup && /@lid$/i.test(contactPhone);

    // --- LID RESOLUTION CHECK ---
    // If contactPhone implies an LID (ends with @lid) but we have a resolved phone from webhook/route.ts, use it.
    if (msg.resolvedPhone) {
        const resolvedDigits = normalizeDigits(msg.resolvedPhone);
        if (isHighConfidenceResolvedPhone(resolvedDigits)) {
            const p = `+${resolvedDigits}`;
            if (!contactPhone.includes(p)) {
                console.log(`[WhatsApp Sync] Using Webhook Resolved Phone: ${p} instead of ${contactPhone}`);
                contactPhone = p;
            }
        } else if (resolvedDigits) {
            console.warn(`[WhatsApp Sync] Ignoring low-confidence resolved phone for ${msg.wamId}: +${resolvedDigits}`);
        }
    }
    contactIdentityIsLid = !isGroup && /@lid$/i.test(contactPhone);
    const isUnsafeWebBridgeInboundLidOnly = source === "whatsapp_web_bridge"
        && direction === "inbound"
        && !isGroup
        && contactIdentityIsLid
        && !isHighConfidenceResolvedPhone(normalizeDigits(msg.resolvedPhone));

    if (source === "whatsapp_web_bridge"
        && direction === "outbound"
        && !isGroup
        && contactIdentityIsLid
        && !isHighConfidenceResolvedPhone(normalizeDigits(msg.resolvedPhone))) {
        const adopted = await tryAdoptOutboundWebBridgeLidWebhookToAppMessage({
            locationId,
            wamId,
            body,
            timestamp,
            lid: msg.lid || contactPhone,
            providerThreadId: msg.remoteJid || msg.chatId || contactPhone,
            webBridgeIdentity: msg.webBridgeIdentity,
            ownPhone,
        });
        if (adopted?.id) {
            return { status: "processed", id: adopted.id };
        }
    }

    // If inbound is unresolved LID-only, defer message until mapping is known.
    // This prevents creating a second placeholder contact/conversation immediately.
    const isInboundUnresolvedLid = direction === 'inbound'
        && source !== "whatsapp_web_bridge"
        && !isGroup
        && contactPhone.includes('@lid')
        && !msg.resolvedPhone;
    if (isInboundUnresolvedLid) {
        const lidJid = msg.lid || contactPhone;
        const resolvedDigits = await tryResolveLidToPhone(locationId, lidJid);

        if (resolvedDigits) {
            contactPhone = `+${resolvedDigits}`;
            msg.resolvedPhone = resolvedDigits;
            console.log(`[WhatsApp Sync] Resolved LID ${lidJid} -> +${resolvedDigits} before contact lookup`);
        } else {
            if (msg.__skipUnresolvedLidDeferral) {
                const attempt = msg.__deferredAttempt || 0;
                const LID_FALLTHROUGH_THRESHOLD = 10;
                if (attempt < LID_FALLTHROUGH_THRESHOLD) {
                    console.warn(`[WhatsApp Sync] LID still unresolved after retry ${attempt}: ${lidJid}`);
                    return {
                        status: 'deferred_unresolved_lid',
                        reason: 'lid_unresolved_retry',
                        attempts: attempt
                    };
                }
                // After threshold retries, stop deferring — fall through to create
                // a placeholder contact (phone: null, lid: set). The existing LID
                // merge logic will auto-merge when a phone mapping arrives later.
                console.warn(`[WhatsApp Sync] LID unresolved after ${attempt} retries — creating placeholder contact for ${lidJid}`);
                contactPhone = lidJid;
            } else {
                // First encounter: enqueue for background retry
                try {
                    const { initWhatsAppLidResolveWorker, enqueueDeferredLidMessage } = await import('@/lib/queue/whatsapp-lid-resolve');
                    await initWhatsAppLidResolveWorker();
                    await enqueueDeferredLidMessage(msg, lidJid);
                    console.warn(`[WhatsApp Sync] Deferred unresolved inbound LID message in BullMQ ${msg.wamId} (${lidJid}).`);
                } catch (queueErr) {
                    console.error('[WhatsApp Sync] Failed to enqueue unresolved LID message in BullMQ. Falling back to in-memory deferral:', queueErr);
                    enqueueInMemoryDeferredLidMessage(msg, lidJid);
                }

                return {
                    status: 'deferred_unresolved_lid',
                    reason: 'lid_unresolved_deferred'
                };
            }
        }
    }

    // --- Enhanced Contact Lookup ---
    // 1. Clean the input phone to raw digits. Exact digit matches use the normalized-phone expression index.
    const rawInputPhone = contactIdentityIsLid ? "" : contactPhone.replace(/\D/g, '');

    // --- Group Chat Handling ---
    let contactType = "Lead";
    let nameToUse = contactName;

    if (isGroup) {
        contactType = "WhatsAppGroup";
        // If we don't have a specific group name, use a default.
        if (!nameToUse) nameToUse = `WhatsApp Group ${contactPhone}`;
    } else {
        // 1:1 Chat Logic
        // Fix for "Self-Naming" bug on outbound messages
        // If outbound, the "contactName" (pushName) is the Sender/User, NOT the contact.
        // We should Ignore it for outbound.
        if (direction === "outbound") {
            nameToUse = undefined;
        }
    }

    // 2. Find Existing Contact (Lookup by Phone OR LID)
    // Normalize LID for DB lookup (strip @lid suffix for contains search)
    const lidRaw = normalizeLidRaw(msg.lid) || undefined;
    const normalizedMsgLid = normalizeLidJid(msg.lid) || undefined;
    const mappedLidIdentity = source === "whatsapp_web_bridge" && normalizedMsgLid
        ? await (db as any).whatsAppIdentityMap.findFirst({
            where: {
                locationId,
                provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
                identityType: "lid",
                identityValue: normalizedMsgLid,
                contactId: { not: null },
                phone: { not: null },
            },
            include: { contact: true },
            orderBy: [{ updatedAt: "desc" }],
        }).catch(() => null)
        : null;
    const mappedLidContact = mappedLidIdentity?.contact
        && isHighConfidenceResolvedPhone(normalizeDigits(mappedLidIdentity.phone || mappedLidIdentity.contact.phone))
        ? mappedLidIdentity.contact
        : null;
    const phoneCandidates = rawInputPhone
        ? await findContactsByPhoneDigitsWithFallback(db, locationId, rawInputPhone, { take: 12 })
        : [];
    const lidCandidates = lidRaw ? await db.contact.findMany({
        where: {
            locationId,
            OR: [
                { lid: normalizedMsgLid },
                { lid: lidRaw },
                { lid: { contains: lidRaw } },
            ],
        } as any,
    }) : [];
    const candidates = [
        ...phoneCandidates,
        ...(mappedLidContact ? [mappedLidContact] : []),
        ...lidCandidates,
    ].filter((candidate, index, list) =>
        list.findIndex((row) => row.id === candidate.id) === index
    );

    // Strategy: Prefer LID match -> Then Phone Match
    const phoneMatches = candidates.filter(c => {
        if (!c.phone) return false;
        return phoneDigitsLikelyMatch(rawInputPhone, c.phone);
    });
    const phoneMatchCandidate =
        phoneMatches.find((candidate) => candidate.contactType !== "Ref-GroupMember")
        || phoneMatches[0];
    const phoneMatchIdentityConflict = Boolean(phoneMatchCandidate && normalizedMsgLid && hasWebBridgeIdentityNameConflict({
        source,
        isGroup,
        identity: msg.webBridgeIdentity,
        contact: phoneMatchCandidate,
    }));
    const safePhoneMatchCandidate = phoneMatchIdentityConflict ? undefined : phoneMatchCandidate;
    if (phoneMatchIdentityConflict && phoneMatchCandidate) {
        console.warn(`[WhatsApp Sync] Refusing Web Bridge LID ${normalizedMsgLid} phone match to contact ${phoneMatchCandidate.id} (${phoneMatchCandidate.name || phoneMatchCandidate.phone || "unnamed"}) because contact metadata name conflicts`);
    }

    let matchedByLid = false;
    const lidMatches = candidates.filter((c: any) => {
        if (!msg.lid) return false;
        if (hasWebBridgeIdentityNameConflict({
            source,
            isGroup,
            identity: msg.webBridgeIdentity,
            contact: c,
        })) return false;
        if (mappedLidContact?.id && c.id === mappedLidContact.id) return true;
        if (isUnsafeWebBridgeInboundLidOnly && c.phone) return false;
        if (shouldRejectWebBridgeOutboundLidForOwnContact({
            source,
            direction,
            isGroup,
            messageLid: msg.lid,
            contactPhone: c.phone,
            ownPhone,
        })) return false;
        if (!c.lid) return false;
        // Normalize both for comparison (strip @lid if present)
        return normalizeLidJid(c.lid) === normalizedMsgLid;
    });
    let contact = selectPreferredWhatsAppLidContact(lidMatches, {
        mappedContactId: mappedLidContact?.id,
    });
    if (contact) matchedByLid = true;

    let isNewContact = false;
    if (!contact) {
        contact = safePhoneMatchCandidate;
    } else if (matchedByLid && rawInputPhone.length >= 9) {
        const lidContactPhoneDigits = normalizeDigits(contact.phone);
        const lidPhoneMatchesResolvedPhone = !!lidContactPhoneDigits && (
            lidContactPhoneDigits === rawInputPhone
            || lidContactPhoneDigits.endsWith(rawInputPhone)
            || rawInputPhone.endsWith(lidContactPhoneDigits)
        );
        if (!lidPhoneMatchesResolvedPhone && phoneMatchIdentityConflict && !lidContactPhoneDigits) {
            console.warn(`[WhatsApp Sync] Keeping LID-only contact ${contact.id} for ${normalizedMsgLid}; resolved phone +${rawInputPhone} matched a conflicting named contact.`);
        } else if (!lidPhoneMatchesResolvedPhone) {
            if (safePhoneMatchCandidate) {
                console.warn(`[WhatsApp Sync] Ignoring stale LID match ${contact.id}; resolved phone matched contact ${safePhoneMatchCandidate.id}`);
                contact = safePhoneMatchCandidate;
                matchedByLid = false;
            } else {
                console.warn(`[WhatsApp Sync] Ignoring stale LID match ${contact.id}; resolved phone +${rawInputPhone} conflicts with contact phone ${contact.phone || "(none)"}`);
                contact = undefined as any;
                matchedByLid = false;
            }
        }
    }

    if (contact && !isGroup && contact.contactType === "Ref-GroupMember") {
        const participationCount = await db.conversationParticipant.count({
            where: { contactId: contact.id }
        });

        if (participationCount === 0) {
            const shouldRename = !!nameToUse && isRefGroupMemberPlaceholder(contact);
            contact = await db.contact.update({
                where: { id: contact.id },
                data: {
                    contactType: "Lead",
                    ...(shouldRename ? { name: nameToUse } : {})
                } as any
            });
            console.warn(`[WhatsApp Sync] Promoted leaked Ref-GroupMember ${contact.id} to Lead for direct chat handling`);
        }
    }

    // If we matched by LID placeholder but now have a real phone (e.g. payload has previousRemoteJid),
    // backfill phone directly or merge into existing phone contact if one already exists.
    if (contact && matchedByLid && !isGroup && !contact.phone && !contactPhone.includes('@lid') && rawInputPhone.length >= 7 && !phoneMatchIdentityConflict) {
        const normalizedPhone = contactPhone.startsWith('+') ? contactPhone : `+${rawInputPhone}`;
        const shouldRename = !!nameToUse && (
            (contact.name || '').startsWith('WhatsApp User')
            || (contact.name || '').startsWith('Group Member ')
        );
        const shouldPromoteRefGroupMember = contact.contactType === "Ref-GroupMember";

        try {
            contact = await db.contact.update({
                where: { id: contact.id },
                data: {
                    phone: normalizedPhone,
                    ...(shouldRename ? { name: nameToUse } : {}),
                    ...(shouldPromoteRefGroupMember ? { contactType: "Lead" } : {})
                } as any
            });
            console.log(`[WhatsApp Sync] Backfilled phone ${normalizedPhone} on LID contact ${contact.id}`);
        } catch (err: any) {
            const targetPhoneContact = safePhoneMatchCandidate && safePhoneMatchCandidate.id !== contact.id ? safePhoneMatchCandidate : null;

            if (!targetPhoneContact) {
                console.error(`[WhatsApp Sync] Failed to backfill phone on LID contact ${contact.id}:`, err?.message || err);
            } else {
                // --- SAFETY GUARD: Verify source contact is truly a placeholder ---
                const isSourcePlaceholder = isWebBridgeLidPlaceholderContact(contact);
                if (!isSourcePlaceholder) {
                    console.warn(`[LID Merge Guard] Skipping backfill merge: source contact ${contact.id} ("${contact.name}", phone=${contact.phone}) is not a placeholder`);
                } else {
                    console.log(`[WhatsApp Sync] Merging LID placeholder ${contact.id} into phone contact ${targetPhoneContact.id}`);

                    const sourceConvos = await db.conversation.findMany({
                        where: { locationId, contactId: contact.id }
                    });

                    // --- SAFETY GUARD: Message count check ---
                    let sourceMsgCount = 0;
                    for (const sourceConvo of sourceConvos) {
                        sourceMsgCount += await db.message.count({ where: { conversationId: sourceConvo.id } });
                    }

                    if (sourceMsgCount > 50) {
                        console.warn(`[LID Merge Guard] Blocking backfill merge: placeholder ${contact.id} has ${sourceMsgCount} messages (threshold: 50). Manual review required.`);
                    } else {
                        console.log(`[LID Merge Guard] Proceeding with backfill merge: ${sourceMsgCount} messages from ${contact.id} -> ${targetPhoneContact.id}`);

                        for (const sourceConvo of sourceConvos) {
                            const targetConvo = await db.conversation.findUnique({
                                where: {
                                    locationId_contactId: {
                                        locationId,
                                        contactId: targetPhoneContact.id
                                    }
                                }
                            });

                            if (targetConvo) {
                                await db.message.updateMany({
                                    where: { conversationId: sourceConvo.id },
                                    data: { conversationId: targetConvo.id }
                                });
                                await db.conversation.delete({ where: { id: sourceConvo.id } });
                            } else {
                                await db.conversation.update({
                                    where: { id: sourceConvo.id },
                                    data: { contactId: targetPhoneContact.id }
                                });
                            }
                        }

                        await db.contact.delete({ where: { id: contact.id } });

                        contact = await db.contact.update({
                            where: { id: targetPhoneContact.id },
                            data: {
                                ...(msg.lid ? { lid: msg.lid } : {}),
                                ...(shouldRename ? { name: nameToUse } : {})
                            } as any
                        });
                        console.log(`[WhatsApp Sync] Merged placeholder and linked LID ${msg.lid || '(none)'} to ${contact.id}`);
                    }
                }
            }
        }
    }

    // Link LID if found by phone but missing LID
    const contactLidNorm = normalizeLidJid(contact?.lid);
    const msgLidNorm = normalizedMsgLid;
    if (contact && msg.lid && contactLidNorm !== msgLidNorm) {
        const contactPhoneDigits = normalizeDigits(contact.phone);
        const phoneIdentityMatchesContact = !!rawInputPhone
            && rawInputPhone.length >= 9
            && (
                contactPhoneDigits === rawInputPhone
                || contactPhoneDigits.endsWith(rawInputPhone)
                || rawInputPhone.endsWith(contactPhoneDigits)
            );
        const canAttachLid = matchedByLid || phoneIdentityMatchesContact || !contactLidNorm;

        if (canAttachLid) {
            await db.contact.update({
                where: { id: contact.id },
                data: { lid: msg.lid } as any
            }).catch(err => console.error("Failed to link LID:", err));
            console.log(`[WhatsApp Sync] Linked LID ${msg.lid} to contact ${contact.phone}`);
        } else {
            console.warn(`[WhatsApp Sync] Refusing to overwrite existing LID ${contact.lid} on contact ${contact.id} with unrelated LID ${msg.lid}`);
        }
    }

    if (!contact && phoneMatchIdentityConflict && normalizedMsgLid) {
        console.warn(`[WhatsApp Sync] Deferred Web Bridge message ${wamId}: LID ${normalizedMsgLid} resolved to phone +${rawInputPhone}, but the matched contact identity name conflicts. Manual review required.`);
        return {
            status: 'deferred_unresolved_lid',
            reason: 'web_bridge_identity_name_conflict'
        };
    }

    if (!contact) {
        // --- VALIDATION: Prevent creation of invalid contacts (e.g. unresolved LIDs) ---
        const cleanForCheck = contactPhone.replace(/\D/g, '');
        const isInvalidUS = contactPhone.startsWith('+1') && (cleanForCheck.substring(1, 2) === '0' || cleanForCheck.substring(1, 2) === '1');

        // NEW: Check if this is an unresolved LID
        const isUnresolvedLid = contactPhone.includes('@lid');

        if (isUnresolvedLid) {
            // It's an LID we couldn't resolve even after API lookup.
            // We allow creation BUT with phone = null and lid = <value>
            // We must skip the "cleanForCheck.length >= 16" blocking check for this specific case
            console.warn(`[WhatsApp Sync] Creating contact for Unresolved LID: ${contactPhone}`);
        } else if (cleanForCheck.length >= 16 || isInvalidUS) {
            console.warn(`[WhatsApp Sync] BLOCKED (Strict): ${contactPhone}`);
            return { status: 'skipped', reason: 'invalid_number_strict' };
        }

        // --- SOURCE OF TRUTH CHECK (Google > GHL) ---
        let finalName = nameToUse || (isUnresolvedLid ? "WhatsApp Contact" : `WhatsApp User ${contactPhone}`);
        let foundGhlId: string | undefined;
        let foundGoogleId: string | undefined;
        let foundEmail: string | undefined;
        let foundTags: string[] = [];
        let foundAddress: any = {};

        // 1. Check Google Contacts (Primary Source of Truth for Name)
        try {
            // Find a user with Google Sync enabled for this location
            // Webhook context: We find the first user who has enabled sync for this location.
            const googleUser = await db.user.findFirst({
                where: {
                    locations: { some: { id: locationId } },
                    googleSyncEnabled: true
                },
                select: { id: true }
            });

            if (googleUser) {
                const { searchGoogleContacts } = await import("@/lib/google/people");
                const gContacts = await searchGoogleContacts(googleUser.id, contactPhone);

                if (gContacts.length > 0) {
                    const gMatch = gContacts[0];
                    // Ensure gMatch is not null (filter(Boolean) removes nulls but TS doesn't infer)
                    if (gMatch) {
                        console.log(`[WhatsApp Sync] Found existing Google Contact: ${gMatch.resourceName} (${gMatch.name})`);

                        foundGoogleId = gMatch.resourceName || undefined;
                        finalName = gMatch.name || finalName; // Google Name Wins
                        foundEmail = gMatch.email || foundEmail;
                    }
                }
            }
        } catch (err) {
            console.error("[WhatsApp Sync] Failed to check Google:", err);
        }

        // 2. Check GHL (Secondary / Back Layer)
        // We still check GHL to link the ID and prevent duplicates in CRM
        if (isGhlIntegrationEnabled() && locationDef.ghlAccessToken && locationDef.ghlLocationId) {
            try {
                const { ghlFetch } = await import("@/lib/ghl/client");
                const cleanPhone = contactPhone.replace(/\D/g, '');
                // Search by Phone
                const searchRes = await ghlFetch<{ contacts: any[] }>(`/contacts/?locationId=${locationDef.ghlLocationId}&query=${cleanPhone}`, locationDef.ghlAccessToken);

                if (searchRes.contacts && searchRes.contacts.length > 0) {
                    const match = searchRes.contacts.find((c: any) => {
                        const cPhone = c.phone?.replace(/\D/g, '');
                        return cPhone && (cPhone === cleanPhone || cPhone.endsWith(cleanPhone) || cleanPhone.endsWith(cPhone));
                    });

                    if (match) {
                        console.log(`[WhatsApp Sync] Found existing GHL Contact: ${match.id} (${match.name})`);
                        foundGhlId = match.id;

                        // Only use GHL data if we didn't find it in Google (Google Priority)
                        if (!foundGoogleId) {
                            finalName = match.name || finalName;
                            foundEmail = match.email || foundEmail;
                        }

                        // Always merge tags/address from GHL as Google might not have them
                        foundTags = match.tags || [];
                        foundAddress = {
                            city: match.city || foundAddress.city,
                            state: match.state || foundAddress.state,
                            country: match.country || foundAddress.country,
                            postalCode: match.postalCode || foundAddress.postalCode,
                            address1: match.address1 || foundAddress.address1
                        };
                    }
                }
            } catch (err) {
                console.error("[WhatsApp Sync] Failed to check GHL:", err);
            }
        }

        console.log(`[WhatsApp Sync] Creating new contact. Name: ${finalName}, GHL: ${foundGhlId}, Google: ${foundGoogleId}`);

        const contactCreateData = {
            locationId,
            phone: isUnresolvedLid ? undefined : contactPhone,
            name: finalName,
            email: foundEmail,
            status: "New",
            contactType: contactType,
            lid: normalizedMsgLid || msg.lid || undefined, // Store canonical full LID JID for consistent matching
            ghlContactId: foundGhlId,
            googleContactId: foundGoogleId,
            tags: foundTags.length > 0 ? foundTags : undefined,
            ...foundAddress
        } as any;

        if (isUnresolvedLid && normalizedMsgLid) {
            const existingOrCreated = await db.$transaction(async (tx) => {
                // Serialize unresolved-LID creation per location so concurrent webhooks for
                // the same WhatsApp Web chat cannot create duplicate placeholder contacts.
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${locationId}), hashtext(${normalizedMsgLid}))`;

                const existingLidLookup = buildContactLidLookup(locationId, normalizedMsgLid);
                const existingLidContact = existingLidLookup ? await (tx as any).contact.findFirst({
                    where: isUnsafeWebBridgeInboundLidOnly
                        ? { AND: [existingLidLookup, { phone: null }] }
                        : existingLidLookup,
                    orderBy: [
                        { phone: "desc" },
                        { createdAt: "asc" },
                        { id: "asc" },
                    ],
                }) : null;
                if (existingLidContact) {
                    return { contact: existingLidContact, created: false };
                }

                const created = await (tx as any).contact.create({
                    data: contactCreateData,
                });
                return { contact: created, created: true };
            });

            contact = existingOrCreated.contact;
            isNewContact = existingOrCreated.created;
            if (!isNewContact) {
                console.log(`[WhatsApp Sync] Reused existing unresolved LID contact ${contact.id} for ${normalizedMsgLid}`);
            }
        } else {
            try {
                contact = await db.contact.create({
                    data: contactCreateData,
                });
                isNewContact = true;
            } catch (error: any) {
                if (error?.code !== "P2002") throw error;
                const existingContact = await db.contact.findFirst({
                    where: {
                        locationId,
                        OR: [
                            ...(contactCreateData.phone ? [{ phone: contactCreateData.phone }] : []),
                            ...(rawInputPhone ? [{ phone: { contains: rawInputPhone.slice(-8) } }] : []),
                            ...(normalizedMsgLid ? [
                                { lid: normalizedMsgLid },
                                { lid: normalizeLidRaw(normalizedMsgLid) || normalizedMsgLid },
                            ] : []),
                        ],
                    } as any,
                    orderBy: [
                        { updatedAt: "desc" },
                        { createdAt: "asc" },
                    ],
                });
                if (!existingContact) throw error;
                contact = existingContact;
                isNewContact = false;
                console.warn(`[WhatsApp Sync] Reused concurrently-created contact ${contact.id} for ${contactCreateData.phone || normalizedMsgLid || contactPhone}`);
            }
        }
    } else {
        console.log(`[WhatsApp Sync] Matched existing contact: ${contact.name} (${contact.id})`);

        // Optional: Update name if available and not set? 
        if (isGroup && nameToUse && contact.name !== nameToUse) {
            await db.contact.update({ where: { id: contact.id }, data: { name: nameToUse } });
        }
    }

    const isWebBridgeLidOnlyContact = source === "whatsapp_web_bridge" && !contact?.phone && !!contact?.lid;

    if (isNewContact && !isWebBridgeLidOnlyContact) {
        import("@/lib/google/automation")
            .then(({ runGoogleAutoSyncForContact }) =>
                runGoogleAutoSyncForContact({
                    locationId,
                    contactId: contact!.id,
                    source: "WHATSAPP_INBOUND",
                    event: "create"
                })
            )
            .catch(err => console.error("[GoogleAutoSync] WhatsApp inbound sync failed:", err));
    }

    if (source === "whatsapp_web_bridge" && contact?.id) {
        const resolvedMappedPhone = !phoneMatchIdentityConflict && msg.resolvedPhone && isHighConfidenceResolvedPhone(normalizeDigits(msg.resolvedPhone))
            ? `+${normalizeDigits(msg.resolvedPhone)}`
            : null;
        const mappedPhone = resolvedMappedPhone || contact?.phone || null;
        if (normalizedMsgLid) {
            await upsertWebBridgeIdentityMap({
                locationId,
                contactId: contact.id,
                identityType: "lid",
                identityValue: normalizedMsgLid,
                lid: normalizedMsgLid,
                phone: mappedPhone,
                displayName: contact.name || nameToUse || null,
                confidence: mappedPhone ? "high" : "unresolved",
                source: mappedPhone ? "message_ingestion" : "lid_only_message",
                lastSeenAt: timestamp,
                metadata: msg.webBridgeIdentity || undefined,
            });
        }
        if (mappedPhone && !contactIdentityIsLid) {
            await upsertWebBridgeIdentityMap({
                locationId,
                contactId: contact.id,
                identityType: "phone",
                identityValue: normalizeDigits(mappedPhone),
                lid: normalizedMsgLid || contact.lid || null,
                phone: mappedPhone,
                displayName: contact.name || nameToUse || null,
                confidence: "high",
                source: "message_ingestion",
                lastSeenAt: timestamp,
                metadata: msg.webBridgeIdentity || undefined,
            });
        }
        if (msg.chatId || msg.remoteJid) {
            await upsertWebBridgeIdentityMap({
                locationId,
                contactId: contact.id,
                identityType: "chat",
                identityValue: String(msg.chatId || msg.remoteJid),
                lid: normalizedMsgLid || contact.lid || null,
                phone: mappedPhone,
                displayName: contact.name || nameToUse || null,
                confidence: mappedPhone ? "high" : "unresolved",
                source: "message_ingestion",
                lastSeenAt: timestamp,
                metadata: msg.webBridgeIdentity || undefined,
            });
        }
    }

    if (direction === "inbound" && !isGroup && contact?.id) {
        const inboundAt = timestamp || new Date();
        await db.contact.update({
            where: { id: contact.id },
            data: {
                whatsappLastInboundAt: inboundAt,
                whatsappCustomerServiceExpiresAt: computeWhatsAppCustomerServiceExpiresAt(inboundAt),
            } as any,
        }).catch((err) => {
            console.warn("[WhatsApp Sync] Failed to update customer service window:", err?.message || err);
        });
    }

    // 4. Find or Create Conversation — anchored by contactId + locationId
    let conversation = await db.conversation.findFirst({
        where: { contactId: contact.id, locationId }
    });

    if (!conversation) {
        try {
            conversation = await db.conversation.create({
                data: {
                    ghlConversationId: null,
                    locationId,
                    contactId: contact.id,
                    lastMessageBody: body,
                    lastMessageAt: timestamp,
                    lastMessageType: 'TYPE_WHATSAPP',
                    unreadCount: direction === 'inbound' ? 1 : 0,
                    status: 'open'
                }
            });
            console.log(`[WhatsApp Sync] Created conversation ${conversation.id} for contact ${contact.id}`);
        } catch (error: any) {
            if (error?.code !== "P2002") throw error;
            conversation = await db.conversation.findUnique({
                where: { locationId_contactId: { locationId, contactId: contact.id } },
            });
            if (!conversation) throw error;
            console.log(`[WhatsApp Sync] Reused concurrently-created conversation ${conversation.id} for contact ${contact.id}`);
        }
    }

    const providerThreadId = msg.remoteJid || msg.chatId || msg.from || conversation.ghlConversationId || conversation.id;
    const syncProvider = getMessageSyncProvider(source);
    const syncProviderAccountId =
        syncProvider === WHATSAPP_CLOUD_PROVIDER
            ? (locationDef?.whatsappPhoneNumberId || "default")
            : syncProvider === "twilio"
                ? (locationDef?.twilioAccountSid || "default")
                : syncProvider === WHATSAPP_WEB_BRIDGE_PROVIDER
                    ? locationId
                : "retired";
    await (db as any).conversationSync.upsert({
        where: {
            conversationId_provider_providerAccountId: {
                conversationId: conversation.id,
                provider: syncProvider,
                providerAccountId: syncProviderAccountId,
            },
        },
        create: {
            conversationId: conversation.id,
            locationId,
            provider: syncProvider,
            providerAccountId: syncProviderAccountId,
            providerConversationId: providerThreadId,
            status: "synced",
            lastSyncedAt: new Date(),
            metadata: { source },
        },
        update: {
            providerConversationId: providerThreadId,
            status: "synced",
            lastSyncedAt: new Date(),
            lastError: null,
            metadata: { source },
        },
    }).catch(async (error: any) => {
        if (error?.code === "P2002" && providerThreadId) {
            const reused = await (db as any).conversationSync.updateMany({
                where: {
                    provider: syncProvider,
                    providerAccountId: syncProviderAccountId,
                    providerConversationId: providerThreadId,
                },
                data: {
                    conversationId: conversation.id,
                    locationId,
                    status: "synced",
                    lastSyncedAt: new Date(),
                    lastError: null,
                    metadata: { source, reusedAfterUniqueConflict: true },
                },
            }).catch(() => null);
            if (reused?.count) {
                console.warn(`[WhatsApp Sync] Reused ${syncProvider} conversation sync after providerConversationId conflict: ${providerThreadId}`);
                return;
            }
        }
        console.warn(`[WhatsApp Sync] Failed to persist ${syncProvider} conversation sync:`, error?.message || error);
    });

    if (direction === "outbound") {
        const reconciled = await tryReconcileOutboundWebhookToPendingMessage({
            locationId,
            conversationId: conversation.id,
            conversationGhlId: conversation.ghlConversationId || conversation.id,
            wamId,
            body,
            timestamp,
            source,
        });
        if (reconciled?.id) {
            return { status: "processed", id: reconciled.id };
        }
    }

    // 5. Group Participant Sync (New Architecture)
    if (isGroup && direction === "inbound" && conversation) {
        try {
            await upsertGroupParticipantShadow({
                conversationId: conversation.id,
                timestamp,
                role: "member",
                participantJid: msg.participantJid || null,
                participantPhoneJid: msg.participantPhoneJid || null,
                participantLidJid: msg.participantLidJid || null,
                participantDisplayName: msg.participantDisplayName || contactName || null,
            });
            console.log(`[WhatsApp Sync] Upserted shadow participant for Group Conversation ${conversation.id}`);
        } catch (err) {
            console.error("[WhatsApp Sync] Failed to upsert group participant shadow:", err);
        }
    }

    // 6. Create Message
    let newMessage: any;
    try {
        newMessage = await db.message.create({
            data: {
                conversationId: conversation.id,
                ghlMessageId: `wa_${wamId}`,
                wamId: wamId,
                type: "WhatsApp",
                direction: direction,
                status: direction === "inbound" ? "received" : "sent",
                body: body,
                source: source,
                createdAt: timestamp,
                updatedAt: new Date(),
            }
        });
    } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        const existingByWam = await db.message.findUnique({
            where: { wamId },
            include: { conversation: { include: { contact: true } } },
        });
        if (existingByWam?.id) {
            if (source === "whatsapp_web_bridge" && direction === "outbound" && msg.lid) {
                await attachWebBridgeLidToExistingOutboundMessage({
                    locationId,
                    message: existingByWam,
                    lid: msg.lid,
                    timestamp,
                    source,
                    webBridgeIdentity: msg.webBridgeIdentity,
                    providerThreadId: msg.remoteJid || msg.chatId || null,
                    providerAccountId: syncProviderAccountId,
                    ownPhone,
                });
            }
            await reconcileExistingWebBridgeMessageBodySafely({
                message: existingByWam,
                incomingBody: body,
                source,
                wamId,
            });
            console.log(`[WhatsApp Sync] Duplicate webhook ack detected for ${wamId}; treating as success.`);
            return { status: "processed", id: existingByWam.id };
        }
        throw error;
    }

    console.log(`[WhatsApp Sync] Created message ${wamId} for conversation ${conversation.id}`);

    await (db as any).messageSync.upsert({
        where: {
            messageId_provider_providerAccountId: {
                messageId: newMessage.id,
                provider: syncProvider,
                providerAccountId: syncProviderAccountId,
            },
        },
        create: {
            messageId: newMessage.id,
            conversationId: conversation.id,
            locationId,
            provider: syncProvider,
            providerAccountId: syncProviderAccountId,
            providerMessageId: wamId,
            providerThreadId,
            status: "synced",
            remoteUpdatedAt: timestamp,
            lastSyncedAt: new Date(),
            metadata: { source },
        },
        update: {
            providerMessageId: wamId,
            providerThreadId,
            status: "synced",
            remoteUpdatedAt: timestamp,
            lastSyncedAt: new Date(),
            lastError: null,
            metadata: { source },
        },
    }).catch((error: any) => {
        console.warn(`[WhatsApp Sync] Failed to persist ${syncProvider} message sync:`, error?.message || error);
    });

    // Unified Update Logic
    const { updateConversationLastMessage } = await import('@/lib/conversations/update');
    await updateConversationLastMessage({
        conversationId: conversation.id,
        messageBody: body,
        messageType: 'TYPE_WHATSAPP',
        messageDate: timestamp,
        direction: direction,
        // Helper handles inbound unread increment
    });

    // Emit realtime event immediately after local write path completes.
    // External sync (GHL, AI side effects) can continue without blocking UI freshness.
    // For inbound messages we include the full message body and timestamp so the
    // frontend can optimistically render the bubble without a server round-trip.
    void publishConversationRealtimeEvent({
        locationId,
        conversationId: conversation.id,
        type: direction === "inbound" ? "message.inbound" : "message.outbound",
        payload: {
            direction,
            messageType: "whatsapp",
            messageId: newMessage.id,
            wamId,
            clientMessageId: (newMessage as any)?.clientMessageId || null,
            status: direction === "inbound" ? "received" : "sent",
            // Optimistic rendering fields – only meaningful for inbound
            ...(direction === "inbound" ? {
                body: body || "",
                createdAt: timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString(),
                contactName: contact?.name || null,
            } : {}),
        },
    });

    // --- GHL 2-Way Sync ---
    try {
        // Location already fetched as locationDef

        if (isGhlIntegrationEnabled() && locationDef?.ghlAccessToken && locationDef?.ghlLocationId) {
            const isLidOnlyContact = !contact?.phone && !!contact?.lid;
            if (isLidOnlyContact) {
                console.warn(`[WhatsApp Sync] Skipping GHL sync for LID-only contact ${contact.id} (wamId: ${wamId})`);
                return { status: 'processed' };
            }

            const { ensureRemoteContact } = await import("@/lib/crm/contact-sync");
            const { sendMessage } = await import("@/lib/ghl/conversations");
            const { syncContactToGoogle } = await import("@/lib/google/people");

            // 1. Ensure Contact Exists in GHL (JIT)
            const remoteCid = await ensureRemoteContact(contact.id, locationDef.ghlLocationId, locationDef.ghlAccessToken);

            // 2. DISABLED: Auto-sync removed. Use Google Sync Manager for manual sync.
            // const googleUser = await db.user.findFirst({
            //     where: {
            //         locations: { some: { id: locationId } },
            //         googleSyncEnabled: true
            //     }
            // });
            // if (googleUser) {
            //     console.log(`[WhatsApp Sync] Syncing contact ${contact.id} to Google User ${googleUser.email}...`);
            //     syncContactToGoogle(googleUser.id, contact.id).catch(e => console.error("Google Sync bg error", e));
            // }

            if (remoteCid) {
                // Dynamically import Queue to avoid circular deps if any
                const { ghlSyncQueue } = await import("@/lib/queue/ghl-sync");

                console.log(`[WhatsApp Sync] Queueing message ${wamId} for GHL Sync (Contact: ${remoteCid})...`);

                const customProviderId = process.env.GHL_CUSTOM_PROVIDER_ID;

                // Add to Queue (Standard BullMQ)
                await ghlSyncQueue.add('sync-message', {
                    contactId: remoteCid,
                    type: customProviderId ? 'Custom' : 'WhatsApp',
                    body: body,
                    conversationProviderId: customProviderId,
                    direction: direction,
                    accessToken: locationDef.ghlAccessToken,
                    wamId: wamId
                });

                console.log(`[WhatsApp Sync] Job added to queue for ${wamId}`);
            } else {
                console.warn(`[WhatsApp Sync] Failed to resolve GHL Contact ID. Message not synced.`);
            }
        }
    } catch (err) {
    }
    // --- Smart Reply Generation (Background) ---
    if (direction === "inbound") {
        void markScheduledMessagesReviewRecommended({
            locationId,
            conversationId: conversation.id,
            reason: "New inbound WhatsApp message arrived before this scheduled send.",
        });
        if (source === "whatsapp_web_bridge" && !isGroup) {
            void detectAndHandleWhatsAppCallConsent({
                locationId,
                conversationId: conversation.id,
                contactId: contact.id,
                messageId: newMessage.id,
                wamId,
                body,
                contactPhone: contact.phone || null,
                receivedAt: timestamp,
            }).catch((error) => {
                console.warn("[WhatsApp Calling] Failed to process WebBridge call consent:", error?.message || error);
            });
        }

        queueRequirementProposalForNewActivity({
            locationId,
            contactId: contact.id,
            conversationId: conversation.id,
            sourceType: "message",
            sourceIds: [newMessage.id],
        });

        generateSmartReplies(conversation.id).catch(e => console.error("Smart Reply bg error", e));

        // --- Phase 6: Semi-Auto Event Emission ---
        // Emit event for the semi-auto prediction engine.
        // This triggers auto-drafting if semiAuto is enabled on the conversation.
        // Fire-and-forget to avoid slowing down webhook response.
        Promise.all([
            import("@/lib/ai/events/event-bus"),
            import("@/lib/ai/events/handlers"),
        ]).then(([{ eventBus }, { registerEventHandlers }]) => {
            registerEventHandlers(); // Idempotent — safe to call multiple times
            eventBus.emit({
                type: "message.received",
                payload: {
                    conversationId: conversation.id,
                    contactId: contact.id,
                    message: body,
                    channel: "whatsapp",
                    direction: "inbound",
                },
                metadata: {
                    timestamp: new Date(),
                    sourceId: source === "whatsapp_web_bridge" ? "whatsapp-web-bridge" : "whatsapp-provider",
                    conversationId: conversation.id,
                    contactId: contact.id,
                },
            }).catch(e => console.error("[Semi-Auto] Event emission error:", e));
        }).catch(e => console.error("[Semi-Auto] Event bus import error:", e));
    }

    return { status: 'processed' };
}
