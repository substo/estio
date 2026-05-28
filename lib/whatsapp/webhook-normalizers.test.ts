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
import { extractReliableWebBridgePhone } from "@/lib/whatsapp/web-bridge-identity";

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

test("normalizeWhatsAppWebBridgeMessage uses resolved inbound LID phone instead of connected account phone", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: {
            phone: "353870972075",
            lid: "160099217719497@lid",
            displayName: "Nicolas White Lead Sale DT4771 Studio Kato Paphos",
            source: "web_bridge_contact_metadata",
        },
        message: {
            fromMe: false,
            from: "160099217719497@lid",
            to: "35794006663@c.us",
            id: "false_160099217719497@lid_AC4BE1E8A90672975B9563D2721AC3AE",
            body: "Hi Martin! Thanks for your message",
            type: "chat",
            timestamp: 1779972548,
            contactIdentity: {
                rawChatId: "160099217719497@lid",
                remoteJid: "160099217719497@lid",
                lidJid: "160099217719497@lid",
                phoneJid: "353870972075@c.us",
                displayName: "Nicolas White Lead Sale DT4771 Studio Kato Paphos",
            },
        },
    });

    assert.equal(result.normalized?.from, "353870972075");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.resolvedPhone, "353870972075");
    assert.equal(result.normalized?.lid, "160099217719497@lid");
    assert.equal(result.normalized?.contactName, "Nicolas White Lead Sale DT4771 Studio Kato Paphos");
});

test("normalizeWhatsAppWebBridgeMessage does not trust stale identity-map phone for inbound LID-only messages", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: {
            phone: "35794006663",
            lid: "160099217719497@lid",
            displayName: "Stale Martin Mapping",
            source: "identity_map",
        },
        message: {
            fromMe: false,
            from: "160099217719497@lid",
            to: "35794006663@c.us",
            id: "false_160099217719497@lid_A2",
            body: "Inbound LID only",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.from, "160099217719497@lid");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.resolvedPhone, undefined);
    assert.equal(result.normalized?.lid, "160099217719497@lid");
});

test("normalizeWhatsAppWebBridgeMessage rejects connected account phone as inbound contact identity", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: {
            phone: "35794006663",
            lid: "160099217719497@lid",
            displayName: "Business Account",
            source: "web_bridge_contact_metadata",
        },
        message: {
            fromMe: false,
            from: "160099217719497@lid",
            to: "35794006663@c.us",
            id: "false_160099217719497@lid_A3",
            body: "Inbound reports business phone",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.from, "160099217719497@lid");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.resolvedPhone, undefined);
});

test("normalizeWhatsAppWebBridgeMessage uses participant identity for inbound group messages", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: { phone: "353870972075", displayName: "Nick" },
        message: {
            fromMe: false,
            from: "120363310624402447@g.us",
            to: "35794006663@c.us",
            participant: "353870972075@s.whatsapp.net",
            id: "false_120363310624402447@g.us_A1_353870972075@s.whatsapp.net",
            body: "Group reply",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.from, "353870972075");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.isGroup, true);
    assert.equal(result.normalized?.remoteJid, "120363310624402447@g.us");
    assert.equal(result.normalized?.chatId, "120363310624402447@g.us");
    assert.equal(result.normalized?.participantJid, "353870972075@s.whatsapp.net");
    assert.equal(result.normalized?.participantPhoneJid, "353870972075@s.whatsapp.net");
});

test("normalizeWhatsAppWebBridgeMessage keeps outbound contact as recipient, not connected account", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: { phone: "353870972075", displayName: "Nicolas" },
        message: {
            fromMe: true,
            from: "35794006663@c.us",
            to: "353870972075@c.us",
            id: "true_353870972075@c.us_A1",
            body: "Outbound hello",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.direction, "outbound");
    assert.equal(result.normalized?.from, "35794006663");
    assert.equal(result.normalized?.to, "353870972075");
    assert.equal(result.normalized?.resolvedPhone, "353870972075");
    assert.notEqual(result.normalized?.to, "35794006663");
});

test("extractReliableWebBridgePhone prefers phone JID and rejects LID number digits", () => {
    const identity = {
        lidJid: "258699151036638@lid",
        number: "258699151036638",
        phoneJid: "35794475454@c.us",
    };

    assert.equal(extractReliableWebBridgePhone(identity, "258699151036638@lid"), "35794475454");
});
