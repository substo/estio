import test from "node:test";
import assert from "node:assert/strict";
import {
    formatHistoryFieldName,
    formatHistoryValue,
    parseHistoryChanges,
    summarizeRequirementChanges,
} from "./history-formatting";

test("parseHistoryChanges unwraps AI requirement update payload", () => {
    const changes = parseHistoryChanges({
        proposalId: "proposal_123",
        changes: [
            { field: "requirementDistrict", old: null, new: "Paphos" },
            { field: "requirementBedrooms", old: "2", new: "3" },
        ],
    }, "AI_REQUIREMENTS_UPDATED");

    assert.deepEqual(changes, [
        { field: "requirementDistrict", old: null, new: "Paphos" },
        { field: "requirementBedrooms", old: "2", new: "3" },
    ]);
});

test("requirement history helpers format user-facing labels and summaries", () => {
    const changes = parseHistoryChanges(JSON.stringify({
        proposalId: "proposal_123",
        changes: [
            { field: "requirementMinPrice", old: null, new: "200000" },
            { field: "requirementPropertyTypes", old: [], new: ["Apartment", "Villa"] },
            { field: "requirementSummary", old: null, new: "Client wants sea view." },
            { field: "requirementCondition", old: null, new: "Resale" },
        ],
    }), "AI_REQUIREMENTS_UPDATED");

    assert.equal(formatHistoryFieldName(changes[0].field), "Min budget");
    assert.equal(formatHistoryValue(changes[1].new), "Apartment, Villa");
    assert.equal(summarizeRequirementChanges(changes), "Updated Min budget, Property types, Summary and 1 more");
});

test("parseHistoryChanges keeps normal object history compatible", () => {
    assert.deepEqual(parseHistoryChanges({ entry: "Call back", date: "2026-06-02" }, "MANUAL_ENTRY"), [
        { field: "entry", old: null, new: "Call back" },
        { field: "date", old: null, new: "2026-06-02" },
    ]);
});
