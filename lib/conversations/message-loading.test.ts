import assert from "node:assert/strict";
import test from "node:test";

import {
    hideDuplicateScheduledWebBridgeEchoesForDisplay,
    hideSupersededFailedWhatsAppAttemptsForDisplay,
} from "./message-loading";

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
