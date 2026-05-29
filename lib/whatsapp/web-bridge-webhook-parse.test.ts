import assert from "node:assert/strict";
import test from "node:test";
import { parseWhatsAppWebBridgeWebhookBody } from "./web-bridge-webhook-parse";

test("parseWhatsAppWebBridgeWebhookBody parses valid bridge JSON", () => {
    const result = parseWhatsAppWebBridgeWebhookBody({
        rawBody: JSON.stringify({ event: "ready", locationId: "loc_1", sessionId: "estio_loc_1" }),
        contentType: "application/json",
        contentLength: "67",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.body.event, "ready");
        assert.equal(result.body.locationId, "loc_1");
        assert.ok(result.rawBodyLength > 0);
    }
});

test("parseWhatsAppWebBridgeWebhookBody returns structured metadata for truncated JSON", () => {
    const result = parseWhatsAppWebBridgeWebhookBody({
        rawBody: "{\"event\":\"message\",\"locationId\":\"loc_1\",\"message\":\"unterminated",
        contentType: "application/json",
        contentLength: "999",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.status, 400);
        assert.equal(result.responseBody.code, "invalid_json");
        assert.equal(result.responseBody.contentLength, "999");
        assert.equal(result.responseBody.contentType, "application/json");
        assert.equal(result.responseBody.receivedBodyBytes, result.logMetadata.receivedBodyBytes);
        assert.match(result.responseBody.bodySha256, /^[a-f0-9]{64}$/);
        assert.match(result.responseBody.parseError, /JSON|Unterminated|Expected|Unexpected/i);
        assert.ok(result.logMetadata.bodyStart.includes("\"event\":\"message\""));
        assert.ok(result.logMetadata.bodyEnd.includes("unterminated"));
    }
});
