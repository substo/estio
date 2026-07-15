import { randomUUID } from "crypto";

import db from "@/lib/db";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { enqueueWhatsAppOutbound, type WhatsAppTransport } from "@/lib/whatsapp/outbound-enqueue";
import { getReadyWhatsAppWebBridgeSession } from "@/lib/whatsapp/web-bridge";
import { hasOpenWhatsAppCustomerServiceWindow } from "@/lib/whatsapp/customer-window";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";

export const SCHEDULED_MESSAGE_CHANNELS = ["WhatsApp", "SMS_RELAY"] as const;
export type ScheduledMessageChannel = typeof SCHEDULED_MESSAGE_CHANNELS[number];

const DISPATCHABLE_STATUSES = ["scheduled", "failed"];
const TERMINAL_STATUSES = ["sent", "canceled"];
const STALE_LOCK_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type ScheduledMessageListItem = {
    id: string;
    conversationId: string;
    contactId: string;
    channel: ScheduledMessageChannel;
    body: string;
    status: string;
    source: string;
    scheduledFor: string;
    scheduledTimeZone: string | null;
    scheduledLocal: string | null;
    reviewRecommended: boolean;
    reviewReason: string | null;
    createdAt: string;
    updatedAt: string;
    sentAt: string | null;
    canceledAt: string | null;
    failedAt: string | null;
    lastError: string | null;
    attemptCount: number;
};

export type ScheduledMessageSummary = {
    count: number;
    nextScheduledFor: string | null;
    nextBody: string | null;
    reviewRecommended: boolean;
};

function normalizeChannel(value: unknown): ScheduledMessageChannel | null {
    const normalized = String(value || "").trim();
    return SCHEDULED_MESSAGE_CHANNELS.includes(normalized as ScheduledMessageChannel)
        ? normalized as ScheduledMessageChannel
        : null;
}

function normalizeBody(value: unknown): string {
    return String(value || "").trim();
}

function parseScheduledFor(value: unknown): Date | null {
    const date = new Date(String(value || ""));
    return Number.isFinite(date.getTime()) ? date : null;
}

function serializeScheduledMessage(row: any): ScheduledMessageListItem {
    return {
        id: row.id,
        conversationId: row.conversationId,
        contactId: row.contactId,
        channel: normalizeChannel(row.channel) || "WhatsApp",
        body: row.body || "",
        status: row.status || "scheduled",
        source: row.source || "composer",
        scheduledFor: new Date(row.scheduledFor).toISOString(),
        scheduledTimeZone: row.scheduledTimeZone || null,
        scheduledLocal: row.scheduledLocal || null,
        reviewRecommended: !!row.reviewRecommended,
        reviewReason: row.reviewReason || null,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
        canceledAt: row.canceledAt ? new Date(row.canceledAt).toISOString() : null,
        failedAt: row.failedAt ? new Date(row.failedAt).toISOString() : null,
        lastError: row.lastError || null,
        attemptCount: Number(row.attemptCount || 0),
    };
}

async function resolveConversationContact(args: {
    locationId: string;
    conversationId: string;
    contactId?: string | null;
}) {
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(args.locationId, args.conversationId),
        select: {
            id: true,
            locationId: true,
            contactId: true,
            ghlConversationId: true,
        },
    });
    if (!conversation || conversation.locationId !== args.locationId) {
        return { error: "Conversation not found." as const };
    }

    const requestedContactId = String(args.contactId || conversation.contactId || "").trim();
    const contact = await db.contact.findFirst({
        where: {
            locationId: args.locationId,
            OR: [
                { id: requestedContactId },
                { ghlContactId: requestedContactId },
                { id: conversation.contactId },
            ],
        },
        select: {
            id: true,
            phone: true,
            name: true,
            whatsappCustomerServiceExpiresAt: true,
        } as any,
    });
    if (!contact) return { error: "Contact not found." as const };
    if (conversation.contactId !== contact.id) return { error: "Conversation/contact mismatch." as const };

    return { conversation, contact };
}

export async function createScheduledMessage(args: {
    locationId: string;
    conversationId: string;
    contactId?: string | null;
    channel: unknown;
    body: unknown;
    scheduledFor: unknown;
    scheduledTimeZone?: string | null;
    scheduledLocal?: string | null;
    source?: string | null;
    metadata?: any;
    actorUserId?: string | null;
}) {
    const locationId = String(args.locationId || "").trim();
    const channel = normalizeChannel(args.channel);
    const body = normalizeBody(args.body);
    const scheduledFor = parseScheduledFor(args.scheduledFor);
    const scheduledTimeZone = String(args.scheduledTimeZone || "").trim() || null;
    const scheduledLocal = String(args.scheduledLocal || "").trim() || null;

    if (!locationId) return { success: false as const, error: "Missing location." };
    if (!channel) return { success: false as const, error: "Unsupported scheduled message channel." };
    if (!body) return { success: false as const, error: "Message body cannot be empty." };
    if (!scheduledFor) return { success: false as const, error: "Invalid scheduled date/time." };
    if (scheduledFor.getTime() <= Date.now()) {
        return { success: false as const, error: "Scheduled time must be in the future." };
    }

    const resolved = await resolveConversationContact({
        locationId,
        conversationId: args.conversationId,
        contactId: args.contactId,
    });
    if ("error" in resolved) return { success: false as const, error: resolved.error };

    const row = await (db as any).scheduledMessage.create({
        data: {
            locationId,
            conversationId: resolved.conversation.id,
            contactId: resolved.contact.id,
            channel,
            body,
            scheduledFor,
            scheduledTimeZone,
            scheduledLocal,
            source: String(args.source || "composer").trim() || "composer",
            metadata: args.metadata || undefined,
            approvedAt: new Date(),
            approvedByUserId: args.actorUserId || null,
            createdByUserId: args.actorUserId || null,
        },
    });

    await db.conversation.update({
        where: { id: resolved.conversation.id },
        data: { updatedAt: new Date() },
    }).catch(() => null);

    await publishConversationRealtimeEvent({
        locationId,
        conversationId: resolved.conversation.id,
        type: "scheduled_message.created",
        payload: { scheduledMessage: serializeScheduledMessage(row) },
    });

    return { success: true as const, scheduledMessage: serializeScheduledMessage(row) };
}

export async function listScheduledMessagesForConversation(args: {
    locationId: string;
    conversationId: string;
    includeTerminal?: boolean;
    limit?: number;
}) {
    const resolved = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(args.locationId, args.conversationId),
        select: { id: true, locationId: true },
    });
    if (!resolved || resolved.locationId !== args.locationId) return [];

    const rows = await (db as any).scheduledMessage.findMany({
        where: {
            locationId: args.locationId,
            conversationId: resolved.id,
            ...(args.includeTerminal ? {} : { status: { notIn: TERMINAL_STATUSES } }),
        },
        orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
        take: Math.max(1, Math.min(Number(args.limit || 20), 100)),
    });

    return rows.map(serializeScheduledMessage);
}

export async function buildScheduledMessageSummaryMap(
    locationId: string,
    conversationIds: string[]
): Promise<Map<string, ScheduledMessageSummary>> {
    const ids = Array.from(new Set(conversationIds.map((id) => String(id || "").trim()).filter(Boolean)));
    if (ids.length === 0) return new Map();

    const rows = await (db as any).scheduledMessage.findMany({
        where: {
            locationId,
            conversationId: { in: ids },
            status: { in: DISPATCHABLE_STATUSES },
        },
        orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
        select: {
            conversationId: true,
            body: true,
            scheduledFor: true,
            reviewRecommended: true,
        },
    });

    const map = new Map<string, ScheduledMessageSummary>();
    for (const row of rows) {
        const current = map.get(row.conversationId);
        if (!current) {
            map.set(row.conversationId, {
                count: 1,
                nextScheduledFor: new Date(row.scheduledFor).toISOString(),
                nextBody: row.body || null,
                reviewRecommended: !!row.reviewRecommended,
            });
        } else {
            current.count += 1;
            current.reviewRecommended = current.reviewRecommended || !!row.reviewRecommended;
        }
    }
    return map;
}

export function formatScheduledMessagesForAiContext(messages: ScheduledMessageListItem[]): string {
    const active = messages.filter((message) => DISPATCHABLE_STATUSES.includes(message.status));
    if (active.length === 0) return "";

    return active
        .map((message) => {
            const when = message.scheduledLocal || message.scheduledFor;
            const review = message.reviewRecommended ? " Review recommended before sending." : "";
            return `Scheduled outbound ${message.channel} for ${when}: ${message.body}${review}`;
        })
        .join("\n");
}

export async function getScheduledMessageAiContext(args: {
    locationId: string;
    conversationId: string;
    limit?: number;
}) {
    const messages = await listScheduledMessagesForConversation({
        locationId: args.locationId,
        conversationId: args.conversationId,
        limit: args.limit || 10,
    });
    return formatScheduledMessagesForAiContext(messages);
}

export async function updateScheduledMessage(args: {
    locationId: string;
    id: string;
    body?: unknown;
    scheduledFor?: unknown;
    scheduledTimeZone?: string | null;
    scheduledLocal?: string | null;
    channel?: unknown;
}) {
    const id = String(args.id || "").trim();
    if (!id) return { success: false as const, error: "Missing scheduled message ID." };

    const existing = await (db as any).scheduledMessage.findFirst({
        where: { id, locationId: args.locationId },
    });
    if (!existing) return { success: false as const, error: "Scheduled message not found." };
    if (TERMINAL_STATUSES.includes(String(existing.status))) {
        return { success: false as const, error: `Cannot edit a ${existing.status} scheduled message.` };
    }

    const data: any = {};
    if (args.body !== undefined) {
        const body = normalizeBody(args.body);
        if (!body) return { success: false as const, error: "Message body cannot be empty." };
        data.body = body;
    }
    if (args.channel !== undefined) {
        const channel = normalizeChannel(args.channel);
        if (!channel) return { success: false as const, error: "Unsupported scheduled message channel." };
        data.channel = channel;
    }
    if (args.scheduledFor !== undefined) {
        const scheduledFor = parseScheduledFor(args.scheduledFor);
        if (!scheduledFor) return { success: false as const, error: "Invalid scheduled date/time." };
        if (scheduledFor.getTime() <= Date.now()) {
            return { success: false as const, error: "Scheduled time must be in the future." };
        }
        data.scheduledFor = scheduledFor;
        data.status = "scheduled";
        data.failedAt = null;
        data.lastError = null;
        data.lockedAt = null;
        data.lockedBy = null;
    }
    if (args.scheduledTimeZone !== undefined) data.scheduledTimeZone = String(args.scheduledTimeZone || "").trim() || null;
    if (args.scheduledLocal !== undefined) data.scheduledLocal = String(args.scheduledLocal || "").trim() || null;

    const row = await (db as any).scheduledMessage.update({
        where: { id },
        data,
    });

    await db.conversation.update({
        where: { id: row.conversationId },
        data: { updatedAt: new Date() },
    }).catch(() => null);

    await publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: row.conversationId,
        type: "scheduled_message.updated",
        payload: { scheduledMessage: serializeScheduledMessage(row) },
    });

    return { success: true as const, scheduledMessage: serializeScheduledMessage(row) };
}

export async function cancelScheduledMessage(args: {
    locationId: string;
    id: string;
}) {
    const id = String(args.id || "").trim();
    if (!id) return { success: false as const, error: "Missing scheduled message ID." };

    const existing = await (db as any).scheduledMessage.findFirst({
        where: { id, locationId: args.locationId },
    });
    if (!existing) return { success: false as const, error: "Scheduled message not found." };
    if (TERMINAL_STATUSES.includes(String(existing.status))) {
        return { success: false as const, error: `Cannot cancel a ${existing.status} scheduled message.` };
    }

    const row = await (db as any).scheduledMessage.update({
        where: { id },
        data: {
            status: "canceled",
            canceledAt: new Date(),
            lockedAt: null,
            lockedBy: null,
        },
    });

    await db.conversation.update({
        where: { id: row.conversationId },
        data: { updatedAt: new Date() },
    }).catch(() => null);

    await publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: row.conversationId,
        type: "scheduled_message.canceled",
        payload: { scheduledMessageId: id },
    });

    return { success: true as const, scheduledMessage: serializeScheduledMessage(row) };
}

export async function markScheduledMessagesReviewRecommended(args: {
    locationId: string;
    conversationId: string;
    reason?: string | null;
}) {
    const reason = String(args.reason || "New inbound message arrived before the scheduled send.").trim();
    const result = await (db as any).scheduledMessage.updateMany({
        where: {
            locationId: args.locationId,
            conversationId: args.conversationId,
            status: { in: DISPATCHABLE_STATUSES },
            scheduledFor: { gt: new Date() },
            reviewRecommended: false,
        },
        data: {
            reviewRecommended: true,
            reviewReason: reason,
        },
    });
    return Number(result?.count || 0);
}

async function resolveWhatsAppOutboundTransport(locationId: string): Promise<{
    transport: WhatsAppTransport;
    cloudConfigured: boolean;
    webBridgeConfigured: boolean;
}> {
    const [integrationDoc, hasCloudSecret, row, webBridgeSession] = await Promise.all([
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
        }).catch(() => false),
        db.location.findUnique({
            where: { id: locationId },
            select: {
                whatsappPhoneNumberId: true,
                whatsappAccessToken: true,
                whatsappProviderMode: true,
                twilioAccountSid: true,
                twilioWhatsAppFrom: true,
            } as any,
        }),
        getReadyWhatsAppWebBridgeSession(locationId).catch(() => null),
    ]);
    const payload = integrationDoc?.payload || {};
    const mode = String(payload.whatsappProviderMode || (row as any)?.whatsappProviderMode || "web_bridge");
    const cloudConfigured = Boolean((payload.whatsappPhoneNumberId || (row as any)?.whatsappPhoneNumberId) && (hasCloudSecret || (row as any)?.whatsappAccessToken));
    const twilioConfigured = Boolean((payload.twilioAccountSid || (row as any)?.twilioAccountSid) && (payload.twilioWhatsAppFrom || (row as any)?.twilioWhatsAppFrom));
    const webBridgeConfigured = Boolean(webBridgeSession);

    if (mode === "web_bridge" || mode === "evolution_linked") return { transport: "web_bridge", cloudConfigured, webBridgeConfigured };
    if (mode === "twilio_fallback" && twilioConfigured) return { transport: "twilio", cloudConfigured, webBridgeConfigured };
    if (cloudConfigured) return { transport: "cloud_api", cloudConfigured, webBridgeConfigured };
    if (webBridgeConfigured) return { transport: "web_bridge", cloudConfigured, webBridgeConfigured };
    if (twilioConfigured) return { transport: "twilio", cloudConfigured, webBridgeConfigured };
    return { transport: "cloud_api", cloudConfigured, webBridgeConfigured };
}

async function dispatchWhatsAppScheduledMessage(row: any) {
    const resolved = await resolveConversationContact({
        locationId: row.locationId,
        conversationId: row.conversationId,
        contactId: row.contactId,
    });
    if ("error" in resolved) throw new Error(resolved.error);
    if (!resolved.contact.phone) throw new Error("Contact does not have a phone number.");
    if (String(resolved.contact.phone).includes("*")) throw new Error("Contact phone number is masked.");

    const transportState = await resolveWhatsAppOutboundTransport(row.locationId);
    if (transportState.transport === "web_bridge" && !transportState.webBridgeConfigured) {
        throw new Error("WhatsApp Web Bridge is selected but not connected.");
    }
    if (!transportState.cloudConfigured && !transportState.webBridgeConfigured) {
        throw new Error("WhatsApp is not connected.");
    }
    if (transportState.transport === "cloud_api" && !hasOpenWhatsAppCustomerServiceWindow((resolved.contact as any).whatsappCustomerServiceExpiresAt || null)) {
        throw new Error("This WhatsApp conversation is outside the 24-hour customer service window. Send an approved template instead.");
    }

    const result = await enqueueWhatsAppOutbound({
        locationId: row.locationId,
        conversationInternalId: resolved.conversation.id,
        conversationGhlId: resolved.conversation.id,
        contactId: resolved.contact.id,
        body: row.body,
        kind: "text",
        source: "scheduled_message",
        transport: transportState.transport,
        clientMessageId: `scheduled_${row.id}_${randomUUID()}`,
    });

    return result.messageId;
}

async function dispatchSmsRelayScheduledMessage(row: any) {
    const { sendSmsRelayMessage } = await import("@/lib/sms-relay/send");
    const result = await sendSmsRelayMessage({
        locationId: row.locationId,
        conversationId: row.conversationId,
        contactId: row.contactId,
        messageBody: row.body,
        clientMessageId: `scheduled_${row.id}_${randomUUID()}`,
    });
    if (!result.success) throw new Error(result.error);
    return result.messageId;
}

async function processScheduledMessage(row: any) {
    if (row.channel === "WhatsApp") return dispatchWhatsAppScheduledMessage(row);
    if (row.channel === "SMS_RELAY") return dispatchSmsRelayScheduledMessage(row);
    throw new Error(`Unsupported scheduled message channel: ${row.channel}`);
}

async function finalizeScheduledMessageDispatch(row: any, messageId: string) {
    const sentRow = await (db as any).scheduledMessage.update({
        where: { id: row.id },
        data: {
            status: "sent",
            sentAt: new Date(),
            dispatchedMessageId: messageId,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
        },
    });
    await db.conversation.update({
        where: { id: row.conversationId },
        data: { updatedAt: new Date() },
    }).catch(() => null);
    await publishConversationRealtimeEvent({
        locationId: row.locationId,
        conversationId: row.conversationId,
        type: "scheduled_message.sent",
        payload: { scheduledMessage: serializeScheduledMessage(sentRow), messageId },
    });
    return sentRow;
}

async function finalizeScheduledMessageDispatchFailure(row: any, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await (db as any).scheduledMessage.update({
        where: { id: row.id },
        data: {
            status: "failed",
            failedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: message.slice(0, 2000),
        },
    });
    await publishConversationRealtimeEvent({
        locationId: row.locationId,
        conversationId: row.conversationId,
        type: "scheduled_message.failed",
        payload: { scheduledMessageId: row.id, error: message },
    });
    return message;
}

export async function sendScheduledMessageNow(args: {
    locationId: string;
    id: string;
}) {
    const id = String(args.id || "").trim();
    if (!id) return { success: false as const, error: "Missing scheduled message ID." };

    const row = await (db as any).scheduledMessage.findFirst({
        where: {
            id,
            locationId: args.locationId,
            status: { in: DISPATCHABLE_STATUSES },
        },
    });
    if (!row) return { success: false as const, error: "Scheduled message not found or already closed." };

    const workerId = `scheduled-message-now:${randomUUID()}`;
    const claim = await (db as any).scheduledMessage.updateMany({
        where: {
            id,
            locationId: args.locationId,
            status: { in: DISPATCHABLE_STATUSES },
        },
        data: {
            status: "sending",
            lockedAt: new Date(),
            lockedBy: workerId,
            attemptCount: Number(row.attemptCount || 0) + 1,
            lastError: null,
        },
    });
    if (!Number(claim?.count || 0)) {
        return { success: false as const, error: "Scheduled message is already being processed." };
    }

    try {
        const messageId = await processScheduledMessage(row);
        const sentRow = await finalizeScheduledMessageDispatch(row, messageId);
        return { success: true as const, scheduledMessage: serializeScheduledMessage(sentRow), messageId };
    } catch (error) {
        const message = await finalizeScheduledMessageDispatchFailure(row, error);
        return { success: false as const, error: message };
    }
}

export async function recoverStaleScheduledMessageLocks(): Promise<number> {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    const result = await (db as any).scheduledMessage.updateMany({
        where: {
            status: "sending",
            lockedAt: { lt: staleBefore },
        },
        data: {
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            lastError: "Recovered stale scheduled message lock.",
        },
    });
    return Number(result?.count || 0);
}

export async function dispatchDueScheduledMessages(args?: {
    locationId?: string | null;
    limit?: number;
}) {
    const recoveredLocks = await recoverStaleScheduledMessageLocks();
    const now = new Date();
    const workerId = `scheduled-message:${randomUUID()}`;
    const rows = await (db as any).scheduledMessage.findMany({
        where: {
            ...(args?.locationId ? { locationId: args.locationId } : {}),
            status: { in: DISPATCHABLE_STATUSES },
            scheduledFor: { lte: now },
            attemptCount: { lt: MAX_ATTEMPTS },
        },
        orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
        take: Math.max(1, Math.min(Number(args?.limit || 100), 300)),
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
        const claim = await (db as any).scheduledMessage.updateMany({
            where: {
                id: row.id,
                status: { in: DISPATCHABLE_STATUSES },
                scheduledFor: { lte: now },
            },
            data: {
                status: "sending",
                lockedAt: new Date(),
                lockedBy: workerId,
                attemptCount: Number(row.attemptCount || 0) + 1,
                lastError: null,
            },
        });
        if (!Number(claim?.count || 0)) {
            skipped += 1;
            continue;
        }

        try {
            const messageId = await processScheduledMessage(row);
            await finalizeScheduledMessageDispatch(row, messageId);
            sent += 1;
        } catch (error) {
            await finalizeScheduledMessageDispatchFailure(row, error);
            failed += 1;
        }
    }

    return {
        recoveredLocks,
        dueCount: rows.length,
        sent,
        failed,
        skipped,
    };
}
