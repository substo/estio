import assert from "node:assert/strict";
import test from "node:test";

import {
    availableChannel,
    getConversationContactIdentity,
    getBestAvailableDefaultChannel,
    getFirstAvailableChannel,
    unavailableChannel,
    type ConversationChannelCapabilities,
} from "./channel-capabilities";

test("contact identity requires real email for email channel", () => {
    assert.deepEqual(
        getConversationContactIdentity({
            contactPhone: "+35797428827",
            contactEmail: null,
        } as any),
        { hasPhone: true, hasEmail: false }
    );

    assert.deepEqual(
        getConversationContactIdentity({
            contactPhone: "",
            contactEmail: "lead@example.com",
        } as any),
        { hasPhone: false, hasEmail: true }
    );
});

test("first available channel skips unavailable email and blocked SMS channels", () => {
    const capabilities: ConversationChannelCapabilities = {
        WhatsApp: unavailableChannel("whatsapp_number_not_found"),
        SMS: unavailableChannel("ghl_sms_not_configured"),
        SMS_RELAY: unavailableChannel("sms_blocked_by_policy"),
        Email: unavailableChannel("missing_email"),
    };

    assert.equal(getFirstAvailableChannel("Email", capabilities), null);

    capabilities.WhatsApp = availableChannel();
    assert.equal(getFirstAvailableChannel("Email", capabilities), "WhatsApp");
});

test("first available channel can use Android SMS when GHL SMS and email are unavailable", () => {
    const capabilities: ConversationChannelCapabilities = {
        WhatsApp: unavailableChannel("whatsapp_number_not_found"),
        SMS: unavailableChannel("ghl_sms_not_configured"),
        SMS_RELAY: availableChannel(),
        Email: unavailableChannel("missing_email"),
    };

    assert.equal(getFirstAvailableChannel("WhatsApp", capabilities), "SMS_RELAY");
});

test("preferred available channel is preserved", () => {
    const capabilities: ConversationChannelCapabilities = {
        WhatsApp: availableChannel(),
        SMS: unavailableChannel("ghl_sms_not_configured"),
        SMS_RELAY: unavailableChannel("sms_blocked_by_policy"),
        Email: unavailableChannel("missing_email"),
    };

    assert.equal(getFirstAvailableChannel("WhatsApp", capabilities), "WhatsApp");
});

test("best default channel prefers WhatsApp over available SMS channels", () => {
    const capabilities: ConversationChannelCapabilities = {
        WhatsApp: availableChannel(),
        SMS: availableChannel(),
        SMS_RELAY: availableChannel(),
        Email: availableChannel(),
    };

    assert.equal(getBestAvailableDefaultChannel(capabilities), "WhatsApp");

    capabilities.WhatsApp = unavailableChannel("whatsapp_number_not_found");
    assert.equal(getBestAvailableDefaultChannel(capabilities), "SMS_RELAY");
});
