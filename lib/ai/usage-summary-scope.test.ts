import assert from "node:assert/strict";
import test from "node:test";
import {
    buildAiUsageSummaryScope,
    canAccessAiUsageView,
} from "./usage-summary-scope";

test("personal usage is available to every authenticated location member", () => {
    assert.equal(canAccessAiUsageView("user", false), true);
});

test("location usage is limited to location admins", () => {
    assert.equal(canAccessAiUsageView("location", false), false);
    assert.equal(canAccessAiUsageView("location", true), true);
});

test("current-user AI usage is constrained by both location and user", () => {
    assert.deepEqual(buildAiUsageSummaryScope("location-1", "user-1"), {
        locationId: "location-1",
        userId: "user-1",
    });
});

test("location-wide AI usage remains available without a user constraint", () => {
    assert.deepEqual(buildAiUsageSummaryScope("location-1"), {
        locationId: "location-1",
    });
});
