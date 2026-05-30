import assert from "node:assert/strict";
import test from "node:test";

import {
    deriveComposerInitialChannel,
    deriveConversationDisplayChannel,
    getConversationDisplayChannelLabel,
} from "./channel-summary";

test("deriveConversationDisplayChannel maps WhatsApp messages", () => {
    assert.equal(deriveConversationDisplayChannel({
        lastMessageType: "TYPE_WHATSAPP",
        type: "TYPE_SMS",
        lastMessageSource: null,
    }), "WhatsApp");
});

test("deriveConversationDisplayChannel maps email messages", () => {
    assert.equal(deriveConversationDisplayChannel({
        lastMessageType: "TYPE_EMAIL",
        type: "TYPE_SMS",
        lastMessageSource: null,
    }), "Email");
});

test("deriveConversationDisplayChannel maps SMS relay source to Android SMS", () => {
    const channel = deriveConversationDisplayChannel({
        lastMessageType: "TYPE_SMS",
        type: "TYPE_SMS",
        lastMessageSource: "sms_relay",
    });

    assert.equal(channel, "SMS_RELAY");
    assert.equal(getConversationDisplayChannelLabel(channel), "Android SMS");
});

test("deriveConversationDisplayChannel maps native SMS sources to SMS", () => {
    assert.equal(deriveConversationDisplayChannel({
        lastMessageType: "TYPE_SMS",
        type: "TYPE_SMS",
        lastMessageSource: "ghl",
    }), "SMS");

    assert.equal(deriveConversationDisplayChannel({
        lastMessageType: "TYPE_SMS",
        type: "TYPE_SMS",
        lastMessageSource: null,
    }), "SMS");
});

test("deriveConversationDisplayChannel falls back to conversation type", () => {
    assert.equal(deriveConversationDisplayChannel({
        lastMessageType: undefined,
        type: "TYPE_EMAIL",
        lastMessageSource: null,
    }), "Email");
});

test("deriveComposerInitialChannel can default to SMS relay when enabled", () => {
    const conversation = {
        lastMessageType: "TYPE_SMS",
        type: "TYPE_SMS",
        lastMessageSource: "sms_relay",
    };

    assert.equal(deriveComposerInitialChannel(conversation, { smsRelayEnabled: true }), "SMS_RELAY");
    assert.equal(deriveComposerInitialChannel(conversation, { smsRelayEnabled: false }), "SMS");
});
