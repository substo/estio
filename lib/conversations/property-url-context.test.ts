import assert from "node:assert/strict";
import test from "node:test";

import {
    extractPropertyUrlContext,
    validatePublicHttpUrl,
} from "./property-url-context";

test("extractPropertyUrlContext extracts title, meta description, price, and visible body text", async () => {
    const html = `
        <html>
            <head>
                <title>Ignored title</title>
                <meta property="og:title" content="Sea View Apartment" />
                <meta property="og:image" content="/images/sea-view.jpg" />
                <meta property="og:site_name" content="Example Estates" />
                <meta name="description" content="Two bedroom apartment near the sea." />
                <meta itemprop="price" content="1200" />
                <meta itemprop="priceCurrency" content="EUR" />
                <style>.hidden{display:none}</style>
                <script>window.noisy = true;</script>
            </head>
            <body>
                <nav>Menu text</nav>
                <main>
                    <h1>Sea View Apartment</h1>
                    <p>Located in Limassol with covered parking and balcony.</p>
                </main>
            </body>
        </html>
    `;

    const result = await extractPropertyUrlContext("https://example.com/listing", {
        skipPublicUrlValidation: true,
        fetchImpl: async () => new Response(html, {
            status: 200,
            headers: { "content-type": "text/html" },
        }),
    });

    assert.equal(result.success, true);
    assert.equal(result.title, "Sea View Apartment");
    assert.equal(result.description, "Two bedroom apartment near the sea.");
    assert.equal(result.imageUrl, "https://example.com/images/sea-view.jpg");
    assert.equal(result.siteName, "Example Estates");
    assert.match(result.sourceText || "", /Description: Two bedroom apartment near the sea/);
    assert.match(result.sourceText || "", /Price: EUR 1200/);
    assert.match(result.sourceText || "", /covered parking and balcony/);
    assert.doesNotMatch(result.sourceText || "", /Menu text/);
    assert.doesNotMatch(result.sourceText || "", /window.noisy/);
});

test("extractPropertyUrlContext rejects non-readable content types", async () => {
    const result = await extractPropertyUrlContext("https://example.com/file.pdf", {
        skipPublicUrlValidation: true,
        fetchImpl: async () => new Response("pdf", {
            status: 200,
            headers: { "content-type": "application/pdf" },
        }),
    });

    assert.equal(result.success, false);
    assert.match(result.error || "", /readable page text/);
});

test("extractPropertyUrlContext limits oversized page text", async () => {
    const result = await extractPropertyUrlContext("https://example.com/large", {
        skipPublicUrlValidation: true,
        fetchImpl: async () => new Response(`<main>${"large text ".repeat(2000)}</main>`, {
            status: 200,
            headers: { "content-type": "text/html" },
        }),
    });

    assert.equal(result.success, true);
    assert.ok((result.sourceText || "").length <= 8000);
});

test("validatePublicHttpUrl rejects private and non-http URLs", async () => {
    assert.deepEqual(await validatePublicHttpUrl("ftp://example.com/a"), {
        ok: false,
        error: "Only http and https URLs are supported.",
    });
    assert.deepEqual(await validatePublicHttpUrl("http://127.0.0.1:3000/a"), {
        ok: false,
        error: "Private network URLs are not supported.",
    });
    assert.deepEqual(await validatePublicHttpUrl("http://10.0.0.1/a"), {
        ok: false,
        error: "Private network URLs are not supported.",
    });
    assert.deepEqual(await validatePublicHttpUrl("http://localhost:3000/a"), {
        ok: false,
        error: "Local URLs are not supported.",
    });
});

test("extractPropertyUrlContext validates redirects and resolves metadata from the final URL", async () => {
    const calls: string[] = [];
    const result = await extractPropertyUrlContext("https://example.com/old", {
        skipPublicUrlValidation: true,
        fetchImpl: async (input) => {
            const url = String(input);
            calls.push(url);
            if (url.endsWith("/old")) {
                return new Response(null, { status: 302, headers: { location: "https://listings.example/new/page" } });
            }
            return new Response('<meta property="og:image" content="../photo.jpg"><main>Listing details</main>', {
                status: 200,
                headers: { "content-type": "text/html" },
            });
        },
    });

    assert.equal(result.success, true);
    assert.equal(result.url, "https://listings.example/new/page");
    assert.equal(result.imageUrl, "https://listings.example/photo.jpg");
    assert.deepEqual(calls, ["https://example.com/old", "https://listings.example/new/page"]);
});

test("extractPropertyUrlContext rejects a redirect to a private address", async () => {
    let fetchCount = 0;
    const result = await extractPropertyUrlContext("https://example.com/old", {
        fetchImpl: async () => {
            fetchCount += 1;
            return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
        },
    });

    assert.equal(result.success, false);
    assert.match(result.error || "", /Private network URLs/);
    assert.equal(fetchCount, 1);
});
