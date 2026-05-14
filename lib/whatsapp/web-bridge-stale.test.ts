import assert from "node:assert/strict";
import test from "node:test";
import { isWhatsAppWebBridgeStaleError } from "./web-bridge-stale";

test("isWhatsAppWebBridgeStaleError detects Puppeteer stale page failures", () => {
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Attempted to use detached Frame 'ABC'.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Execution context was destroyed, most likely because of a navigation.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Protocol error (Runtime.callFunctionOn): Target closed.")), true);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("WhatsApp Web session is not ready.")), false);
    assert.equal(isWhatsAppWebBridgeStaleError(new Error("Recipient is not on WhatsApp.")), false);
});
