import assert from "node:assert/strict";
import test from "node:test";

import { uploadToCloudflare, uploadUrlToCloudflare } from "./cloudflareImages";

test("server-side Cloudflare uploads serialize trusted ownership metadata", async () => {
    const originalFetch = globalThis.fetch;
    const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const originalToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;
    const capturedMetadata: unknown[] = [];

    process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
    process.env.CLOUDFLARE_IMAGES_API_TOKEN = "token";
    globalThis.fetch = async (_url, init) => {
        const body = init?.body;
        assert.ok(body instanceof FormData);
        capturedMetadata.push(JSON.parse(String(body.get("metadata"))));
        return new Response(JSON.stringify({
            success: true,
            result: { id: `image-${capturedMetadata.length}`, uploadURL: "" },
            errors: [],
            messages: [],
        }), { headers: { "Content-Type": "application/json" } });
    };

    try {
        await uploadToCloudflare(new Blob(["image"]), {
            metadata: { locationId: "location-a", uploadedBy: "db-user-a", workflow: "property_editor" },
        });
        await uploadUrlToCloudflare("https://images.example/property.jpg", {
            metadata: { locationId: "location-a", workflow: "property_feed_sync" },
        });
        assert.deepEqual(capturedMetadata, [
            { locationId: "location-a", uploadedBy: "db-user-a", workflow: "property_editor" },
            { locationId: "location-a", workflow: "property_feed_sync" },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
        else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
        if (originalToken === undefined) delete process.env.CLOUDFLARE_IMAGES_API_TOKEN;
        else process.env.CLOUDFLARE_IMAGES_API_TOKEN = originalToken;
    }
});
