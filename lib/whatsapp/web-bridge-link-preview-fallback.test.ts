import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { fetchWhatsAppWebBridgeOpenGraphPreview } from "./web-bridge-link-preview-fallback";

test("Open Graph fallback produces a bounded raw JPEG thumbnail", async () => {
    const image = await sharp({
        create: {
            width: 640,
            height: 360,
            channels: 3,
            background: "#336699",
        },
    }).png().toBuffer();
    const calls: string[] = [];
    const preview = await fetchWhatsAppWebBridgeOpenGraphPreview(
        "https://www.example.com/listing",
        {
            skipPublicUrlValidation: true,
            fetchImpl: async (input) => {
                const url = String(input);
                calls.push(url);
                if (url.endsWith("/listing")) {
                    return new Response(`
                        <html>
                            <head>
                                <title>Sea View Listing</title>
                                <meta name="description" content="A bounded preview description." />
                                <meta property="og:image" content="/listing.jpg" />
                            </head>
                            <body><main>Listing details</main></body>
                        </html>
                    `, {
                        status: 200,
                        headers: { "content-type": "text/html" },
                    });
                }
                return new Response(new Uint8Array(image), {
                    status: 200,
                    headers: {
                        "content-type": "image/png",
                        "content-length": String(image.length),
                    },
                });
            },
        },
    );

    assert.deepEqual(calls, [
        "https://www.example.com/listing",
        "https://www.example.com/listing.jpg",
    ]);
    assert.equal(preview?.title, "Sea View Listing");
    assert.equal(preview?.description, "A bounded preview description.");
    assert.equal(typeof preview?.thumbnail, "string");
    assert.match(String(preview?.thumbnail), /^\/9j\//);
    assert.ok(String(preview?.thumbnail).length < 128 * 1024 * 4 / 3);
});

test("Open Graph fallback fails closed without a supported public image", async () => {
    const preview = await fetchWhatsAppWebBridgeOpenGraphPreview(
        "https://www.example.com/listing",
        {
            skipPublicUrlValidation: true,
            fetchImpl: async () => new Response(
                "<title>Listing</title><main>Details</main>",
                { status: 200, headers: { "content-type": "text/html" } },
            ),
        },
    );
    assert.equal(preview, null);
});
