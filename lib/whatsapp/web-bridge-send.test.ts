import assert from "node:assert/strict";
import test from "node:test";
import {
    getWhatsAppWebBridgeLinkPreviewPolicy,
    getWhatsAppWebBridgeSendRequestTimeoutMs,
    isWhatsAppWebBridgeDeliveryUnconfirmedError,
    requireWhatsAppWebBridgeSentMessageId,
    WhatsAppWebBridgeDeliveryUnconfirmedError,
} from "./web-bridge-send";

test("client send deadlines exceed the bridge text and media operation bounds", () => {
    assert.equal(getWhatsAppWebBridgeSendRequestTimeoutMs({ hasMedia: false }), 35_000);
    assert.equal(getWhatsAppWebBridgeSendRequestTimeoutMs({ hasMedia: true }), 75_000);
});

test("device-egress text sends do not let a blocking link preview prevent dispatch", () => {
    assert.deepEqual(getWhatsAppWebBridgeLinkPreviewPolicy({ requested: true }), {
        requested: true,
        enabled: false,
        suppressed: true,
    });
    assert.deepEqual(getWhatsAppWebBridgeLinkPreviewPolicy({ requested: false }), {
        requested: false,
        enabled: false,
        suppressed: false,
    });
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
