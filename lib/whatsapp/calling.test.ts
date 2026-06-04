import assert from "node:assert/strict";
import test from "node:test";
import {
    checkCallingReadinessFromConfig,
    isPositiveWhatsAppCallConsentReply,
    normalizeBaileysCallBridgeResult,
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

test("Baileys bridge normalization treats call_offer_sent as signaling success", () => {
    const result = normalizeBaileysCallBridgeResult({
        success: true,
        event: "call_offer_sent",
        bridgeCallId: "bridge_123",
        whatsappCallId: "wa_123",
        mediaStatus: "signaling_only",
    });

    assert.equal(result.success, true);
    assert.equal(result.outcome, "success");
    assert.equal(result.status, "call_attempted");
    assert.equal(result.providerCallId, "wa_123");
    assert.equal(result.bridgeCallId, "bridge_123");
    assert.equal(result.whatsappCallId, "wa_123");
    assert.equal(result.mediaStatus, "signaling_only");
});

test("Baileys bridge normalization tracks accepted and media-connected events", () => {
    const accepted = normalizeBaileysCallBridgeResult({
        success: true,
        event: "call_accepted",
        callId: "call_123",
    });
    assert.equal(accepted.status, "accepted");

    const media = normalizeBaileysCallBridgeResult({
        success: true,
        event: "call_media_connected",
        callId: "call_123",
    });
    assert.equal(media.status, "accepted");
    assert.equal(media.mediaStatus, "audio_connected");
});

test("Baileys bridge normalization treats terminated events as ended", () => {
    const result = normalizeBaileysCallBridgeResult({
        success: true,
        event: "call_terminated",
        callId: "call_123",
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "ended");
});

test("Baileys bridge normalization preserves signaling failures", () => {
    const result = normalizeBaileysCallBridgeResult({
        success: false,
        event: "call_failed",
        callId: "call_123",
        errorCode: "offer_call_unavailable",
        errorMessage: "offerCall missing",
    });

    assert.equal(result.success, false);
    assert.equal(result.outcome, "failed");
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "offer_call_unavailable");
});

test("Baileys bridge normalization treats unconfirmed offers as failed", () => {
    const result = normalizeBaileysCallBridgeResult({
        success: false,
        event: "call_media_unknown",
        bridgeCallId: "bridge_123",
        whatsappCallId: "wa_123",
        errorCode: "baileys_offer_unconfirmed",
        errorMessage: "WhatsApp accepted the call offer, but no ringing event arrived.",
    });

    assert.equal(result.success, false);
    assert.equal(result.outcome, "failed");
    assert.equal(result.status, "failed");
    assert.equal(result.bridgeEvent, "call_media_unknown");
    assert.equal(result.errorCode, "baileys_offer_unconfirmed");
});

test("readiness allows signaling when Baileys bridge is ready", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "baileys_rnd",
        baileysCallBridgeStatus: "ready",
        baileysSessionId: "loc_123",
        mediaStatus: "signaling_only",
        bridgeBaseUrl: "http://127.0.0.1:3037",
    });

    assert.equal(readiness.ready, true);
    assert.equal(readiness.outcome, "success");
    assert.equal(readiness.baileysSessionId, "loc_123");
});

test("readiness refuses calls when Baileys session is missing", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "baileys_rnd",
        baileysCallBridgeStatus: "ready",
        mediaStatus: "signaling_only",
    });

    assert.equal(readiness.ready, false);
    assert.equal(readiness.outcome, "failed");
    assert.equal(readiness.errorCode, "baileys_session_missing");
});

test("readiness refuses calls when bridge is not ready", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "baileys_rnd",
        baileysCallBridgeStatus: "pairing",
        baileysSessionId: "loc_123",
        mediaStatus: "signaling_only",
    });

    assert.equal(readiness.ready, false);
    assert.equal(readiness.outcome, "failed");
    assert.equal(readiness.errorCode, "baileys_bridge_not_ready");
});

test("readiness refuses calls when media probe failed", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "baileys_rnd",
        baileysCallBridgeStatus: "ready",
        baileysSessionId: "loc_123",
        mediaStatus: "failed",
    });

    assert.equal(readiness.ready, false);
    assert.equal(readiness.outcome, "failed");
    assert.equal(readiness.errorCode, "baileys_media_failed");
});

test("readiness refuses simulated bridge health as real calling readiness", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "baileys_rnd",
        baileysCallBridgeStatus: "ready",
        baileysSessionId: "loc_123",
        mediaStatus: "signaling_only",
        metadata: {
            health: {
                ok: true,
                simulated: true,
            },
        },
    });

    assert.equal(readiness.ready, false);
    assert.equal(readiness.outcome, "failed");
    assert.equal(readiness.errorCode, "baileys_bridge_simulated");
});
