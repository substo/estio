import assert from "node:assert/strict";
import test from "node:test";
import { prepareWhatsAppWebBridgeWebhookPayload } from "./web-bridge-payload";

test("prepareWhatsAppWebBridgeWebhookPayload leaves small payloads unchanged", () => {
    const payload = {
        event: "message",
        locationId: "loc_1",
        sessionId: "estio_loc_1",
        message: { id: "wam_1", body: "hello" },
    };

    const result = prepareWhatsAppWebBridgeWebhookPayload({
        payload,
        maxBodyBytes: 10_000,
    });

    assert.equal(result.omittedInlineMedia, false);
    assert.equal(result.payload, payload);
    assert.equal(JSON.parse(result.body).message.body, "hello");
    assert.equal(result.bodyBytes, result.originalBodyBytes);
});

test("prepareWhatsAppWebBridgeWebhookPayload omits inline media when final JSON body is too large", () => {
    const payload = {
        event: "message",
        locationId: "loc_1",
        sessionId: "estio_loc_1",
        message: {
            id: "wam_1",
            body: "see attached",
            hasMedia: true,
            mediaMeta: {
                mimetype: "image/jpeg",
                filename: "photo.jpg",
                size: 900,
                inlined: true,
            },
            media: {
                mimetype: "image/jpeg",
                filename: "photo.jpg",
                size: 900,
                data: "x".repeat(2_000),
            },
        },
    };

    const result = prepareWhatsAppWebBridgeWebhookPayload({
        payload,
        maxBodyBytes: 1_000,
    });
    const parsed = JSON.parse(result.body);

    assert.equal(result.omittedInlineMedia, true);
    assert.ok(result.originalBodyBytes > 1_000);
    assert.ok(result.bodyBytes < result.originalBodyBytes);
    assert.equal(parsed.message.body, "see attached");
    assert.equal(parsed.message.media.data, undefined);
    assert.equal(parsed.message.media.mimetype, "image/jpeg");
    assert.equal(parsed.message.mediaMeta.inlined, false);
    assert.equal(parsed.message.mediaMeta.omittedFromWebhook, true);
    assert.equal(parsed.message.mediaError.code, "webhook_payload_too_large");
    assert.equal(parsed.message.mediaError.payloadBytes, result.originalBodyBytes);
});

test("prepareWhatsAppWebBridgeWebhookPayload preserves existing media errors", () => {
    const payload = {
        event: "message_create",
        locationId: "loc_1",
        sessionId: "estio_loc_1",
        message: {
            id: "wam_2",
            hasMedia: true,
            mediaError: { code: "download_failed", message: "original error" },
            media: {
                mimetype: "audio/ogg",
                data: "x".repeat(2_000),
            },
        },
    };

    const result = prepareWhatsAppWebBridgeWebhookPayload({
        payload,
        maxBodyBytes: 1_000,
    });
    const parsed = JSON.parse(result.body);

    assert.equal(result.omittedInlineMedia, true);
    assert.deepEqual(parsed.message.mediaError, { code: "download_failed", message: "original error" });
    assert.equal(parsed.message.media.data, undefined);
});
