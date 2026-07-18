import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContactPropertyMatchProfile,
  resolveContactPropertyMatchProfile,
} from "./profile";

test("broad verified contacts remain sparse and sent properties are neutral", () => {
  const profile = buildContactPropertyMatchProfile({
    updatedAt: "2026-07-18T10:00:00.000Z",
    contactType: "Lead",
    profileVerificationStatus: "verified_lead",
    leadGoal: "To Buy",
    requirementDistrict: "Any District",
    requirementBedrooms: "Any Bedrooms",
    requirementMinPrice: "Any",
    requirementMaxPrice: "Any",
    propertiesEmailed: ["DT100", "DT101"],
  });

  assert.equal(profile.status, "sparse");
  assert.equal(profile.requirements.anchorCount, 0);
  assert.deepEqual(profile.interactions.sentPropertyReferences, ["DT100", "DT101"]);
  assert.equal(profile.interactions.positiveCount, 0);
  assert.match(profile.interactionSummary, /neutral exposure/i);
});

test("assessed requirements become current hard criteria", () => {
  const profile = buildContactPropertyMatchProfile({
    updatedAt: "2026-07-18T10:00:00.000Z",
    contactType: "Lead",
    profileVerificationStatus: "verified_lead",
    leadGoal: "To Buy",
    requirementDistrict: "Paphos",
    requirementBedrooms: "2+ Bedrooms",
    requirementMaxPrice: "€300,000",
    requirementPropertyTypes: ["Apartment"],
    requirementPropertyLocations: ["Kato Paphos", "Universal"],
    requirementsLastAssessedAt: "2026-07-17T10:00:00.000Z",
  });

  assert.equal(profile.status, "ready");
  assert.equal(profile.requirements.freshness, "assessed");
  assert.equal(profile.requirements.district.certainty, "hard");
  assert.equal(profile.requirements.maxPrice.certainty, "hard");
  assert.ok(profile.requirements.anchorCount >= 4);
});

test("agent identity and stopped-search evidence make the profile ineligible", () => {
  const profile = buildContactPropertyMatchProfile({
    contactType: "Agent",
    profileVerificationStatus: "likely_agent",
    requirementSummary: "Please stop sending properties. We are no longer searching.",
  });

  assert.equal(profile.status, "ineligible");
  assert.equal(profile.eligibility.status, "ineligible");
  assert.ok(profile.eligibility.reasons.length >= 2);
});

test("interaction ledger separates exposure from positive and negative feedback", () => {
  const profile = buildContactPropertyMatchProfile({
    contactType: "Lead",
    profileVerificationStatus: "verified_lead",
  }, [
    { eventType: "sent", sentiment: "neutral", propertyReference: "DT200", occurredAt: "2026-07-16T10:00:00.000Z" },
    {
      eventType: "liked",
      sentiment: "positive",
      propertyReference: "DT201",
      occurredAt: "2026-07-17T10:00:00.000Z",
      property: { id: "prop_201", reference: "DT201", type: "Apartment", price: 200000, bedrooms: 2, propertyLocation: "Peyia" },
    },
    {
      eventType: "rejected",
      sentiment: "negative",
      propertyReference: "DT202",
      occurredAt: "2026-07-18T10:00:00.000Z",
      evidence: { reason: "price_rejection" },
      property: { id: "prop_202", reference: "DT202", type: "Villa", price: 600000, bedrooms: 4, propertyLocation: "Tala" },
    },
  ]);

  assert.deepEqual(profile.interactions.sentPropertyReferences, ["DT200"]);
  assert.deepEqual(profile.interactions.positivePropertyReferences, ["DT201"]);
  assert.deepEqual(profile.interactions.negativePropertyReferences, ["DT202"]);
  assert.equal(profile.interactions.latestInteractionAt, "2026-07-18T10:00:00.000Z");
  assert.equal(profile.interactions.positiveExamples[0].property.type, "Apartment");
  assert.equal(profile.interactions.negativeExamples[0].reason, "price_rejection");
});

test("stored profiles are reused only while they cover the current contact version", () => {
  const stored = {
    schemaVersion: 2,
    status: "ready",
    eligibilityProfile: { status: "eligible", confidence: 0.9, reasons: [] },
    requirementProfile: { anchorCount: 3 },
    interactionProfile: { sentCount: 1 },
    requirementSummary: "Stored summary",
    interactionSummary: "Stored interactions",
    sourceContactUpdatedAt: "2026-07-18T11:00:00.000Z",
    evidenceWatermarkAt: "2026-07-18T11:00:00.000Z",
  };
  const current = resolveContactPropertyMatchProfile({
    updatedAt: "2026-07-18T10:00:00.000Z",
    propertyMatchProfile: stored,
  });
  assert.equal(current.requirementSummary, "Stored summary");

  const rebuilt = resolveContactPropertyMatchProfile({
    updatedAt: "2026-07-18T12:00:00.000Z",
    contactType: "Lead",
    profileVerificationStatus: "verified_lead",
    requirementDistrict: "Paphos",
    propertyMatchProfile: stored,
  });
  assert.notEqual(rebuilt.requirementSummary, "Stored summary");
});

test("latest explicit reaction controls similarity examples for the same property", () => {
  const property = {
    id: "prop_300",
    reference: "DT300",
    type: "Apartment",
    price: 250000,
    bedrooms: 2,
    propertyLocation: "Universal",
  };
  const profile = buildContactPropertyMatchProfile({ contactType: "Lead" }, [
    {
      eventType: "liked",
      sentiment: "positive",
      propertyReference: "DT300",
      occurredAt: "2026-07-17T10:00:00.000Z",
      property,
    },
    {
      eventType: "rejected",
      sentiment: "negative",
      propertyReference: "DT300",
      occurredAt: "2026-07-18T10:00:00.000Z",
      evidence: { reason: "not_suitable" },
      property,
    },
  ]);

  assert.equal(profile.interactions.positiveExamples.length, 0);
  assert.equal(profile.interactions.negativeExamples.length, 1);
  assert.equal(profile.interactions.negativeExamples[0].reason, "not_suitable");
});
