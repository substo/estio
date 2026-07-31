import assert from "node:assert/strict";
import test from "node:test";

import { assertPropertyPrintDraftWriteBoundary } from "./print-draft-boundary";

test("a print draft cannot be updated through another authorized property", () => {
    assert.throws(() => assertPropertyPrintDraftWriteBoundary({
        propertyId: "property-a",
        draftPropertyId: "property-b",
        selectedMediaIds: [],
        propertyMediaIds: [],
    }), /Print draft access denied/);
});

test("media from another property cannot be attached to a print draft", () => {
    assert.throws(() => assertPropertyPrintDraftWriteBoundary({
        propertyId: "property-a",
        draftPropertyId: "property-a",
        selectedMediaIds: ["media-a", "foreign-media"],
        propertyMediaIds: ["media-a"],
    }), /Print media access denied/);
});

test("same-property draft and media selections remain valid", () => {
    assert.doesNotThrow(() => assertPropertyPrintDraftWriteBoundary({
        propertyId: "property-a",
        draftPropertyId: "property-a",
        selectedMediaIds: ["media-a"],
        propertyMediaIds: ["media-a", "media-b"],
    }));
});
