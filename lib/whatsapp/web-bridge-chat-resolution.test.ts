import assert from "node:assert/strict";
import test from "node:test";

import {
    selectMostRecentWhatsAppWebBridgeChat,
    sortWhatsAppWebBridgeChatsByMostRecent,
} from "./web-bridge-chat-resolution";

test("sorts WhatsApp chats by recent activity without mutating the inventory", () => {
    const chats = [
        { id: "old", timestamp: 100 },
        { id: "current", t: 300 },
        { id: "middle", timestamp: 200 },
    ];

    assert.deepEqual(sortWhatsAppWebBridgeChatsByMostRecent(chats).map((chat) => chat.id), ["current", "middle", "old"]);
    assert.deepEqual(chats.map((chat) => chat.id), ["old", "current", "middle"]);
});

test("selects the most recently active matching WhatsApp chat", () => {
    const selected = selectMostRecentWhatsAppWebBridgeChat([
        { chatId: "old@lid", timestamp: 100, contactIdentity: { source: "old" } },
        { chatId: "current@lid", timestamp: 300, contactIdentity: { source: "current" } },
        { chatId: "middle@lid", timestamp: 200, contactIdentity: { source: "middle" } },
    ]);

    assert.equal(selected?.chatId, "current@lid");
    assert.deepEqual(selected?.contactIdentity, { source: "current" });
});

test("keeps the first matching chat when activity timestamps tie", () => {
    const selected = selectMostRecentWhatsAppWebBridgeChat([
        { chatId: "first@lid", timestamp: null },
        { chatId: "second@lid", timestamp: Number.NaN },
    ]);

    assert.equal(selected?.chatId, "first@lid");
    assert.equal(selected?.timestamp, 0);
});

test("ignores empty chat identifiers", () => {
    assert.equal(selectMostRecentWhatsAppWebBridgeChat([
        { chatId: "", timestamp: 500 },
        { chatId: "valid@c.us", timestamp: 100 },
    ])?.chatId, "valid@c.us");
});
