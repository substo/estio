import assert from "node:assert/strict";
import test from "node:test";

import {
    classifyOutboundSendFailure,
    getSmsFallbackAvailability,
} from "./outbound-send-failure";

test("classifies WhatsApp Web No LID failure as number not on WhatsApp", () => {
    const classification = classifyOutboundSendFailure({
        lastError: "WhatsApp Web send failed. Confirm the recipient is on WhatsApp and the bridge is still connected. No LID for user\ns (https://static.whatsapp.net/rsrc.php/v4/yJ/r/gh97Kj2dCkY.js:79:180)",
    });

    assert.equal(classification.code, "WHATSAPP_NUMBER_NOT_FOUND");
    assert.equal(classification.retryable, false);
    assert.deepEqual(classification.fallbackChannels, ["SMS_RELAY"]);
    assert.equal(classification.label, "This number is not available on WhatsApp.");
});

test("classifies common WhatsApp not registered provider strings without exact match dependency", () => {
    for (const error of [
        "Recipient is not a WhatsApp user",
        "phone number is not registered on WhatsApp",
        { response: { data: { error: { message: "wa_id not found" } } } },
    ]) {
        assert.equal(classifyOutboundSendFailure(error).code, "WHATSAPP_NUMBER_NOT_FOUND");
    }
});

test("classifies WhatsApp auth and unknown failures separately", () => {
    assert.equal(
        classifyOutboundSendFailure("WhatsApp Web Bridge is not connected. Scan the QR code and wait until the session is ready.").code,
        "WHATSAPP_AUTH"
    );
    assert.equal(classifyOutboundSendFailure("Unexpected provider response").code, "UNKNOWN");
});

test("maps authenticated Android SMS fallback availability", () => {
    assert.deepEqual(
        getSmsFallbackAvailability({
            smsRelayEnabled: true,
            contactPhone: "+35799306050",
            smsRelayDevice: { paired: true, status: "online" },
        }),
        { available: true, channel: "SMS_RELAY", reason: null }
    );
    assert.equal(
        getSmsFallbackAvailability({
            smsRelayEnabled: true,
            contactPhone: "+35799306050",
            smsRelayDevice: { paired: true, status: "offline" },
        }).reason,
        "sms_relay_offline"
    );
    assert.equal(
        getSmsFallbackAvailability({
            smsRelayEnabled: false,
            contactPhone: "+35799306050",
            smsRelayDevice: { paired: true, status: "online" },
        }).available,
        false
    );
});
