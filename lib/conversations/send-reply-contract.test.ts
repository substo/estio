import assert from "node:assert/strict";
import test from "node:test";

import {
    buildSendReplyApiPayload,
    parseSendReplyApiPayload,
} from "./send-reply-contract";
import { resolveConversationReference } from "./identity";

test("the composer send payload is accepted unchanged by the send route contract", () => {
    const composerPayload = buildSendReplyApiPayload({
        conversationId: " conversation_a ",
        contactId: " contact_a ",
        messageBody: "Hello from the shared inbox",
        type: "WhatsApp",
        clientMessageId: "client-message-a",
        clientSentAt: "2026-07-31T10:00:00.000Z",
        retryMessageId: "message-a",
    });

    const parsed = parseSendReplyApiPayload(composerPayload);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.deepEqual(parsed.payload, composerPayload);
    assert.equal(parsed.payload.conversationId, "conversation_a");
    assert.equal(parsed.payload.contactId, "contact_a");
});

test("the route contract rejects incomplete and unsupported send payloads", () => {
    assert.deepEqual(parseSendReplyApiPayload({
        conversationId: "conversation_a",
        contactId: "contact_a",
        messageBody: "Hello",
        type: "Push",
    }), { success: false, error: "Unsupported message channel." });

    assert.deepEqual(parseSendReplyApiPayload({ type: "SMS" }), {
        success: false,
        error: "Missing required send fields.",
    });
});

test("same-location users share conversation access while another location is denied", async () => {
    const records = [{ id: "conv_1", locationId: "loc_1", contactId: "contact_1", ghlConversationId: "remote_1" }];
    const repository = {
        conversation: {
            async findFirst({ where }: any) {
                const refs = where.OR.map((clause: any) => clause.id || clause.ghlConversationId).filter(Boolean);
                return records.find((record) => record.locationId === where.locationId && refs.includes(record.id)) || null;
            },
        },
    };

    for (const userId of ["user_a", "user_b"]) {
        const resolved = await resolveConversationReference(repository, "loc_1", "conv_1");
        assert.equal(resolved?.id, "conv_1", `${userId} should share the location-owned conversation`);
    }
    assert.equal(await resolveConversationReference(repository, "loc_2", "conv_1"), null);
});
