import assert from "node:assert/strict";
import test from "node:test";

import {
    calculateNormalizedEditDistance,
    shouldRecordMaterialFeedback,
} from "./agent-feedback";

test("calculateNormalizedEditDistance treats whitespace and case as equivalent", () => {
    assert.equal(calculateNormalizedEditDistance(" Hello   There ", "hello there"), 0);
});

test("shouldRecordMaterialFeedback ignores unchanged AI drafts", () => {
    assert.equal(shouldRecordMaterialFeedback({
        aiOutput: "Can we arrange a viewing tomorrow?",
        humanOutput: "Can we arrange a viewing tomorrow?",
    }), false);
});

test("shouldRecordMaterialFeedback records materially edited AI drafts", () => {
    assert.equal(shouldRecordMaterialFeedback({
        aiOutput: "I would be delighted to assist with your property search and can share several options.",
        humanOutput: "Send me your budget and preferred area.",
    }), true);
});

test("shouldRecordMaterialFeedback records explicit ratings even without an edit", () => {
    assert.equal(shouldRecordMaterialFeedback({
        aiOutput: "Can we arrange a viewing tomorrow?",
        humanOutput: "Can we arrange a viewing tomorrow?",
        rating: "down",
    }), true);
});
