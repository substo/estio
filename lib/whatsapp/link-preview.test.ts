import assert from "node:assert/strict";
import test from "node:test";
import {
    extractFirstHttpUrl,
    getWhatsAppLinkPreviewDecision,
} from "./link-preview";

test("extractFirstHttpUrl returns the first HTTP(S) URL", () => {
    assert.equal(extractFirstHttpUrl("Visit https://example.com/listing"), "https://example.com/listing");
    assert.equal(extractFirstHttpUrl("One http://example.com/a two https://example.com/b"), "http://example.com/a");
});

test("extractFirstHttpUrl trims punctuation commonly adjacent to prose", () => {
    assert.equal(extractFirstHttpUrl("See https://example.com/listing."), "https://example.com/listing");
    assert.equal(extractFirstHttpUrl("(https://example.com/listing), thanks"), "https://example.com/listing");
});

test("extractFirstHttpUrl ignores non-http schemes, bare domains, and empty text", () => {
    assert.equal(extractFirstHttpUrl("mailto:hello@example.com"), null);
    assert.equal(extractFirstHttpUrl("example.com/listing"), null);
    assert.equal(extractFirstHttpUrl(""), null);
    assert.equal(extractFirstHttpUrl(null), null);
});

test("getWhatsAppLinkPreviewDecision exposes host-safe diagnostics", () => {
    assert.deepEqual(getWhatsAppLinkPreviewDecision("Look https://www.example.com/path?token=secret"), {
        shouldRequestPreview: true,
        url: "https://www.example.com/path?token=secret",
        host: "www.example.com",
    });
    assert.deepEqual(getWhatsAppLinkPreviewDecision("plain text"), {
        shouldRequestPreview: false,
        url: null,
        host: null,
    });
});
