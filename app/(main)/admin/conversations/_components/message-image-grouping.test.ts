import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@/lib/ghl/conversations";
import { groupAdjacentWhatsAppImageMessages } from "./message-image-grouping";

function imageMessage(overrides: Partial<Message> = {}): Message {
    const id = overrides.id || "msg_1";
    return {
        id,
        conversationId: "conv_1",
        contactId: "contact_1",
        body: "",
        source: "whatsapp_web_bridge",
        type: "TYPE_WHATSAPP",
        direction: "inbound",
        status: "delivered",
        dateAdded: "2026-06-05T10:00:00.000Z",
        attachments: [{
            id: `att_${id}`,
            url: `https://example.test/${id}.jpg`,
            mimeType: "image/jpeg",
            fileName: `${id}.jpg`,
        }],
        ...overrides,
    };
}

function messageItem(message: Message) {
    return { kind: "message" as const, message };
}

test("groups adjacent image-only WhatsApp messages from the same direction and source", () => {
    const first = imageMessage({ id: "msg_1" });
    const second = imageMessage({ id: "msg_2", dateAdded: "2026-06-05T10:00:45.000Z" });

    const result = groupAdjacentWhatsAppImageMessages([messageItem(first), messageItem(second)]);

    assert.equal(result.length, 1);
    assert.equal(result[0].kind, "image-group");
    if (result[0].kind === "image-group") {
        assert.deepEqual(result[0].group.messages.map((message) => message.id), ["msg_1", "msg_2"]);
    }
});

test("keeps a single image message as a normal message", () => {
    const first = imageMessage({ id: "msg_1" });

    const result = groupAdjacentWhatsAppImageMessages([messageItem(first)]);

    assert.deepEqual(result, [messageItem(first)]);
});

test("does not group image messages with captions", () => {
    const first = imageMessage({ id: "msg_1", body: "Kitchen view" });
    const second = imageMessage({ id: "msg_2", dateAdded: "2026-06-05T10:00:30.000Z" });

    const result = groupAdjacentWhatsAppImageMessages([messageItem(first), messageItem(second)]);

    assert.equal(result.length, 2);
    assert.equal(result[0].kind, "message");
    assert.equal(result[1].kind, "message");
});

test("activity events break image groups", () => {
    const first = imageMessage({ id: "msg_1" });
    const second = imageMessage({ id: "msg_2", dateAdded: "2026-06-05T10:00:30.000Z" });
    const activity = { id: "activity_1" };

    const result = groupAdjacentWhatsAppImageMessages([
        messageItem(first),
        { kind: "activity" as const, activity },
        messageItem(second),
    ]);

    assert.equal(result.length, 3);
    assert.equal(result[0].kind, "message");
    assert.equal(result[1].kind, "activity");
    assert.equal(result[2].kind, "message");
});

test("does not group image messages outside the time window", () => {
    const first = imageMessage({ id: "msg_1" });
    const second = imageMessage({ id: "msg_2", dateAdded: "2026-06-05T10:02:00.000Z" });

    const result = groupAdjacentWhatsAppImageMessages([messageItem(first), messageItem(second)]);

    assert.equal(result.length, 2);
    assert.equal(result[0].kind, "message");
    assert.equal(result[1].kind, "message");
});

test("does not group different directions or sources", () => {
    const first = imageMessage({ id: "msg_1" });
    const outbound = imageMessage({ id: "msg_2", direction: "outbound", dateAdded: "2026-06-05T10:00:30.000Z" });
    const native = imageMessage({ id: "msg_3", source: "whatsapp_native", dateAdded: "2026-06-05T10:01:00.000Z" });

    const result = groupAdjacentWhatsAppImageMessages([
        messageItem(first),
        messageItem(outbound),
        messageItem(native),
    ]);

    assert.equal(result.length, 3);
    assert.equal(result[0].kind, "message");
    assert.equal(result[1].kind, "message");
    assert.equal(result[2].kind, "message");
});
