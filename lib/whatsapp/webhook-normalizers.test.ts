import test from "node:test";
import assert from "node:assert/strict";
import {
    getWhatsAppCloudInboundBody,
    normalizeWhatsAppCloudInboundMessage,
    normalizeWhatsAppCloudInboundType,
    normalizeWhatsAppWebBridgeAckStatus,
    normalizeWhatsAppWebBridgeMessage,
    parseWhatsAppWebhookTimestamp,
} from "@/lib/whatsapp/webhook-normalizers";

test("getWhatsAppCloudInboundBody preserves provider-specific fallbacks", () => {
    assert.equal(getWhatsAppCloudInboundBody({ type: "text", text: { body: "hello" } }), "hello");
    assert.equal(getWhatsAppCloudInboundBody({ type: "image", image: {} }), "[Image]");
    assert.equal(getWhatsAppCloudInboundBody({ type: "document", document: { filename: "lease.pdf" } }), "lease.pdf");
    assert.equal(getWhatsAppCloudInboundBody({ type: "interactive", interactive: { list_reply: { title: "Yes" } } }), "Yes");
    assert.equal(getWhatsAppCloudInboundBody({ type: "contacts" }), "[Contact]");
    assert.equal(getWhatsAppCloudInboundBody({ type: "custom" }), "[custom]");
});

test("normalizeWhatsAppCloudInboundType keeps existing vocabulary", () => {
    assert.equal(normalizeWhatsAppCloudInboundType("text"), "text");
    assert.equal(normalizeWhatsAppCloudInboundType("contacts"), "contact");
    assert.equal(normalizeWhatsAppCloudInboundType("button"), "other");
});

test("parseWhatsAppWebhookTimestamp handles seconds and fallback dates", () => {
    assert.equal(parseWhatsAppWebhookTimestamp("1710000000").toISOString(), "2024-03-09T16:00:00.000Z");
    assert.ok(parseWhatsAppWebhookTimestamp(undefined) instanceof Date);
});

test("normalizeWhatsAppCloudInboundMessage builds a sync message", () => {
    const normalized = normalizeWhatsAppCloudInboundMessage({
        locationId: "loc_1",
        phoneNumberId: "12345",
        contacts: [{ wa_id: "357999", profile: { name: "Ana" } }],
        message: {
            from: "357999",
            id: "wam_1",
            type: "text",
            text: { body: "Hi" },
            timestamp: "1710000000",
        },
    });

    assert.equal(normalized?.locationId, "loc_1");
    assert.equal(normalized?.from, "357999");
    assert.equal(normalized?.to, "12345");
    assert.equal(normalized?.type, "text");
    assert.equal(normalized?.body, "Hi");
    assert.equal(normalized?.wamId, "wam_1");
    assert.equal(normalized?.contactName, "Ana");
    assert.equal(normalized?.source, "whatsapp_native");
    assert.equal(normalized?.direction, "inbound");
});

test("normalizeWhatsAppWebBridgeAckStatus maps bridge ack values", () => {
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(3), "READ");
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(2), "DELIVERED");
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(1), "SERVER_ACK");
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(-1), "FAILED");
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(0), "");
});

test("normalizeWhatsAppWebBridgeMessage preserves Web Bridge normalized fields", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35725000000@c.us",
        resolvedIdentity: { phone: "35799111111", displayName: "Mia" },
        message: {
            fromMe: false,
            from: "35799111111@c.us",
            to: "35725000000@c.us",
            id: "wam_web_1",
            body: "Hello",
            type: "chat",
            timestamp: 1710000000,
            contactIdentity: { source: "worker" },
        },
    });

    assert.equal(result.wamId, "wam_web_1");
    assert.equal(result.normalized?.from, "35799111111");
    assert.equal(result.normalized?.to, "35725000000");
    assert.equal(result.normalized?.body, "Hello");
    assert.equal(result.normalized?.direction, "inbound");
    assert.equal(result.normalized?.source, "whatsapp_web_bridge");
    assert.equal(result.normalized?.contactName, "Mia");
    assert.equal(result.normalized?.remoteJid, "35799111111@c.us");
    assert.equal(result.normalized?.chatId, "35799111111@c.us");
});
