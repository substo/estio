import assert from "node:assert/strict";
import test from "node:test";
import {
    isWhatsAppWebBridgeRecoverableMediaError,
    isWhatsAppWebBridgeStaleError,
    shouldRestartWhatsAppWebBridgeSession,
} from "./web-bridge-stale";

test("isWhatsAppWebBridgeStaleError detects Puppeteer stale page failures", () => {
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Attempted to use detached Frame 'ABC'.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Execution context was destroyed, most likely because of a navigation.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Protocol error (Runtime.callFunctionOn): Target closed.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("WhatsApp Web session is not ready.")), false);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Recipient is not on WhatsApp.")), false);
});

test("isWhatsAppWebBridgeRecoverableMediaError detects opaque WhatsApp Web media failures", () => {
    assert.equal(isWhatsAppWebBridgeRecoverableMediaError(new Error("r")), true);
    assert.equal(
        isWhatsAppWebBridgeRecoverableMediaError(new Error("getAlternateUserWid - Invalid get call using deviceWid")),
        true,
    );
    assert.equal(
        isWhatsAppWebBridgeRecoverableMediaError(new Error("WhatsApp Web Bridge is not connected. Scan the QR code and wait until the session is ready.")),
        true,
    );
    assert.equal(isWhatsAppWebBridgeRecoverableMediaError(new Error("WhatsApp Web session is not ready.")), true);
    assert.equal(isWhatsAppWebBridgeRecoverableMediaError(new Error("Protocol error: Target closed")), true);
    assert.equal(isWhatsAppWebBridgeRecoverableMediaError(new Error("Recipient is not on WhatsApp.")), false);
});

test("media fetch isolation does not restart the WhatsApp Web Bridge session", () => {
    assert.equal(
        shouldRestartWhatsAppWebBridgeSession(new Error("Protocol error (Runtime.callFunctionOn): Target closed.")),
        true,
    );
    assert.equal(
        shouldRestartWhatsAppWebBridgeSession(
            new Error("Protocol error (Runtime.callFunctionOn): Target closed."),
            { isolateMediaFetch: true },
        ),
        false,
    );
    assert.equal(
        shouldRestartWhatsAppWebBridgeSession(new Error("r"), { isolateMediaFetch: true }),
        false,
    );
});

test("bridge fetch recovery does not restart for opaque media fetch failures", () => {
    assert.equal(
        shouldRestartWhatsAppWebBridgeSession(new Error("r")),
        false,
    );
    assert.equal(
        shouldRestartWhatsAppWebBridgeSession(
            new Error("WhatsApp Web Bridge is not connected. Scan the QR code and wait until the session is ready."),
        ),
        false,
    );
    assert.equal(
        shouldRestartWhatsAppWebBridgeSession(
            new Error("Recipient is not on WhatsApp."),
        ),
        false,
    );
});
