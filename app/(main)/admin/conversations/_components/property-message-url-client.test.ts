import assert from "node:assert/strict";
import test from "node:test";

import {
    buildPropertySourceText,
    parsePropertyUrls,
} from "./property-message-url-client";

test("buildPropertySourceText combines extracted page text and pasted agent text", () => {
    const text = buildPropertySourceText({
        extractedText: "Title: Villa\nPrice: EUR 500000",
        pastedText: "Client asked for sea view.",
    });

    assert.match(text, /Extracted property page text:/);
    assert.match(text, /Title: Villa/);
    assert.match(text, /Agent pasted property text:/);
    assert.match(text, /Client asked for sea view/);
});

test("buildPropertySourceText omits empty sections", () => {
    assert.equal(buildPropertySourceText({ extractedText: "  ", pastedText: "Manual note" }), "Agent pasted property text:\nManual note");
});

test("parsePropertyUrls extracts newline comma and space separated URLs", () => {
    const parsed = parsePropertyUrls(`
        https://example.com/a
        https://example.com/b, https://example.com/c
        note https://example.com/d.
    `);

    assert.deepEqual(parsed, {
        urls: [
            "https://example.com/a",
            "https://example.com/b",
            "https://example.com/c",
            "https://example.com/d",
        ],
        overflowCount: 0,
    });
});

test("parsePropertyUrls dedupes and caps URL list", () => {
    const parsed = parsePropertyUrls([
        "https://example.com/a",
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
        "https://example.com/d",
        "https://example.com/e",
        "https://example.com/f",
    ].join("\n"));

    assert.deepEqual(parsed.urls, [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
        "https://example.com/d",
        "https://example.com/e",
    ]);
    assert.equal(parsed.overflowCount, 1);
});

test("buildPropertySourceText labels multiple extracted property options", () => {
    const text = buildPropertySourceText({
        sources: [
            { url: "https://example.com/a", title: "Flat A", sourceText: "Two bedrooms" },
            { url: "https://example.com/b", title: "Flat B", sourceText: "Sea view" },
        ],
        pastedText: "Client wants Limassol.",
    });

    assert.match(text, /Property option 1/);
    assert.match(text, /URL: https:\/\/example.com\/a/);
    assert.match(text, /Title: Flat B/);
    assert.match(text, /Agent pasted property text:/);
});
