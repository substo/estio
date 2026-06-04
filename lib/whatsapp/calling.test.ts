import assert from "node:assert/strict";
import test from "node:test";
import {
    checkCallingReadinessFromConfig,
    isPositiveWhatsAppCallConsentReply,
    normalizeBaileysCallBridgeResult,
    normalizeBrowserCallBridgeResult,
    resolveBaileysCallOfferTarget,
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

test("Baileys call target prefers phone over WebBridge LID", () => {
    assert.equal(resolveBaileysCallOfferTarget({
        phone: "+357 96 407 286",
        targetJid: "155700009555@lid",
    }), "35796407286");
});

test("Baileys call target falls back to JID when phone is missing", () => {
    assert.equal(resolveBaileysCallOfferTarget({
        phone: "",
        targetJid: "155700009555@lid",
    }), "155700009555@lid");
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

test("browser bridge normalization tracks started, recording, ended, and failed states", () => {
    const started = normalizeBrowserCallBridgeResult({
        success: true,
        state: "started",
        callId: "browser_123",
    });
    assert.equal(started.success, true);
    assert.equal(started.status, "call_attempted");
    assert.equal(started.bridgeCallId, "browser_123");

    const recording = normalizeBrowserCallBridgeResult({
        success: true,
        state: "recording",
        callId: "browser_123",
        recordingPath: "/tmp/browser_123.wav",
    });
    assert.equal(recording.status, "call_attempted");
    assert.equal(recording.mediaStatus, "audio_connected");

    const ended = normalizeBrowserCallBridgeResult({
        success: true,
        state: "ended",
        callId: "browser_123",
        recordingPath: "/tmp/browser_123.wav",
    });
    assert.equal(ended.status, "ended");

    const failed = normalizeBrowserCallBridgeResult({
        success: false,
        state: "failed",
        errorCode: "browser_call_start_failed",
    });
    assert.equal(failed.success, false);
    assert.equal(failed.status, "failed");
});

test("readiness allows browser calls when paired, audio sink, and ffmpeg are ready", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "whatsapp_web_browser_call_rnd",
        baileysCallBridgeStatus: "ready",
        bridgeBaseUrl: "http://127.0.0.1:3038",
        metadata: {
            health: {
                ok: true,
                status: "ready",
                chromeReady: true,
                whatsappWebPaired: true,
                callButtonAvailable: true,
                audioSinkReady: true,
                ffmpegReady: true,
                profileDir: "/home/martin/whatsapp-call-browser-profile",
                recordingDir: "/home/martin/whatsapp-call-recordings",
            },
        },
    });

    assert.equal(readiness.ready, true);
    assert.equal(readiness.outcome, "success");
    assert.equal(readiness.callingRuntimeMode, "whatsapp_web_browser_call_rnd");
    assert.equal(readiness.whatsappWebPaired, true);
    assert.equal(readiness.callButtonAvailable, true);
    assert.equal(readiness.audioSinkReady, true);
    assert.equal(readiness.ffmpegReady, true);
});

test("browser readiness fails when bridge is unreachable", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "whatsapp_web_browser_call_rnd",
        bridgeBaseUrl: "http://127.0.0.1:3038",
    });

    assert.equal(readiness.ready, false);
    assert.equal(readiness.errorCode, "browser_call_bridge_unreachable");
});

test("browser readiness fails when WhatsApp Web is unpaired", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "whatsapp_web_browser_call_rnd",
        metadata: {
            health: {
                ok: false,
                status: "unpaired",
                chromeReady: true,
                whatsappWebPaired: false,
                callButtonAvailable: false,
                audioSinkReady: true,
                ffmpegReady: true,
            },
        },
    });

    assert.equal(readiness.ready, false);
    assert.equal(readiness.errorCode, "whatsapp_web_unpaired");
});

test("browser readiness treats current-page call button as diagnostic only", () => {
    const readiness = checkCallingReadinessFromConfig({
        callingRuntimeMode: "whatsapp_web_browser_call_rnd",
        metadata: {
            health: {
                ok: true,
                status: "unhealthy",
                chromeReady: true,
                whatsappWebPaired: true,
                callButtonAvailable: false,
                audioSinkReady: true,
                ffmpegReady: true,
            },
        },
    });

    assert.equal(readiness.ready, true);
    assert.equal(readiness.callButtonAvailable, false);
});

test("browser readiness fails when audio sink or ffmpeg is missing", () => {
    const audio = checkCallingReadinessFromConfig({
        callingRuntimeMode: "whatsapp_web_browser_call_rnd",
        metadata: {
            health: {
                ok: true,
                status: "unhealthy",
                chromeReady: true,
                whatsappWebPaired: true,
                callButtonAvailable: true,
                audioSinkReady: false,
                ffmpegReady: true,
            },
        },
    });
    assert.equal(audio.errorCode, "browser_audio_sink_unavailable");

    const ffmpeg = checkCallingReadinessFromConfig({
        callingRuntimeMode: "whatsapp_web_browser_call_rnd",
        metadata: {
            health: {
                ok: true,
                status: "unhealthy",
                chromeReady: true,
                whatsappWebPaired: true,
                callButtonAvailable: true,
                audioSinkReady: true,
                ffmpegReady: false,
            },
        },
    });
    assert.equal(ffmpeg.errorCode, "browser_ffmpeg_unavailable");
});

test("Baileys runtime remains dormant but can be explicitly configured", () => {
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
