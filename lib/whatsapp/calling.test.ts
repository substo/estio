import assert from "node:assert/strict";
import test from "node:test";
import {
    checkCallingReadinessFromConfig,
    isPositiveWhatsAppCallConsentReply,
    normalizeWhatsAppCallingProviderResult,
} from "./calling";

test("positive WhatsApp call consent replies are detected", () => {
    for (const body of ["yes", "sure", "ok", "call me", "yes call", "You can call me", "go ahead"]) {
        assert.equal(isPositiveWhatsAppCallConsentReply(body), true, body);
    }
});

test("negative and ambiguous WhatsApp call replies do not grant consent", () => {
    for (const body of ["no", "not now", "no thanks", "maybe later", "what about this property?", "ok but text me"]) {
        assert.equal(isPositiveWhatsAppCallConsentReply(body), false, body);
    }
});

test("official provider normalization maps started, ringing, accepted, ended, and failed", () => {
    const started = normalizeWhatsAppCallingProviderResult({
        messaging_product: "whatsapp",
        calls: [{ id: "wacid.started" }],
    });
    assert.equal(started.success, true);
    assert.equal(started.status, "call_attempted");
    assert.equal(started.providerCallId, "wacid.started");

    const ringing = normalizeWhatsAppCallingProviderResult({
        event: "ringing",
        call_id: "wacid.ringing",
    });
    assert.equal(ringing.status, "ringing");

    const accepted = normalizeWhatsAppCallingProviderResult({
        event: "accepted",
        call_id: "wacid.accepted",
    });
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.mediaStatus, "audio_connected");

    const ended = normalizeWhatsAppCallingProviderResult({
        event: "terminated",
        call_id: "wacid.ended",
    });
    assert.equal(ended.status, "ended");

    const failed = normalizeWhatsAppCallingProviderResult({
        success: false,
        errorCode: "138006",
        errorMessage: "No call permission.",
    });
    assert.equal(failed.success, false);
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorCode, "138006");
});

test("readiness fails with no WABA channel", () => {
    const readiness = checkCallingReadinessFromConfig({
        hasCloudChannel: false,
        hasAccessToken: true,
    });

    assert.equal(readiness.ready, false);
    assert.equal(readiness.errorCode, "waba_channel_missing");
});

test("readiness fails when phone number is not calling-enabled", () => {
    const readiness = checkCallingReadinessFromConfig({
        phoneNumberId: "123",
        wabaId: "456",
        hasAccessToken: true,
        callingEnabled: false,
        webhooksEnabled: true,
        mediaMode: "sip",
        sipEndpoint: "sip:calling.estio.co",
    });

    assert.equal(readiness.ready, false);
    assert.equal(readiness.errorCode, "calling_not_enabled");
});

test("readiness fails when webhook or media mode is missing", () => {
    const webhook = checkCallingReadinessFromConfig({
        phoneNumberId: "123",
        wabaId: "456",
        hasAccessToken: true,
        callingEnabled: true,
        webhooksEnabled: false,
        mediaMode: "sip",
        sipEndpoint: "sip:calling.estio.co",
    });
    assert.equal(webhook.ready, false);
    assert.equal(webhook.errorCode, "calling_webhooks_missing");

    const sip = checkCallingReadinessFromConfig({
        phoneNumberId: "123",
        wabaId: "456",
        hasAccessToken: true,
        callingEnabled: true,
        webhooksEnabled: true,
        mediaMode: "sip",
    });
    assert.equal(sip.ready, false);
    assert.equal(sip.errorCode, "sip_endpoint_missing");
});

test("readiness succeeds for official Calling API with enabled number and configured SIP media path", () => {
    const readiness = checkCallingReadinessFromConfig({
        phoneNumberId: "123",
        wabaId: "456",
        hasAccessToken: true,
        callingEnabled: true,
        webhooksEnabled: true,
        mediaMode: "sip",
        sipEndpoint: "sip:calling.estio.co",
    });

    assert.equal(readiness.ready, true);
    assert.equal(readiness.outcome, "success");
    assert.equal(readiness.provider, "meta_calling_api");
});
