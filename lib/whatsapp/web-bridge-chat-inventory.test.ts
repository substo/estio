import assert from "node:assert/strict";
import test from "node:test";

import {
    buildLightweightWhatsAppWebBridgeChat,
    buildWhatsAppWebBridgeHistoryChatCandidates,
    WHATSAPP_WEB_BRIDGE_CHAT_LIST_TIMEOUT_MS,
    WHATSAPP_WEB_BRIDGE_HISTORY_TIMEOUT_MS,
} from "./web-bridge-chat-inventory";

test("builds a lightweight LID chat without a provider identity lookup", () => {
    const chat = buildLightweightWhatsAppWebBridgeChat({
        id: { _serialized: "123456789@lid" },
        name: "Customer",
        timestamp: 1_752_000_000,
    });

    assert.equal(chat.id, "123456789@lid");
    assert.equal(chat.contactIdentity.lidJid, "123456789@lid");
    assert.equal(chat.contactIdentity.phoneJid, null);
    assert.equal(chat.contactIdentity.source, "lightweight_chat_inventory");
});

test("builds a lightweight phone chat with a normalized phone identity", () => {
    const chat = buildLightweightWhatsAppWebBridgeChat({ id: "35799111222@s.whatsapp.net" });

    assert.equal(chat.id, "35799111222@s.whatsapp.net");
    assert.equal(chat.contactIdentity.phone, "35799111222");
    assert.equal(chat.contactIdentity.phoneJid, "35799111222@s.whatsapp.net");
});

test("history candidates preserve distinct LID and phone aliases and remove duplicates", () => {
    assert.deepEqual(buildWhatsAppWebBridgeHistoryChatCandidates({
        providerConversationId: "123@lid",
        contactLid: "123@lid",
        resolvedChatId: "35799111222@c.us",
        contactPhone: "+357 99 111 222",
    }), ["123@lid", "35799111222@c.us"]);
});

test("client timeouts exceed the bridge operation limit without becoming unbounded", () => {
    assert.equal(WHATSAPP_WEB_BRIDGE_CHAT_LIST_TIMEOUT_MS, 35_000);
    assert.equal(WHATSAPP_WEB_BRIDGE_HISTORY_TIMEOUT_MS, 35_000);
});
