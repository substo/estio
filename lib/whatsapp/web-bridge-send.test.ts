import assert from "node:assert/strict";
import test from "node:test";
import {
    buildWhatsAppWebBridgeTextSendOptions,
    getWhatsAppWebBridgeLinkPreviewPolicy,
    getWhatsAppWebBridgeDispatchConfirmationPolicy,
    getWhatsAppWebBridgeSendRequestTimeoutMs,
    isWhatsAppWebBridgeLinkPreviewUrlEligible,
    isWhatsAppWebBridgeDeliveryUnconfirmedError,
    requireWhatsAppWebBridgeSentMessageId,
    sanitizeWhatsAppWebBridgeLinkPreview,
    WhatsAppWebBridgeDeliveryUnconfirmedError,
} from "./web-bridge-send";

test("client send deadlines exceed the bridge text and media operation bounds", () => {
    assert.equal(getWhatsAppWebBridgeSendRequestTimeoutMs({ hasMedia: false }), 35_000);
    assert.equal(getWhatsAppWebBridgeSendRequestTimeoutMs({ hasMedia: true }), 75_000);
});

test("device-egress injects a resolved preview without enabling the blocking library lookup", () => {
    assert.deepEqual(getWhatsAppWebBridgeLinkPreviewPolicy({
        requested: true,
        previewReady: true,
    }), {
        requested: true,
        enabled: false,
        injected: true,
        suppressed: false,
    });
    assert.deepEqual(getWhatsAppWebBridgeLinkPreviewPolicy({ requested: true }), {
        requested: true,
        enabled: false,
        injected: false,
        suppressed: true,
    });
    assert.deepEqual(getWhatsAppWebBridgeLinkPreviewPolicy({ requested: false }), {
        requested: false,
        enabled: false,
        injected: false,
        suppressed: false,
    });
});

test("link preview URLs reject private, ambiguous, credentialed, and alternate endpoints", () => {
    assert.equal(isWhatsAppWebBridgeLinkPreviewUrlEligible("https://www.example.com/listing"), true);
    assert.equal(isWhatsAppWebBridgeLinkPreviewUrlEligible("http://example.com:80/listing"), true);
    for (const value of [
        "http://127.0.0.1/private",
        "http://[::1]/private",
        "http://localhost/private",
        "https://printer.local/private",
        "https://singlelabel/private",
        "https://user:password@example.com/private",
        "https://example.com:8443/private",
        "file:///etc/passwd",
    ]) {
        assert.equal(isWhatsAppWebBridgeLinkPreviewUrlEligible(value), false, value);
    }
});

test("link preview payloads are allowlisted, bounded, and cannot override message authority", () => {
    const preview = sanitizeWhatsAppWebBridgeLinkPreview({
        data: {
            canonicalUrl: "https://attacker.invalid/",
            matchedText: "rewritten",
            title: "Listing title",
            description: "Listing description",
            thumbnail: "base64-thumbnail",
            id: "attacker-message-id",
            from: "attacker",
            to: "other-recipient",
            body: "rewritten body",
            ack: 3,
        },
    }, "https://www.example.com/listing");
    assert.deepEqual(preview, {
        canonicalUrl: "https://www.example.com/listing",
        matchedText: "https://www.example.com/listing",
        title: "Listing title",
        description: "Listing description",
        thumbnail: "base64-thumbnail",
        preview: true,
        subtype: "url",
    });
    assert.deepEqual(buildWhatsAppWebBridgeTextSendOptions(preview), {
        linkPreview: false,
        extra: preview,
        waitUntilMsgSent: false,
    });
    assert.deepEqual(buildWhatsAppWebBridgeTextSendOptions(null), {
        linkPreview: false,
        waitUntilMsgSent: false,
    });
    assert.equal(sanitizeWhatsAppWebBridgeLinkPreview({
        title: "x".repeat(513),
        thumbnail: "x".repeat(2 * 1024 * 1024 + 1),
    }, "https://www.example.com/listing"), null);
    assert.equal(sanitizeWhatsAppWebBridgeLinkPreview({
        title: "Private",
    }, "http://127.0.0.1/private"), null);
});

test("device-egress accepts the local provider id without blocking on the network send promise", () => {
    assert.deepEqual(getWhatsAppWebBridgeDispatchConfirmationPolicy(), { waitUntilMsgSent: false });
});

test("extracts a serialized WhatsApp provider message id", () => {
    assert.equal(requireWhatsAppWebBridgeSentMessageId({
        id: { _serialized: "true_lid_provider-message" },
    }), "true_lid_provider-message");
});

test("supports the whatsapp-web.js raw id fallback", () => {
    assert.equal(requireWhatsAppWebBridgeSentMessageId({ id: { id: "provider-message" } }), "provider-message");
});

test("rejects null, undefined, and ambiguous send results", () => {
    assert.throws(() => requireWhatsAppWebBridgeSentMessageId(null), /WHATSAPP_SEND_RESULT_MISSING_ID/);
    assert.throws(() => requireWhatsAppWebBridgeSentMessageId(undefined), /WHATSAPP_SEND_RESULT_MISSING_ID/);
    assert.throws(() => requireWhatsAppWebBridgeSentMessageId({}), /WHATSAPP_SEND_RESULT_MISSING_ID/);
    assert.throws(() => requireWhatsAppWebBridgeSentMessageId({ id: {} }), /WHATSAPP_SEND_RESULT_MISSING_ID/);
});

test("classifies only explicit bridge delivery uncertainty", () => {
    const error = new WhatsAppWebBridgeDeliveryUnconfirmedError();
    assert.equal(isWhatsAppWebBridgeDeliveryUnconfirmedError(error), true);
    assert.equal(isWhatsAppWebBridgeDeliveryUnconfirmedError({ code: error.code }), true);
    assert.equal(isWhatsAppWebBridgeDeliveryUnconfirmedError(new Error("timeout")), false);
});
