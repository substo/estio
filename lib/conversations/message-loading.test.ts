import assert from "node:assert/strict";
import test from "node:test";

import { groupWebBridgeImageMediaPlaceholdersForDisplay } from "./message-loading";

function failedImageMessage(overrides: Record<string, any> = {}) {
    return {
        id: "msg_1",
        wamId: "wam_1",
        source: "whatsapp_web_bridge",
        type: "WhatsApp",
        direction: "inbound",
        body: "[Image]",
        dateAdded: "2026-07-15T18:56:17.000Z",
        attachments: [],
        webBridgeMedia: {
            status: "failed",
            reason: "download_failed",
            error: "r",
            meta: {
                type: "image",
                mimetype: "image/jpeg",
                size: 67_847,
            },
        },
        ...overrides,
    };
}

test("groupWebBridgeImageMediaPlaceholdersForDisplay groups adjacent failed image placeholders", () => {
    const grouped = groupWebBridgeImageMediaPlaceholdersForDisplay([
        failedImageMessage({
            id: "caption",
            wamId: "wam_caption",
            body: "Hello. The apt is now available to view and sell",
        }),
        failedImageMessage({
            id: "image_2",
            wamId: "wam_2",
            dateAdded: "2026-07-15T18:56:18.000Z",
            webBridgeMedia: {
                status: "failed",
                reason: "download_failed",
                error: "r",
                meta: { type: "image", mimetype: "image/jpeg", size: 111_631 },
            },
        }),
        failedImageMessage({
            id: "image_3",
            wamId: "wam_3",
            dateAdded: "2026-07-15T18:56:24.000Z",
            webBridgeMedia: {
                status: "failed",
                reason: "download_failed",
                error: "r",
                meta: { type: "image", mimetype: "image/jpeg", size: 105_835 },
            },
        }),
        {
            id: "text_after_album",
            source: "whatsapp_web_bridge",
            type: "WhatsApp",
            direction: "inbound",
            body: "249k",
            dateAdded: "2026-07-15T18:56:24.000Z",
            attachments: [],
            webBridgeMedia: null,
        },
    ]);

    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].id, "caption");
    assert.equal(grouped[0].body, "Hello. The apt is now available to view and sell");
    assert.equal(grouped[0].webBridgeMedia.group.count, 3);
    assert.deepEqual(grouped[0].webBridgeMedia.group.messageIds, ["caption", "image_2", "image_3"]);
    assert.deepEqual(
        grouped[0].webBridgeMedia.group.items.map((item: any) => item.wamId),
        ["wam_caption", "wam_2", "wam_3"]
    );
    assert.equal(grouped[1].id, "text_after_album");
});

test("groupWebBridgeImageMediaPlaceholdersForDisplay does not group stored media or distant images", () => {
    const grouped = groupWebBridgeImageMediaPlaceholdersForDisplay([
        failedImageMessage({ id: "image_1" }),
        failedImageMessage({
            id: "stored",
            dateAdded: "2026-07-15T18:56:18.000Z",
            webBridgeMedia: {
                status: "stored",
                meta: { type: "image", mimetype: "image/jpeg" },
            },
        }),
        failedImageMessage({
            id: "distant",
            dateAdded: "2026-07-15T18:57:00.000Z",
        }),
    ]);

    assert.equal(grouped.length, 3);
    assert.equal(grouped[0].webBridgeMedia.group, undefined);
    assert.equal(grouped[1].webBridgeMedia.group, undefined);
    assert.equal(grouped[2].webBridgeMedia.group, undefined);
});
