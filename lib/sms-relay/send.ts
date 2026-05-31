import { createHash } from "crypto";

import db from "@/lib/db";
import { updateConversationLastMessage } from "@/lib/conversations/update";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { enqueueSmsRelayOutbox } from "@/lib/sms-relay/outbox";
import { enqueueSmsRelayOutboxQueueJob } from "@/lib/queue/sms-relay-outbox";
import { resolveSmsRelayAvailabilityForLocation } from "@/lib/sms-relay/availability";

type SmsRelaySendResult =
    | {
        success: true;
        messageId: string;
        outboxId: string;
        deviceId: string;
        queued: true;
        queueAccepted: boolean;
        warning?: string;
        errorCode?: string;
    }
    | {
        success: false;
        error: string;
        errorCode: string;
    };

function logSmsRelaySend(event: string, payload: Record<string, unknown>) {
    console.log(`[SmsRelaySend] ${event}`, JSON.stringify(payload));
}

function normalizePhoneSuffix(phone: string): string {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits.length > 7 ? digits.slice(-7) : digits;
}

export async function sendSmsRelayMessage(args: {
    locationId: string;
    conversationId: string;
    contactId: string;
    messageBody: string;
    clientMessageId?: string | null;
}): Promise<SmsRelaySendResult> {
    const locationId = String(args.locationId || "").trim();
    const conversationId = String(args.conversationId || "").trim();
    const contactId = String(args.contactId || "").trim();
    const normalizedBody = String(args.messageBody || "").trim();

    if (!locationId) return { success: false, error: "Missing location.", errorCode: "missing_location" };
    if (!conversationId) return { success: false, error: "Missing conversation.", errorCode: "missing_conversation" };
    if (!contactId) return { success: false, error: "Missing contact.", errorCode: "missing_contact" };
    if (!normalizedBody) return { success: false, error: "Message body cannot be empty.", errorCode: "empty_body" };

    const location = await db.location.findUnique({
        where: { id: locationId },
        select: { id: true, smsRelayEnabled: true },
    });
    if (!location) {
        return {
            success: false,
            error: "Location not found.",
            errorCode: "missing_location",
        };
    }

    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(locationId, conversationId),
        select: { id: true, locationId: true, contactId: true },
    });
    if (!conversation || conversation.locationId !== locationId) {
        return { success: false, error: "Conversation not found.", errorCode: "conversation_not_found" };
    }

    const contact = await db.contact.findFirst({
        where: {
            OR: [
                { ghlContactId: contactId },
                { id: contactId },
            ],
            locationId,
        },
        select: { id: true, phone: true, name: true },
    });
    if (!contact) return { success: false, error: "Contact not found.", errorCode: "contact_not_found" };
    if (conversation.contactId !== contact.id) {
        return { success: false, error: "Conversation/contact mismatch.", errorCode: "contact_mismatch" };
    }
    if (!contact.phone) {
        return { success: false, error: "Contact does not have a phone number.", errorCode: "missing_phone" };
    }

    const relayAvailability = await resolveSmsRelayAvailabilityForLocation({
        locationId,
        smsRelayEnabled: location.smsRelayEnabled,
        contactPhone: contact.phone,
    });
    if (!relayAvailability.available) {
        return {
            success: false,
            error: relayAvailability.label || "Android SMS is unavailable.",
            errorCode: relayAvailability.reason || "sms_relay_unavailable",
        };
    }

    const deviceId = relayAvailability.deviceId;
    if (!deviceId) {
        return { success: false, error: "No paired SIM Relay device found.", errorCode: "sms_relay_not_paired" };
    }

    const localMessage = await db.message.create({
        data: {
            conversationId: conversation.id,
            clientMessageId: args.clientMessageId || undefined,
            body: normalizedBody,
            type: "TYPE_SMS",
            direction: "outbound",
            status: "pending",
            source: "sms_relay",
            createdAt: new Date(),
        },
    });

    await updateConversationLastMessage({
        conversationId: conversation.id,
        messageBody: normalizedBody,
        messageType: "TYPE_SMS",
        messageDate: new Date(),
        direction: "outbound",
    });

    const outboxRow = await enqueueSmsRelayOutbox({
        locationId,
        conversationId: conversation.id,
        messageId: localMessage.id,
        deviceId,
        toNumber: contact.phone,
        body: normalizedBody,
    });

    let queueAccepted = true;
    let warning: string | undefined;
    let errorCode: string | undefined;
    try {
        const queueResult = await enqueueSmsRelayOutboxQueueJob({ outboxId: outboxRow.id });
        queueAccepted = queueResult.accepted;
        if (!queueAccepted) {
            warning = "Message was saved but could not be handed to the relay queue immediately.";
            errorCode = queueResult.reason || "queue_not_accepted";
        }
    } catch (error: any) {
        queueAccepted = false;
        warning = "Message was saved but the relay queue was not available. The sweeper can retry it.";
        errorCode = "queue_enqueue_failed";
        console.error("[SmsRelaySend] Queue enqueue failed", {
            locationId,
            conversationId: conversation.id,
            contactId: contact.id,
            deviceId,
            messageId: localMessage.id,
            outboxId: outboxRow.id,
            error: error?.message || String(error),
        });
    }

    void publishConversationRealtimeEvent({
        locationId,
        conversationId: conversation.id,
        type: "message.outbound",
        payload: {
            channel: "sms_relay",
            messageId: localMessage.id,
            conversationId: conversation.id,
            contactId: contact.id,
            deviceId,
            outboxId: outboxRow.id,
            queueAccepted,
        },
    });

    logSmsRelaySend("queued", {
        locationId,
        conversationId: conversation.id,
        contactId: contact.id,
            deviceId,
        messageId: localMessage.id,
        outboxId: outboxRow.id,
        queueAccepted,
    });

    return {
        success: true,
        messageId: localMessage.id,
        outboxId: outboxRow.id,
        deviceId,
        queued: true,
        queueAccepted,
        warning,
        errorCode,
    };
}

export async function processSmsRelayManualOutbound(args: {
    locationId: string;
    deviceId: string;
    to: string;
    body: string;
    sentAt: Date;
}) {
    const locationId = String(args.locationId || "").trim();
    const deviceId = String(args.deviceId || "").trim();
    const rawTo = String(args.to || "").trim();
    const body = String(args.body || "").trim();
    const sentAt = args.sentAt instanceof Date && !Number.isNaN(args.sentAt.getTime())
        ? args.sentAt
        : new Date();

    if (!locationId || !deviceId) return { status: "error", reason: "missing_device_context" };
    if (!rawTo || !body) return { status: "error", reason: "missing_to_or_body" };

    const toDigits = rawTo.replace(/\D/g, "");
    const normalizedTo = rawTo.startsWith("+") ? rawTo : `+${toDigits}`;
    const searchSuffix = normalizePhoneSuffix(rawTo);
    const timestampBucket = Math.floor(sentAt.getTime() / 30_000);
    const dedupeHash = createHash("sha256")
        .update([deviceId, normalizedTo, body, timestampBucket].join("|"))
        .digest("hex")
        .slice(0, 32);
    const clientMessageId = `smsrelay-manual:${dedupeHash}`;

    const existing = await db.message.findFirst({
        where: { clientMessageId },
        select: { id: true },
    });
    if (existing) return { status: "duplicate", messageId: existing.id };

    let contact = await db.contact.findFirst({
        where: {
            locationId,
            phone: { contains: searchSuffix },
        },
    });
    let isNewContact = false;
    if (!contact) {
        isNewContact = true;
        contact = await db.contact.create({
            data: {
                locationId,
                name: `SMS ${normalizedTo}`,
                phone: normalizedTo,
                status: "active",
                contactType: "Lead",
                leadStage: "Unassigned",
                leadSource: "SIM Relay manual SMS",
            },
        });
    }

    let conversation = await db.conversation.findUnique({
        where: {
            locationId_contactId: { locationId, contactId: contact.id },
        },
    });
    if (!conversation) {
        conversation = await db.conversation.create({
            data: {
                locationId,
                contactId: contact.id,
                status: "open",
                lastMessageBody: body,
                lastMessageAt: sentAt,
                lastMessageType: "TYPE_SMS",
                unreadCount: 0,
            },
        });
    } else {
        await updateConversationLastMessage({
            conversationId: conversation.id,
            messageBody: body,
            messageType: "TYPE_SMS",
            messageDate: sentAt,
            direction: "outbound",
        });
    }

    const message = await db.message.create({
        data: {
            conversationId: conversation.id,
            clientMessageId,
            type: "TYPE_SMS",
            direction: "outbound",
            status: "sent",
            body,
            source: "sms_relay_manual",
            createdAt: sentAt,
            updatedAt: new Date(),
        },
    });

    void publishConversationRealtimeEvent({
        locationId,
        conversationId: conversation.id,
        type: "message.outbound",
        payload: {
            channel: "sms_relay",
            mode: "manual_phone_sms",
            messageId: message.id,
            conversationId: conversation.id,
            contactId: contact.id,
            to: normalizedTo,
            body,
            sentAt: sentAt.toISOString(),
            isNewContact,
            deviceId,
        },
    });

    console.log("[SmsRelayManualOutbound] mirrored", JSON.stringify({
        locationId,
        conversationId: conversation.id,
        contactId: contact.id,
        deviceId,
        messageId: message.id,
    }));

    return { status: "created", messageId: message.id, conversationId: conversation.id };
}
