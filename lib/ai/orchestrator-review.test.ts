import test from "node:test";
import assert from "node:assert/strict";
import { shouldRequireHumanApproval } from "./review-gating";

test("shouldRequireHumanApproval returns true for high-risk intents", () => {
    const requireReview = shouldRequireHumanApproval("high", {
        approved: true,
        reviewRequired: false,
    });

    assert.equal(requireReview, true);
});

test("shouldRequireHumanApproval returns true for policy review-required warnings", () => {
    const requireReview = shouldRequireHumanApproval("medium", {
        approved: true,
        reviewRequired: true,
    });

    assert.equal(requireReview, true);
});

test("shouldRequireHumanApproval returns true for policy violations", () => {
    const requireReview = shouldRequireHumanApproval("medium", {
        approved: false,
        reviewRequired: false,
    });

    assert.equal(requireReview, true);
});

test("shouldRequireHumanApproval returns false for low risk and passing policy", () => {
    const requireReview = shouldRequireHumanApproval("low", {
        approved: true,
        reviewRequired: false,
    });

    assert.equal(requireReview, false);
});
