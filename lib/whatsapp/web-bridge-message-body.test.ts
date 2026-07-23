import test from "node:test";
import assert from "node:assert/strict";

import {
    extractOpaqueWhatsAppWebBridgeMediaBody,
    getSafeWhatsAppWebBridgeMessageBody,
    isOpaqueWhatsAppWebBridgeMediaBody,
} from "./web-bridge-message-body";

test("recognizes common opaque media bodies without classifying normal text", () => {
    assert.equal(isOpaqueWhatsAppWebBridgeMediaBody({
        body: `/9j/${"A".repeat(256)}`,
        type: "image",
        hasMedia: true,
    }), true);
    assert.equal(isOpaqueWhatsAppWebBridgeMediaBody({
        body: `iVBOR${"A".repeat(256)}`,
        type: "image",
        hasMedia: true,
    }), true);
    assert.equal(isOpaqueWhatsAppWebBridgeMediaBody({
        body: `data:image/webp;base64,${"A".repeat(256)}`,
        type: "image",
        hasMedia: true,
    }), true);
    assert.equal(isOpaqueWhatsAppWebBridgeMediaBody({
        body: "Please send the property photographs when convenient.",
        type: "chat",
        hasMedia: false,
    }), false);
});

test("extracts a bounded valid media fallback from an opaque image body", () => {
    const body = `/9j/${"A".repeat(256)}`;
    assert.deepEqual(extractOpaqueWhatsAppWebBridgeMediaBody({
        body,
        type: "image",
        hasMedia: true,
        mimetype: "image/jpeg",
        maxBytes: 1024,
    }), {
        data: body,
        mimetype: "image/jpeg",
        size: 195,
    });
    assert.equal(extractOpaqueWhatsAppWebBridgeMediaBody({
        body,
        type: "image",
        hasMedia: true,
        maxBytes: 100,
    }), null);
});

test("uses captions and media placeholders instead of opaque payloads", () => {
    assert.equal(getSafeWhatsAppWebBridgeMessageBody({
        body: `/9j/${"A".repeat(256)}`,
        caption: "Kitchen",
        type: "image",
        hasMedia: true,
    }), "Kitchen");
    assert.equal(getSafeWhatsAppWebBridgeMessageBody({
        body: `/9j/${"A".repeat(256)}`,
        type: "image",
        hasMedia: true,
    }), "[Image]");
    assert.equal(getSafeWhatsAppWebBridgeMessageBody({
        body: "brochure.pdf",
        type: "document",
        hasMedia: true,
    }), "brochure.pdf");
});
