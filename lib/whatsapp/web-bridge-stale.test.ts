import assert from "node:assert/strict";
import test from "node:test";
import {
    classifyWhatsAppWebBridgeRequestError,
    isWhatsAppWebBridgeRecoverableMediaError,
    isWhatsAppWebBridgeOpaqueRuntimeError,
    isWhatsAppWebBridgeStaleError,
    shouldRestartWhatsAppWebBridgeSession,
} from "./web-bridge-stale";

test("classifies bridge request failures without exposing error messages", () => {
    assert.equal(classifyWhatsAppWebBridgeRequestError(new Error("r")), "WHATSAPP_OPAQUE_RUNTIME");
    assert.equal(classifyWhatsAppWebBridgeRequestError(new Error("WhatsApp Web session is not ready.")), "WHATSAPP_SESSION_NOT_READY");
    assert.equal(classifyWhatsAppWebBridgeRequestError(new Error("Chat not found")), "WHATSAPP_CHAT_NOT_FOUND");
    assert.equal(classifyWhatsAppWebBridgeRequestError(new Error("operation timed out after 30000ms")), "WHATSAPP_OPERATION_TIMEOUT");
    assert.equal(classifyWhatsAppWebBridgeRequestError(new Error("Execution context was destroyed")), "WHATSAPP_BROWSER_CONTEXT_LOST");
    assert.equal(classifyWhatsAppWebBridgeRequestError(new Error("recipient +357 999 secret")), null);
});

test("isWhatsAppWebBridgeStaleError detects Puppeteer stale page failures", () => {
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Attempted to use detached Frame 'ABC'.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Execution context was destroyed, most likely because of a navigation.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Protocol error (Runtime.callFunctionOn): Target closed.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("r")), true);
    assert.equal(
        isWhatsAppWebBridgeStaleError(new Error("Device tunnel gateway generation changed; the browser proxy must be rebound.")),
        true,
    );
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

test("opaque runtime error detection is exact", () => {
    assert.equal(isWhatsAppWebBridgeOpaqueRuntimeError(new Error("r")), true);
    assert.equal(isWhatsAppWebBridgeOpaqueRuntimeError(new Error(" R ")), true);
    assert.equal(isWhatsAppWebBridgeOpaqueRuntimeError(new Error("Recipient is not on WhatsApp.")), false);
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

test("bridge fetch recovery restarts for opaque non-media failures", () => {
    assert.equal(
        shouldRestartWhatsAppWebBridgeSession(new Error("r")),
        true,
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
