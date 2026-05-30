import assert from "node:assert/strict";
import test from "node:test";

import { deriveComposerInitialChannel } from "@/lib/conversations/channel-summary";
import type { Conversation } from "@/lib/ghl/conversations";

test("composer initial channel selects Android SMS when latest message is SMS relay and relay is enabled", () => {
    const conversation = {
        id: "conv_1",
        type: "TYPE_SMS",
        lastMessageType: "TYPE_SMS",
        lastMessageSource: "sms_relay",
    } as Conversation;

    assert.equal(deriveComposerInitialChannel(conversation, { smsRelayEnabled: true }), "SMS_RELAY");
});
