import test from "node:test";
import assert from "node:assert/strict";
import {
    extractPhoneFromWhatsAppWebId,
    normalizeWhatsAppWebChatId,
} from "@/lib/whatsapp/web-bridge";

test("normalizeWhatsAppWebChatId creates 1:1 chat ids from phone numbers", () => {
    assert.equal(normalizeWhatsAppWebChatId("+357 96 407286"), "35796407286@c.us");
    assert.equal(normalizeWhatsAppWebChatId("35796407286@c.us"), "35796407286@c.us");
});

test("extractPhoneFromWhatsAppWebId handles multi-device ids", () => {
    assert.equal(extractPhoneFromWhatsAppWebId("35796407286:12@c.us"), "35796407286");
    assert.equal(extractPhoneFromWhatsAppWebId("35796407286@s.whatsapp.net"), "35796407286");
});
