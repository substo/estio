import assert from "node:assert/strict";
import test from "node:test";
import { requireWhatsAppWebBridgeSentMessageId } from "./web-bridge-send";

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
