import assert from "node:assert/strict";
import test from "node:test";
import {
    getMessageLinkPreviewCandidate,
    getPreviewHost,
} from "./message-link-preview-actions";

test("getMessageLinkPreviewCandidate returns the first URL and overflow count", () => {
    assert.deepEqual(getMessageLinkPreviewCandidate({
        body: "One https://example.com/a and two https://example.com/b",
    }), {
        url: "https://example.com/a",
        overflowCount: 1,
    });
});

test("getMessageLinkPreviewCandidate ignores unsupported message surfaces", () => {
    assert.equal(getMessageLinkPreviewCandidate({ body: "https://example.com", isEmail: true }), null);
    assert.equal(getMessageLinkPreviewCandidate({ body: "https://example.com", isContactMessage: true }), null);
    assert.equal(getMessageLinkPreviewCandidate({ body: "https://example.com", hasRenderableMediaAttachment: true }), null);
    assert.equal(getMessageLinkPreviewCandidate({ body: "plain text" }), null);
});

test("getPreviewHost normalizes hosts", () => {
    assert.equal(getPreviewHost("https://www.downtowncyprus.com/path"), "downtowncyprus.com");
    assert.equal(getPreviewHost("bad"), "");
});
