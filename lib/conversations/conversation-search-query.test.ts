import test from "node:test";
import assert from "node:assert/strict";
import { analyzeConversationSearchQuery } from "./conversation-search-query";

test("classifies letter-digit property references separately from phone searches", () => {
    const result = analyzeConversationSearchQuery("DT2889");

    assert.equal(result.normalizedQuery, "DT2889");
    assert.equal(result.queryDigits, "2889");
    assert.equal(result.structuredReferenceQuery, true);
    assert.equal(result.phoneLikeQuery, false);
});

test("classifies digit and punctuation queries as phone-like", () => {
    const result = analyzeConversationSearchQuery("+357 94 006 663");

    assert.equal(result.queryDigits, "35794006663");
    assert.equal(result.structuredReferenceQuery, false);
    assert.equal(result.phoneLikeQuery, true);
});

test("does not run structured reference mode for normal contact names", () => {
    const result = analyzeConversationSearchQuery("Maria Green");

    assert.equal(result.queryDigits, "");
    assert.equal(result.structuredReferenceQuery, false);
    assert.equal(result.phoneLikeQuery, false);
});
