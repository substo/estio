import assert from "node:assert/strict";
import test from "node:test";

import { deriveComposerInitialChannel } from "@/lib/conversations/channel-summary";
import type { Conversation } from "@/lib/ghl/conversations";
import {
    buildConversationChannelCapabilityCacheKey,
    deriveProvisionalConversationChannelCapabilities,
    isConversationChannelCapabilityCacheFresh,
    selectComposerChannelAfterCapabilityUpdate,
} from "./use-conversation-composer-channel";
import {
    availableChannel,
    unavailableChannel,
    type ConversationChannelCapabilities,
} from "@/lib/conversations/channel-capabilities";

test("composer initial channel selects Android SMS when latest message is SMS relay and relay is enabled", () => {
    const conversation = {
        id: "conv_1",
        type: "TYPE_SMS",
        lastMessageType: "TYPE_SMS",
        lastMessageSource: "sms_relay",
    } as Conversation;

    assert.equal(deriveComposerInitialChannel(conversation, { smsRelayEnabled: true }), "SMS_RELAY");
});

test("channel capability cache key changes when contact identity changes", () => {
    const conversation = {
        id: "conv_1",
        contactPhone: "+357 97 428827",
        contactEmail: "Lead@Example.com",
    } as Conversation;

    assert.equal(
        buildConversationChannelCapabilityCacheKey(conversation, { smsRelayEnabled: true }),
        "estio:conversation-channel-capabilities:v2:conv_1:35797428827:lead@example.com:relay-on"
    );
    assert.notEqual(
        buildConversationChannelCapabilityCacheKey(conversation, { smsRelayEnabled: true }),
        buildConversationChannelCapabilityCacheKey({ ...conversation, contactPhone: "+357 99 000000" }, { smsRelayEnabled: true })
    );
});

test("channel capability cache freshness has a hard max age", () => {
    const now = 1_000_000;

    assert.equal(isConversationChannelCapabilityCacheFresh(now - 60_000, now, 120_000), true);
    assert.equal(isConversationChannelCapabilityCacheFresh(now - 180_000, now, 120_000), false);
    assert.equal(isConversationChannelCapabilityCacheFresh(0, now, 120_000), false);
});

test("provisional channel state allows Android SMS from local evidence", () => {
    const capabilities = deriveProvisionalConversationChannelCapabilities({
        id: "conv_1",
        contactPhone: "+35797428827",
        contactEmail: null,
        lastMessageType: "TYPE_WHATSAPP",
        lastMessageChannel: "WhatsApp",
        lastMessageId: null,
    } as Conversation, { smsRelayEnabled: true });

    assert.equal(capabilities.SMS_RELAY.available, true);
    assert.equal(capabilities.WhatsApp.available, false);
});

test("provisional channel state trusts actual WhatsApp message evidence", () => {
    const capabilities = deriveProvisionalConversationChannelCapabilities({
        id: "conv_1",
        contactPhone: "+35797428827",
        lastMessageChannel: "WhatsApp",
        lastMessageId: "msg_1",
    } as Conversation, { smsRelayEnabled: false });

    assert.equal(capabilities.WhatsApp.available, true);
});

test("provisional channel state allows email from local address", () => {
    const capabilities = deriveProvisionalConversationChannelCapabilities({
        id: "conv_1",
        contactEmail: "lead@example.com",
    } as Conversation);

    assert.equal(capabilities.Email.available, true);
});

test("capability update auto-selects WhatsApp over provisional SMS when user has not chosen", () => {
    const capabilities: ConversationChannelCapabilities = {
        WhatsApp: availableChannel(),
        SMS: availableChannel(),
        SMS_RELAY: unavailableChannel("sms_relay_disabled"),
        Email: unavailableChannel("missing_email"),
    };

    assert.equal(selectComposerChannelAfterCapabilityUpdate({
        previousChannel: "SMS",
        capabilities,
        userSelectedChannel: false,
    }), "WhatsApp");
});

test("capability update preserves manual SMS selection when still available", () => {
    const capabilities: ConversationChannelCapabilities = {
        WhatsApp: availableChannel(),
        SMS: availableChannel(),
        SMS_RELAY: unavailableChannel("sms_relay_disabled"),
        Email: unavailableChannel("missing_email"),
    };

    assert.equal(selectComposerChannelAfterCapabilityUpdate({
        previousChannel: "SMS",
        capabilities,
        userSelectedChannel: true,
    }), "SMS");
});
