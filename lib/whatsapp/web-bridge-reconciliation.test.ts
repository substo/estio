import assert from "node:assert/strict";
import test from "node:test";
import {
    isWhatsAppWebBridgeReconciliationMessageRecent,
    selectWhatsAppWebBridgeReconciliationChats,
    selectWhatsAppWebBridgeReconciliationMessages,
} from "./web-bridge-reconciliation";

test("reconciliation selects recent direct chats within the bound", () => {
    const chats = selectWhatsAppWebBridgeReconciliationChats([
        { id: { _serialized: "older@c.us" }, timestamp: 10 },
        { id: { _serialized: "group@g.us" }, timestamp: 30, isGroup: true },
        { id: { _serialized: "newer@c.us" }, timestamp: 20 },
        { id: { _serialized: "" }, timestamp: 40 },
    ], 1);
    assert.deepEqual(chats.map((chat) => chat.id._serialized), ["newer@c.us"]);
});

test("reconciliation deduplicates and bounds messages while preserving chronological delivery", () => {
    const nowMs = Date.parse("2026-07-22T06:00:00.000Z");
    const selected = selectWhatsAppWebBridgeReconciliationMessages([
        { id: { _serialized: "m1" }, timestamp: (nowMs - 3_000) / 1000 },
        { id: { _serialized: "m2" }, timestamp: (nowMs - 1_000) / 1000 },
        { id: { _serialized: "m1" }, timestamp: (nowMs - 2_000) / 1000 },
    ], nowMs, 2);
    assert.deepEqual(selected.map((message) => message.id._serialized), ["m1", "m2"]);
});

test("reconciliation deduplicates serialized and local provider message-id aliases", () => {
    const nowMs = Date.parse("2026-07-22T06:00:00.000Z");
    const localId = "3EB0LOCALMESSAGEID";
    const selected = selectWhatsAppWebBridgeReconciliationMessages([
        { id: { _serialized: localId }, timestamp: (nowMs - 2_000) / 1000 },
        { id: { _serialized: `false_123456789@lid_${localId}` }, timestamp: (nowMs - 1_000) / 1000 },
    ], nowMs, 10);

    assert.equal(selected.length, 1);
});

test("reconciliation accepts bounded history and rejects stale or future messages", () => {
    const nowMs = Date.parse("2026-07-22T06:00:00.000Z");
    assert.equal(isWhatsAppWebBridgeReconciliationMessageRecent({ timestampSeconds: (nowMs - 60_000) / 1000, nowMs }), true);
    assert.equal(isWhatsAppWebBridgeReconciliationMessageRecent({ timestampSeconds: (nowMs - 8 * 24 * 60 * 60_000) / 1000, nowMs }), false);
    assert.equal(isWhatsAppWebBridgeReconciliationMessageRecent({ timestampSeconds: (nowMs + 3 * 60_000) / 1000, nowMs }), false);
});
