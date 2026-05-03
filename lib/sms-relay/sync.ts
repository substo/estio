/**
 * lib/sms-relay/sync.ts
 *
 * Inbound SMS processor — mirrors the WhatsApp processNormalizedMessage pattern.
 * Called by the gateway /inbound route when the Android device forwards a
 * received SMS to Estio.
 *
 * Flow:
 *   1. Deduplication by (locationId, deviceId, fromNumber, body hash, approx timestamp)
 *   2. Contact upsert (search by phone → create Lead if not found)
 *   3. Conversation upsert (one per contact per location)
 *   4. Message insert (type=SMS_RELAY, direction=inbound)
 *   5. Update Conversation.lastMessage* + unreadCount
 *   6. Publish SSE realtime event
 */

import crypto from "crypto";
import db from "@/lib/db";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SmsRelayInboundPayload = {
    /** Internal Estio location id */
    locationId: string;
    /** ID of the SmsRelayDevice that received the SMS */
    deviceId: string;
    /** Sender's phone number (E.164 preferred, e.g. +35799123456) */
    from: string;
    /** The Android device SIM phone number (our "to") */
    to: string;
    /** SMS body text */
    body: string;
    /** Timestamp the SMS was received on the device */
    receivedAt: Date;
    /** Optional sender display name from Android Contacts */
    contactName?: string | null;
};

export type SmsRelayInboundResult =
    | { status: "created"; messageId: string; conversationId: string }
    | { status: "duplicate"; messageId: string }
    | { status: "error"; reason: string };

// ---------------------------------------------------------------------------
// Deduplication hash
// ---------------------------------------------------------------------------

function buildInboundDedupeKey(payload: SmsRelayInboundPayload): string {
    // Round timestamp to nearest 10s to tolerate minor clock skew
    const roundedTs = Math.floor(payload.receivedAt.getTime() / 10_000) * 10_000;
    const raw = `${payload.locationId}:${payload.deviceId}:${payload.from}:${roundedTs}:${payload.body}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processSmsRelayInbound(
    payload: SmsRelayInboundPayload
): Promise<SmsRelayInboundResult> {
    const { locationId, deviceId, from, body, receivedAt, contactName } = payload;

    console.log(`[SmsRelay Sync] Inbound from ${from} on device ${deviceId}`);

    // 1. Load location
    const location = await db.location.findUnique({
        where: { id: locationId },
        select: { id: true, ghlLocationId: true, ghlAccessToken: true },
    });
    if (!location) {
        return { status: "error", reason: "location_not_found" };
    }

    // 2. Deduplication check — use clientMessageId as the dedupe key
    const dedupeKey = buildInboundDedupeKey(payload);
    const existingMsg = await (db as any).message.findFirst({
        where: { clientMessageId: `smsrelay:${dedupeKey}` },
        select: { id: true },
    });
    if (existingMsg) {
        console.log(`[SmsRelay Sync] Skipped duplicate inbound message (${dedupeKey})`);
        return { status: "duplicate", messageId: String(existingMsg.id) };
    }

    // 3. Normalize phone
    const rawFrom = from.replace(/\D/g, "");
    const normalizedFrom = rawFrom.startsWith("+") ? from : `+${rawFrom}`;
    const searchSuffix = rawFrom.length > 7 ? rawFrom.slice(-7) : rawFrom;

    // 4. Find or create contact
    let contact = await db.contact.findFirst({
        where: {
            locationId,
            phone: { contains: searchSuffix },
        },
    });

    let isNewContact = false;
    if (!contact) {
        isNewContact = true;
        const displayName = contactName || `SMS ${normalizedFrom}`;

        // Optional: check GHL for existing contact
        let ghlContactId: string | undefined;
        if (location.ghlLocationId && location.ghlAccessToken) {
            try {
                const { ghlFetch } = await import("@/lib/ghl/client");
                const searchRes = await ghlFetch<{ contacts: any[] }>(
                    `/contacts/?locationId=${location.ghlLocationId}&query=${rawFrom}`,
                    location.ghlAccessToken
                );
                const match = (searchRes.contacts || []).find((c: any) => {
                    const cPhone = c.phone?.replace(/\D/g, "");
                    return cPhone && (cPhone === rawFrom || cPhone.endsWith(rawFrom.slice(-9)));
                });
                if (match) {
                    ghlContactId = match.id;
                }
            } catch (err) {
                console.warn("[SmsRelay Sync] GHL contact lookup failed:", err);
            }
        }

        contact = await db.contact.create({
            data: {
                locationId,
                name: displayName,
                firstName: contactName?.split(" ")[0] || undefined,
                lastName: contactName?.split(" ").slice(1).join(" ") || undefined,
                phone: normalizedFrom,
                status: "active",
                contactType: "Lead",
                leadStage: "Unassigned",
                leadSource: "SMS Relay",
                ...(ghlContactId ? { ghlContactId } : {}),
            },
        });

        console.log(`[SmsRelay Sync] Created new contact ${contact.id} for ${normalizedFrom}`);
    }

    // 5. Find or create conversation (one per contact per location)
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
                lastMessageAt: receivedAt,
                lastMessageType: "SMS_RELAY",
                unreadCount: 1,
            },
        });
        console.log(`[SmsRelay Sync] Created new conversation ${conversation.id}`);
    } else {
        // Update conversation metadata
        await db.conversation.update({
            where: { id: conversation.id },
            data: {
                lastMessageBody: body,
                lastMessageAt: receivedAt,
                lastMessageType: "SMS_RELAY",
                unreadCount: { increment: 1 },
                status: "open",
            },
        });
    }

    // 6. Insert message
    const message = await db.message.create({
        data: {
            conversationId: conversation.id,
            clientMessageId: `smsrelay:${dedupeKey}`,
            type: "SMS_RELAY",
            direction: "inbound",
            status: "delivered",
            body,
            source: "sms_relay",
            createdAt: receivedAt,
            updatedAt: new Date(),
        },
    });

    console.log(
        `[SmsRelay Sync] Created inbound message ${message.id} in conversation ${conversation.id}`
    );

    // 7. Publish realtime SSE event
    void publishConversationRealtimeEvent({
        locationId,
        conversationId: conversation.id,
        type: "message.inbound",
        payload: {
            channel: "sms_relay",
            messageId: message.id,
            conversationId: conversation.id,
            contactId: contact.id,
            from: normalizedFrom,
            body,
            receivedAt: receivedAt.toISOString(),
            isNewContact,
            deviceId,
        },
    }).catch((err) =>
        console.warn("[SmsRelay Sync] Failed to publish realtime event:", err)
    );

    return {
        status: "created",
        messageId: String(message.id),
        conversationId: String(conversation.id),
    };
}
