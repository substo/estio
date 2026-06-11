import assert from "node:assert/strict";
import test from "node:test";

import { getConversationFeatureFlags } from "./feature-flags";

test("conversation translation defaults to canary locations", () => {
    const previousCanary = process.env.CONVERSATIONS_CANARY_LOCATIONS;
    const previousRead = process.env.CONVERSATIONS_TRANSLATION_READ;
    const previousWrite = process.env.CONVERSATIONS_TRANSLATION_WRITE;
    const previousBanner = process.env.CONVERSATIONS_TRANSLATION_BANNER;

    process.env.CONVERSATIONS_CANARY_LOCATIONS = "loc_1";
    delete process.env.CONVERSATIONS_TRANSLATION_READ;
    delete process.env.CONVERSATIONS_TRANSLATION_WRITE;
    delete process.env.CONVERSATIONS_TRANSLATION_BANNER;

    try {
        const canaryFlags = getConversationFeatureFlags("loc_1");
        assert.equal(canaryFlags.conversationTranslationRead, true);
        assert.equal(canaryFlags.conversationTranslationWrite, true);
        assert.equal(canaryFlags.conversationTranslationBanner, true);

        const nonCanaryFlags = getConversationFeatureFlags("loc_2");
        assert.equal(nonCanaryFlags.conversationTranslationRead, false);
        assert.equal(nonCanaryFlags.conversationTranslationWrite, false);
        assert.equal(nonCanaryFlags.conversationTranslationBanner, false);
    } finally {
        if (previousCanary === undefined) delete process.env.CONVERSATIONS_CANARY_LOCATIONS;
        else process.env.CONVERSATIONS_CANARY_LOCATIONS = previousCanary;
        if (previousRead === undefined) delete process.env.CONVERSATIONS_TRANSLATION_READ;
        else process.env.CONVERSATIONS_TRANSLATION_READ = previousRead;
        if (previousWrite === undefined) delete process.env.CONVERSATIONS_TRANSLATION_WRITE;
        else process.env.CONVERSATIONS_TRANSLATION_WRITE = previousWrite;
        if (previousBanner === undefined) delete process.env.CONVERSATIONS_TRANSLATION_BANNER;
        else process.env.CONVERSATIONS_TRANSLATION_BANNER = previousBanner;
    }
});

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
