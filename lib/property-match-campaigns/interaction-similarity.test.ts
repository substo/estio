import test from "node:test";
import assert from "node:assert/strict";
import { comparePropertyToInteractionProfile } from "./interaction-similarity";

const currentProperty = {
  goal: "Sale",
  type: "Apartment",
  price: 220000,
  bedrooms: 2,
  areaSqm: 85,
  city: "Paphos",
  propertyLocation: "Kato Paphos",
};

function example(overrides: Record<string, unknown> = {}) {
  return {
    eventType: "liked",
    sentiment: "positive",
    reason: "interested",
    occurredAt: "2026-07-18T10:00:00.000Z",
    property: {
      id: "prop_old",
      reference: "DT5000",
      title: "Previous apartment",
      goal: "Sale",
      type: "Apartment",
      price: 210000,
      bedrooms: 2,
      areaSqm: 82,
      city: "Paphos",
      propertyLocation: "Kato Paphos",
      propertyArea: null,
      condition: null,
      features: [],
      ...overrides,
    },
  };
}

test("interaction similarity grounds a new listing in a positively received property", () => {
  const result = comparePropertyToInteractionProfile(currentProperty, {
    positiveExamples: [example()],
    negativeExamples: [],
  } as any);

  assert.equal(result.positiveMatches.length, 1);
  assert.equal(result.positiveMatches[0].reference, "DT5000");
  assert.ok(result.positiveMatches[0].matchedFields.includes("location"));
  assert.ok(result.positiveMatches[0].matchedFields.includes("price"));
  assert.equal(result.hasPositiveGrounding, true);
});

test("neutral sent-property exposure is not part of interaction similarity", () => {
  const result = comparePropertyToInteractionProfile(currentProperty, {
    sentPropertyReferences: ["DT5000"],
    positiveExamples: [],
    negativeExamples: [],
  } as any);

  assert.equal(result.positiveMatches.length, 0);
  assert.equal(result.negativeCautions.length, 0);
});

test("price rejection remains a caution only when the new property is similarly expensive", () => {
  const rejected = {
    ...example(),
    eventType: "rejected",
    sentiment: "negative",
    reason: "price_rejection",
  };
  const similarPrice = comparePropertyToInteractionProfile(currentProperty, {
    positiveExamples: [],
    negativeExamples: [rejected],
  } as any);
  const muchCheaper = comparePropertyToInteractionProfile({ ...currentProperty, price: 140000 }, {
    positiveExamples: [],
    negativeExamples: [rejected],
  } as any);

  assert.equal(similarPrice.negativeCautions.length, 1);
  assert.equal(similarPrice.requiresReview, true);
  assert.equal(muchCheaper.negativeCautions.length, 0);
});

test("different property shape does not become a similarity signal", () => {
  const result = comparePropertyToInteractionProfile(currentProperty, {
    positiveExamples: [example({
      type: "Villa",
      price: 700000,
      bedrooms: 5,
      areaSqm: 300,
      city: "Limassol",
      propertyLocation: "Germasogeia",
    })],
    negativeExamples: [],
  } as any);

  assert.equal(result.positiveMatches.length, 0);
});
