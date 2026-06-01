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
