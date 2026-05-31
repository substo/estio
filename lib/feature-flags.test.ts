import assert from "node:assert/strict";
import test from "node:test";

import { getConversationFeatureFlags } from "./feature-flags";

test("conversation SMS relay feature follows location config by default", () => {
    const previous = process.env.SMS_RELAY_ENABLED;
    delete process.env.SMS_RELAY_ENABLED;
    delete process.env.sms_relay_enabled;

    try {
        assert.equal(
            getConversationFeatureFlags("loc_1", { locationSmsRelayEnabled: true }).smsRelayEnabled,
            true
        );
        assert.equal(
            getConversationFeatureFlags("loc_1", { locationSmsRelayEnabled: false }).smsRelayEnabled,
            false
        );
    } finally {
        if (previous === undefined) {
            delete process.env.SMS_RELAY_ENABLED;
        } else {
            process.env.SMS_RELAY_ENABLED = previous;
        }
    }
});

test("conversation SMS relay feature can still be explicitly disabled by env", () => {
    const previous = process.env.SMS_RELAY_ENABLED;
    process.env.SMS_RELAY_ENABLED = "off";

    try {
        assert.equal(
            getConversationFeatureFlags("loc_1", { locationSmsRelayEnabled: true }).smsRelayEnabled,
            false
        );
    } finally {
        if (previous === undefined) {
            delete process.env.SMS_RELAY_ENABLED;
        } else {
            process.env.SMS_RELAY_ENABLED = previous;
        }
    }
});
