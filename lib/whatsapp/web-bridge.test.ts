import test from "node:test";
import assert from "node:assert/strict";
import {
    extractPhoneFromWhatsAppWebId,
    normalizeWhatsAppWebChatId,
} from "@/lib/whatsapp/web-bridge";
import {
    decodeBridgeBase64Payload,
    formatWhatsAppWebBridgeMediaFailure,
    normalizeBridgeMediaType,
} from "@/lib/whatsapp/web-bridge-media";

test("normalizeWhatsAppWebChatId creates 1:1 chat ids from phone numbers", () => {
    assert.equal(normalizeWhatsAppWebChatId("+357 96 407286"), "35796407286@c.us");
    assert.equal(normalizeWhatsAppWebChatId("35796407286@c.us"), "35796407286@c.us");
});

test("extractPhoneFromWhatsAppWebId handles multi-device ids", () => {
    assert.equal(extractPhoneFromWhatsAppWebId("35796407286:12@c.us"), "35796407286");
    assert.equal(extractPhoneFromWhatsAppWebId("35796407286@s.whatsapp.net"), "35796407286");
});

test("normalizeBridgeMediaType accepts common media and document mimetypes", () => {
    assert.equal(normalizeBridgeMediaType("image/jpeg"), "image");
    assert.equal(normalizeBridgeMediaType("audio/ogg"), "audio");
    assert.equal(normalizeBridgeMediaType("ptt"), "audio");
    assert.equal(normalizeBridgeMediaType("application/pdf"), "document");
    assert.equal(normalizeBridgeMediaType("text/plain"), "document");
    assert.equal(normalizeBridgeMediaType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "document");
    assert.equal(normalizeBridgeMediaType("sticker"), null);
});

test("decodeBridgeBase64Payload rejects empty and invalid payloads", () => {
    assert.equal(decodeBridgeBase64Payload(""), null);
    assert.equal(decodeBridgeBase64Payload("not valid !!!"), null);
    assert.equal(decodeBridgeBase64Payload("data:text/plain;base64,aGVsbG8=")?.toString("utf8"), "hello");
});

test("formatWhatsAppWebBridgeMediaFailure returns actionable labels", () => {
    assert.equal(formatWhatsAppWebBridgeMediaFailure("invalid_base64"), "media payload could not be decoded");
    assert.equal(formatWhatsAppWebBridgeMediaFailure("attachment_exists"), "attachment already exists");
    assert.equal(formatWhatsAppWebBridgeMediaFailure(undefined), "unknown reason");
});
