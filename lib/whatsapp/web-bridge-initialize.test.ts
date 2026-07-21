import assert from "node:assert/strict";
import test from "node:test";
import { didWhatsAppWebSessionReachReadyBeforeInitializeError } from "./web-bridge-initialize";

test("a real ready event wins a later initialize timeout race", () => {
    assert.equal(didWhatsAppWebSessionReachReadyBeforeInitializeError({
        ready: true,
        lastReadyAt: new Date("2026-07-21T05:30:00.000Z"),
    }), true);
});

test("initialize errors still fail closed before a real ready event", () => {
    assert.equal(didWhatsAppWebSessionReachReadyBeforeInitializeError({ ready: false, lastReadyAt: null }), false);
    assert.equal(didWhatsAppWebSessionReachReadyBeforeInitializeError({ ready: true, lastReadyAt: null }), false);
    assert.equal(didWhatsAppWebSessionReachReadyBeforeInitializeError({ ready: true, lastReadyAt: new Date("invalid") }), false);
});
