import assert from "node:assert/strict";
import test from "node:test";
import { createPropertyThumbnailUrl, verifyPropertyThumbnailToken } from "./property-thumbnail";

test("property thumbnail tokens are signed and expire", () => {
    process.env.PROPERTY_PREVIEW_SIGNING_SECRET = "test-signing-secret";
    const path = createPropertyThumbnailUrl("https://images.example/photo.jpg", 1000);
    const parsed = new URL(path, "https://estio.test");
    const token = parsed.searchParams.get("token") || "";
    const signature = parsed.searchParams.get("signature") || "";
    assert.deepEqual(verifyPropertyThumbnailToken(token, signature, 1001), {
        url: "https://images.example/photo.jpg",
        exp: 4600,
    });
    assert.equal(verifyPropertyThumbnailToken(token, signature, 4601), null);
    assert.equal(verifyPropertyThumbnailToken(token, `${signature}x`, 1001), null);
});
