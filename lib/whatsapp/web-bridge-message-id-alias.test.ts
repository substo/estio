import assert from "node:assert/strict";
import test from "node:test";

import {
    areWhatsAppWebBridgeMessageIdAliases,
    getWhatsAppWebBridgeLocalMessageId,
    isWhatsAppWebBridgeSerializedMessageId,
    selectCanonicalizableWhatsAppWebBridgeAlias,
} from "./web-bridge-message-id-alias";

test("recognizes a local WhatsApp Web message id inside its serialized id", () => {
    const localId = "3EB0LOCALMESSAGEID";
    const serializedId = `true_198247318593740@lid_${localId}`;

    assert.equal(getWhatsAppWebBridgeLocalMessageId(serializedId), localId);
    assert.equal(isWhatsAppWebBridgeSerializedMessageId(serializedId), true);
    assert.equal(areWhatsAppWebBridgeMessageIdAliases(localId, serializedId), true);
    assert.equal(areWhatsAppWebBridgeMessageIdAliases(serializedId, localId), true);
});

test("selects one exact safe alias and fails closed for ambiguous or app-originated rows", () => {
    const timestamp = new Date("2026-07-21T10:21:34.000Z");
    const localId = "3EB0LOCALMESSAGEID";
    const canonicalMessageId = `true_198247318593740@lid_${localId}`;
    const safe = {
        id: "safe",
        wamId: localId,
        body: "Ok",
        direction: "outbound",
        source: "whatsapp_web_bridge",
        createdAt: timestamp,
        clientMessageId: null,
        outboundWhatsAppOutbox: null,
    };

    assert.equal(selectCanonicalizableWhatsAppWebBridgeAlias({
        canonicalMessageId,
        body: " Ok ",
        timestamp,
        candidates: [safe],
    })?.id, "safe");
    assert.equal(selectCanonicalizableWhatsAppWebBridgeAlias({
        canonicalMessageId,
        body: "Ok",
        timestamp,
        candidates: [safe, { ...safe, id: "ambiguous" }],
    }), null);
    assert.equal(selectCanonicalizableWhatsAppWebBridgeAlias({
        canonicalMessageId,
        body: "Ok",
        timestamp,
        candidates: [{ ...safe, clientMessageId: "app-send", outboundWhatsAppOutbox: { id: "outbox" } }],
    }), null);
});

test("selects a safe inbound alias when the direction is explicit", () => {
    const timestamp = new Date("2026-07-22T19:32:29.000Z");
    const localId = "AC6169BDDF0CDA06B6ED6282B1E3F246";
    const safe = {
        id: "safe-inbound",
        wamId: localId,
        body: "Inbound update",
        direction: "inbound",
        source: "whatsapp_web_bridge",
        createdAt: timestamp,
        clientMessageId: null,
        outboundWhatsAppOutbox: null,
    };

    assert.equal(selectCanonicalizableWhatsAppWebBridgeAlias({
        canonicalMessageId: `false_123456789@lid_${localId}`,
        body: "Inbound update",
        timestamp,
        candidates: [safe],
        direction: "inbound",
    })?.id, "safe-inbound");
});

test("does not equate distinct local or serialized message ids", () => {
    assert.equal(areWhatsAppWebBridgeMessageIdAliases("3EB_FIRST", "3EB_SECOND"), false);
    assert.equal(
        areWhatsAppWebBridgeMessageIdAliases(
            "true_198247318593740@lid_3EB_FIRST",
            "true_198247318593740@lid_3EB_SECOND",
        ),
        false,
    );
    assert.equal(isWhatsAppWebBridgeSerializedMessageId("3EB_FIRST"), false);
});
