import assert from "node:assert/strict";
import test from "node:test";

import {
    collapseWebBridgeProviderIdAliasesForDisplay,
    hideDuplicateScheduledWebBridgeEchoesForDisplay,
    hideSupersededFailedWhatsAppAttemptsForDisplay,
} from "./message-loading";

test("collapseWebBridgeProviderIdAliasesForDisplay keeps one canonical bubble for local and serialized ids", () => {
    const createdAt = new Date("2026-07-21T10:21:34.000Z");
    const localId = "3EB0LOCALMESSAGEID";
    const local = {
        id: "local-row",
        conversationId: "conversation-1",
        body: "Ok",
        direction: "outbound",
        source: "whatsapp_web_bridge",
        status: "read",
        wamId: localId,
        createdAt,
        attachments: [],
    };
    const canonical = {
        id: "canonical-row",
        conversationId: "conversation-1",
        body: "Ok",
        direction: "outbound",
        source: "whatsapp_web_bridge",
        status: "sent",
        wamId: `true_198247318593740@lid_${localId}`,
        createdAt,
        attachments: [],
    };

    assert.deepEqual(collapseWebBridgeProviderIdAliasesForDisplay([local, canonical]), [{
        ...canonical,
        status: "read",
    }]);
});

test("collapseWebBridgeProviderIdAliasesForDisplay preserves genuine repeated sends", () => {
    const base = {
        conversationId: "conversation-1",
        body: "Ok",
        direction: "outbound",
        source: "whatsapp_web_bridge",
        status: "sent",
        createdAt: new Date("2026-07-21T10:21:34.000Z"),
    };
    const first = { ...base, id: "first", wamId: "true_chat_3EB_FIRST" };
    const second = { ...base, id: "second", wamId: "true_chat_3EB_SECOND" };

    assert.deepEqual(collapseWebBridgeProviderIdAliasesForDisplay([first, second]), [first, second]);
});

test("collapseWebBridgeProviderIdAliasesForDisplay keeps the app row when its mirrored bridge alias arrives later", () => {
    const localId = "3EB0LOCALMESSAGEID";
    const appRow = {
        id: "app-row",
        clientMessageId: "cmid-1",
        conversationId: "conversation-1",
        body: "Recipient-confirmed message",
        type: "WhatsApp",
        direction: "outbound",
        source: "app_user",
        status: "sent",
        wamId: localId,
        createdAt: new Date("2026-07-24T06:17:42.000Z"),
        outboundWhatsAppOutbox: { id: "outbox-1", status: "completed" },
        attachments: [],
    };
    const bridgeMirror = {
        id: "bridge-mirror",
        conversationId: "conversation-1",
        body: "Recipient-confirmed message",
        type: "WhatsApp",
        direction: "outbound",
        source: "whatsapp_web_bridge",
        status: "delivered",
        wamId: `true_43757193965656@lid_${localId}`,
        createdAt: new Date("2026-07-24T06:17:51.000Z"),
        attachments: [],
    };

    assert.deepEqual(collapseWebBridgeProviderIdAliasesForDisplay([appRow, bridgeMirror]), [{
        ...appRow,
        status: "delivered",
    }]);
});

test("collapseWebBridgeProviderIdAliasesForDisplay requires matching outbound bridge context", () => {
    const localId = "3EB0LOCALMESSAGEID";
    const base = {
        conversationId: "conversation-1",
        body: "Ok",
        source: "whatsapp_web_bridge",
        status: "sent",
        createdAt: new Date("2026-07-21T10:21:34.000Z"),
    };
    const inbound = { ...base, id: "inbound", direction: "inbound", wamId: localId };
    const outbound = { ...base, id: "outbound", direction: "outbound", wamId: `false_chat_${localId}` };

    assert.deepEqual(collapseWebBridgeProviderIdAliasesForDisplay([inbound, outbound]), [inbound, outbound]);
});

test("collapseWebBridgeProviderIdAliasesForDisplay collapses inbound provider aliases", () => {
    const createdAt = new Date("2026-07-22T19:32:29.000Z");
    const localId = "AC6169BDDF0CDA06B6ED6282B1E3F246";
    const local = {
        id: "local-inbound-row",
        conversationId: "conversation-1",
        body: "Inbound update",
        direction: "inbound",
        source: "whatsapp_web_bridge",
        status: "received",
        wamId: localId,
        createdAt,
        attachments: [],
    };
    const canonical = {
        ...local,
        id: "canonical-inbound-row",
        status: "read",
        wamId: `false_123456789@lid_${localId}`,
    };

    assert.deepEqual(collapseWebBridgeProviderIdAliasesForDisplay([local, canonical]), [canonical]);
});

test("hideDuplicateScheduledWebBridgeEchoesForDisplay hides unconfirmed scheduled placeholder when confirmed echo exists", () => {
    const scheduled = {
        id: "scheduled-placeholder",
        body: "Here is the option\n\nhttps://example.test/listing/1",
        direction: "outbound",
        source: "scheduled_message",
        status: "delivery_unconfirmed",
        wamId: null,
        createdAt: new Date("2026-07-16T06:57:02.000Z"),
        outboundWhatsAppOutbox: { status: "delivery_unconfirmed" },
    };
    const echo = {
        id: "web-bridge-echo",
        body: "Here is the option\nhttps://example.test/listing/1",
        direction: "outbound",
        source: "whatsapp_web_bridge",
        status: "read",
        wamId: "3EB_TEST",
        createdAt: new Date("2026-07-16T06:57:07.000Z"),
    };

    assert.deepEqual(
        hideDuplicateScheduledWebBridgeEchoesForDisplay([scheduled, echo]).map((message) => message.id),
        ["web-bridge-echo"]
    );
});

test("hideDuplicateScheduledWebBridgeEchoesForDisplay keeps unconfirmed scheduled placeholder without matching echo", () => {
    const scheduled = {
        id: "scheduled-placeholder",
        body: "Here is the option",
        direction: "outbound",
        source: "scheduled_message",
        status: "delivery_unconfirmed",
        wamId: null,
        createdAt: new Date("2026-07-16T06:57:02.000Z"),
        outboundWhatsAppOutbox: { status: "delivery_unconfirmed" },
    };
    const unrelatedEcho = {
        id: "web-bridge-echo",
        body: "Different message",
        direction: "outbound",
        source: "whatsapp_web_bridge",
        status: "read",
        wamId: "3EB_TEST",
        createdAt: new Date("2026-07-16T06:57:07.000Z"),
    };

    assert.deepEqual(
        hideDuplicateScheduledWebBridgeEchoesForDisplay([scheduled, unrelatedEcho]).map((message) => message.id),
        ["scheduled-placeholder", "web-bridge-echo"]
    );
});

test("hideSupersededFailedWhatsAppAttemptsForDisplay hides failed attempt after later accepted resend", () => {
    const failedAttempt = {
        id: "failed-attempt",
        body: "Here is the option\n\nhttps://example.test/listing/1",
        type: "TYPE_WHATSAPP",
        direction: "outbound",
        status: "failed",
        wamId: null,
        createdAt: new Date("2026-07-16T07:10:00.000Z"),
        outboundWhatsAppOutbox: { status: "dead" },
    };
    const acceptedResend = {
        id: "accepted-resend",
        body: "Here is the option https://example.test/listing/1",
        type: "TYPE_WHATSAPP",
        direction: "outbound",
        status: "delivery_unconfirmed",
        wamId: null,
        createdAt: new Date("2026-07-16T07:12:00.000Z"),
        outboundWhatsAppOutbox: { status: "delivery_unconfirmed" },
    };

    assert.deepEqual(
        hideSupersededFailedWhatsAppAttemptsForDisplay([failedAttempt, acceptedResend]).map((message) => message.id),
        ["accepted-resend"]
    );
});

test("hideSupersededFailedWhatsAppAttemptsForDisplay keeps unrelated failed WhatsApp attempt", () => {
    const failedAttempt = {
        id: "failed-attempt",
        body: "Message A",
        type: "TYPE_WHATSAPP",
        direction: "outbound",
        status: "failed",
        wamId: null,
        createdAt: new Date("2026-07-16T07:10:00.000Z"),
        outboundWhatsAppOutbox: { status: "dead" },
    };
    const acceptedResend = {
        id: "accepted-resend",
        body: "Message B",
        type: "TYPE_WHATSAPP",
        direction: "outbound",
        status: "sent",
        wamId: "3EB_TEST",
        createdAt: new Date("2026-07-16T07:12:00.000Z"),
        outboundWhatsAppOutbox: { status: "completed" },
    };

    assert.deepEqual(
        hideSupersededFailedWhatsAppAttemptsForDisplay([failedAttempt, acceptedResend]).map((message) => message.id),
        ["failed-attempt", "accepted-resend"]
    );
});
