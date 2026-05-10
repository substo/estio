import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
    buildCloudMediaPayload,
    buildCloudTemplatePayload,
    buildCloudTextPayload,
    inferWhatsAppCoexistenceEnabled,
    mapWhatsAppCloudStatus,
    verifyWhatsAppWebhookSignature,
} from "./client";

test("buildCloudTextPayload normalizes recipients and text shape", () => {
    assert.deepEqual(buildCloudTextPayload("+1 (555) 123-4567", "hello"), {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "15551234567",
        type: "text",
        text: {
            preview_url: false,
            body: "hello",
        },
    });
});

test("buildCloudMediaPayload supports document metadata", () => {
    const payload = buildCloudMediaPayload("+357 99 000000", {
        mediaType: "document",
        mediaUrl: "https://example.com/file.pdf",
        caption: "Lease",
        fileName: "lease.pdf",
    });

    assert.equal(payload.to, "35799000000");
    assert.equal(payload.type, "document");
    assert.deepEqual(payload.document, {
        link: "https://example.com/file.pdf",
        caption: "Lease",
        filename: "lease.pdf",
    });
});

test("buildCloudTemplatePayload emits Meta template message shape", () => {
    const payload = buildCloudTemplatePayload("+35799000000", {
        name: "viewing_confirmation",
        language: "en_US",
        components: [{
            type: "body",
            parameters: [{ type: "text", text: "Tuesday" }],
        }],
    });

    assert.equal(payload.type, "template");
    assert.equal(payload.template.name, "viewing_confirmation");
    assert.equal(payload.template.language.code, "en_US");
    assert.equal(payload.template.components?.[0]?.parameters?.[0]?.text, "Tuesday");
});

test("verifyWhatsAppWebhookSignature validates sha256 header", () => {
    const rawBody = JSON.stringify({ entry: [{ id: "1" }] });
    const secret = "top-secret";
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;

    assert.equal(verifyWhatsAppWebhookSignature(rawBody, signature, secret), true);
    assert.equal(verifyWhatsAppWebhookSignature(rawBody, "sha256=bad", secret), false);
});

test("mapWhatsAppCloudStatus keeps delivery state vocabulary", () => {
    assert.equal(mapWhatsAppCloudStatus("sent"), "sent");
    assert.equal(mapWhatsAppCloudStatus("delivered"), "delivered");
    assert.equal(mapWhatsAppCloudStatus("read"), "read");
    assert.equal(mapWhatsAppCloudStatus("failed"), "failed");
});

test("inferWhatsAppCoexistenceEnabled detects Business App platform", () => {
    assert.equal(inferWhatsAppCoexistenceEnabled({ platform_type: "BUSINESS_APP" }), true);
    assert.equal(inferWhatsAppCoexistenceEnabled({ platform_type: "CLOUD_API" }), false);
});
