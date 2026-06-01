import assert from "node:assert/strict";
import test from "node:test";

import { buildPropertySourceText } from "./property-message-url-client";

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
