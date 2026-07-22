import assert from "node:assert/strict";
import test from "node:test";

import {
    buildWhatsAppWebBridgeRecipientResolution,
    isWhatsAppWebBridgeRecipientCandidateUsable,
    isWhatsAppWebBridgeRecipientVerificationUnknown,
} from "./web-bridge-recipient-resolution";

test("explicit provider absence remains unavailable", () => {
    const result = buildWhatsAppWebBridgeRecipientResolution({
        phone: "+48 600 000 000",
        registration: "unavailable",
    });

    assert.equal(result.available, false);
    assert.equal(result.verification, "unavailable");
    assert.equal(result.chatId, null);
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable(result), false);
});

test("registration timeout produces a bounded unverified send candidate", () => {
    const result = buildWhatsAppWebBridgeRecipientResolution({
        phone: "+48 600 000 000",
        registration: "unknown",
    });

    assert.equal(result.available, null);
    assert.equal(result.verification, "unknown");
    assert.equal(result.chatId, "48600000000@c.us");
    assert.equal(result.retryable, true);
    assert.equal(isWhatsAppWebBridgeRecipientVerificationUnknown(result), true);
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable(result), true);
});

test("only canonical phone candidates may use unverified sending", () => {
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable({
        chatId: "12345@c.us",
        verification: "unknown",
    }), false);
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable({
        chatId: "123456789@lid",
        verification: "unknown",
    }), false);
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable({
        chatId: "123456789@g.us",
        verification: "unknown",
    }), false);
});

test("verified registration and existing chats remain available", () => {
    const registered = buildWhatsAppWebBridgeRecipientResolution({
        phone: "48600000000",
        registration: "verified",
        registeredChatId: "48600000000@c.us",
    });
    const existing = buildWhatsAppWebBridgeRecipientResolution({
        phone: "48600000000",
        registration: "unknown",
        existingChatId: "48600000000@c.us",
    });

    assert.equal(registered.verification, "verified");
    assert.equal(existing.verification, "verified");
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable(registered), true);
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable(existing), true);
});

test("mixed-version verified sources remain recognized", () => {
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable({
        chatId: "48600000000@c.us",
        source: "getNumberId",
    }), true);
    assert.equal(isWhatsAppWebBridgeRecipientCandidateUsable({
        chatId: "48600000000@c.us",
        source: "preferred",
    }), true);
});
