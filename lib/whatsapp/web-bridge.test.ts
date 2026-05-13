import test from "node:test";
import assert from "node:assert/strict";
import {
    extractPhoneFromWhatsAppWebId,
    normalizeWhatsAppWebChatId,
    parseWhatsAppWebChatIdentity,
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

test("parseWhatsAppWebChatIdentity accepts supported one-to-one chat ids", () => {
    assert.deepEqual(parseWhatsAppWebChatIdentity("35796407286:12@c.us"), {
        rawId: "35796407286:12@c.us",
        phone: "35796407286",
        chatId: "35796407286@c.us",
        isSupported: true,
    });
});

test("parseWhatsAppWebChatIdentity rejects unsupported web chat ids", () => {
    assert.equal(parseWhatsAppWebChatIdentity("120363000000000000@g.us").reason, "group_unsupported");
    assert.equal(parseWhatsAppWebChatIdentity("status@broadcast").reason, "broadcast_unsupported");
    assert.equal(parseWhatsAppWebChatIdentity("123456789@newsletter").reason, "newsletter_unsupported");
    assert.equal(parseWhatsAppWebChatIdentity("123456789@lid").reason, "lid_unsupported");
    assert.equal(parseWhatsAppWebChatIdentity("abc@c.us").reason, "invalid_phone");
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
