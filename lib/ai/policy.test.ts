import test from "node:test";
import assert from "node:assert/strict";
import { validateAction } from "./policy";

test("policy flags language mismatch as violation", async () => {
    const result = await validateAction({
        intent: "DRAFT_REPLY",
        risk: "medium",
        actions: [],
        draftReply: "The owner is unlikely to accept below this level.",
        expectedLanguage: "el",
        draftLanguage: "en",
    });

    assert.equal(result.approved, false);
    assert.equal(result.violations.some(v => v.includes("language")), true);
});

test("policy blocks authority overreach when no authority evidence exists", async () => {
    const result = await validateAction({
        intent: "PRICE_NEGOTIATION",
        risk: "high",
        actions: [],
        draftReply: "I can confirm the owner has accepted your offer.",
        authoritySource: "none",
    });

    assert.equal(result.approved, false);
    assert.equal(result.violations.some(v => v.includes("authority")), true);
});

test("policy blocks false finality without reservation/deposit confirmation", async () => {
    const result = await validateAction({
        intent: "PRICE_NEGOTIATION",
        risk: "medium",
        actions: [],
        draftReply: "The deal is closed and the property is gone.",
        hasConfirmedReservation: false,
        hasConfirmedDeposit: false,
    });

    assert.equal(result.approved, false);
    assert.equal(result.violations.some(v => v.includes("finality")), true);
});

test("policy marks unverified urgency as review-required warning", async () => {
    const result = await validateAction({
        intent: "PROPERTY_QUESTION",
        risk: "medium",
        actions: [],
        draftReply: "There is another offer in progress, act now.",
        hasCompetingOfferEvidence: false,
    });

    assert.equal(result.approved, true);
    assert.equal(result.reviewRequired, true);
    assert.equal(result.warnings.some(v => v.includes("urgency")), true);
});
