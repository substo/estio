import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStructuredPropertyMatch } from "./matching";

const CYPRUS_TEST_MARKET = {
  locationId: "office-cy",
  locationName: "Cyprus office",
  countryCode: "CY",
  countryName: "Cyprus",
  locale: "en-CY",
  currencyCode: "EUR",
  supportedLanguages: ["en", "el"],
  source: { configured: true, inventoryFallback: false },
  serviceAreas: [
    { id: "paphos", label: "Paphos", aliases: [], parentId: null, kind: "district" as const },
    { id: "limassol", label: "Limassol", aliases: [], parentId: null, kind: "district" as const },
    { id: "peyia", label: "Peyia", aliases: ["Peia", "Pegeia"], parentId: "paphos", kind: "locality" as const },
    { id: "paphos-town", label: "Paphos Town", aliases: [], parentId: "paphos", kind: "locality" as const },
    { id: "agios-ioannis", label: "Agios Ioannis", aliases: [], parentId: "limassol", kind: "locality" as const },
  ],
};

test("structured matcher returns yes for clear CRM requirement fit", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Studio",
      price: 145000,
      bedrooms: 0,
      city: "Peia",
      propertyLocation: "Peia",
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "Studio",
      requirementMaxPrice: "€160,000",
      requirementPropertyTypes: ["Studio"],
      requirementPropertyLocations: ["Peia"],
    },
  );

  assert.equal(result.verdict, "yes");
  assert.equal(result.needsAi, false);
  assert.equal(result.mismatches.length, 0);
});

test("structured matcher returns no for hard budget mismatch", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 260000,
      bedrooms: 2,
      city: "Peia",
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "2 Bedrooms",
      requirementMaxPrice: "€200,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Peia"],
    },
  );

  assert.equal(result.verdict, "no");
  assert.match(result.mismatches.join(" "), /maximum budget/);
});

test("structured matcher returns maybe when unstructured requirements need review", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "RENT",
      type: "Apartment",
      price: 1200,
      bedrooms: 2,
      city: "Kato Paphos",
    },
    {
      requirementStatus: "For Rent",
      requirementBedrooms: "2 Bedrooms",
      requirementMaxPrice: "€1,300",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Kato Paphos"],
      requirementSummary: "Client prefers ground floor, no stairs, and walking distance to the sea.",
    },
  );

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
});

test("structured matcher returns no for location mismatch", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Villa",
      price: 450000,
      bedrooms: 3,
      city: "Tala",
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "3 Bedrooms",
      requirementMaxPrice: "€500,000",
      requirementPropertyTypes: ["Villa"],
      requirementPropertyLocations: ["Peia"],
    },
  );

  assert.equal(result.verdict, "no");
  assert.match(result.mismatches.join(" "), /location/);
});

test("structured matcher returns no for bedroom mismatch", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 180000,
      bedrooms: 1,
      city: "Peia",
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "2 Bedrooms",
      requirementMaxPrice: "€200,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Peia"],
    },
  );

  assert.equal(result.verdict, "no");
  assert.match(result.mismatches.join(" "), /bedrooms/);
});

test("structured matcher keeps missing requirements as maybe", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 180000,
      bedrooms: 1,
      city: "Peia",
    },
    {},
  );

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
});

test("structured matcher supports multiple acceptable types and locations", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Townhouse",
      price: 280000,
      bedrooms: 3,
      city: "Tala",
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "3+ Bedrooms",
      requirementMaxPrice: "€300,000",
      requirementPropertyTypes: ["Apartment", "Townhouse"],
      requirementPropertyLocations: ["Peia", "Tala"],
    },
  );

  assert.equal(result.verdict, "yes");
  assert.equal(result.mismatches.length, 0);
});

test("structured matcher rejects different district recent intent even when structured locations are broad", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
      propertyLocation: "Paphos",
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Limassol", "Paphos"],
      requirementOtherDetails: "Interested in Ref. No. DT3294: 1-bed Apartment in Limassol - Agios Ioannis.",
    },
    { marketContext: CYPRUS_TEST_MARKET },
  );

  assert.equal(result.verdict, "no");
  assert.match(result.hardMismatches?.join(" ") || "", /different district/);
});

test("structured matcher keeps same-district different area as maybe", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
      propertyLocation: "Paphos",
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Paphos"],
      requirementOtherDetails: "Interested in a 1-bed apartment in Paphos Town.",
    },
    { marketContext: CYPRUS_TEST_MARKET },
  );

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
  assert.match(result.unknowns.join(" "), /different local area/);
});

test("structured matcher does not return yes for sparse broad leads", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
    },
    {
      requirementStatus: "For Sale",
      requirementDistrict: "Any District",
      requirementBedrooms: "Any Bedrooms",
      requirementMinPrice: "Any",
      requirementMaxPrice: "Any",
      requirementPropertyTypes: [],
      requirementPropertyLocations: [],
    },
  );

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
  assert.equal(result.qualificationEvidence?.anchorCount, 1);
  assert.equal(result.qualificationEvidence?.concreteFitAnchorCount, 0);
  assert.equal(result.qualificationEvidence?.broadOnly, true);
  assert.equal(result.dimensions?.find((dimension) => dimension.key === "bedrooms")?.status, "unknown");
  assert.match(result.qualificationEvidence?.reason || "", /absence of mismatches is not proof/i);
});

test("structured matcher treats Chris-style broad requirements as insufficient proof", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
      condition: "Renovated",
    },
    {
      requirementStatus: "For Sale",
      requirementDistrict: "Any District",
      requirementBedrooms: "Any Bedrooms",
      requirementMinPrice: "Any",
      requirementMaxPrice: "Any",
      requirementCondition: "Any Condition",
      requirementPropertyTypes: [],
      requirementPropertyLocations: [],
      recentMessagesText: "? How can I help you?",
    },
  );

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
  assert.deepEqual(result.qualificationEvidence?.anchors, ["sale/rent intent matches"]);
  assert.equal(result.qualificationEvidence?.concreteFitAnchorCount, 0);
  assert.equal(result.dimensions?.find((dimension) => dimension.key === "sparse")?.status, "maybe");
});

test("structured matcher keeps broad verified leads as maybe when only one real fit anchor exists", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
    },
    {
      profileVerificationStatus: "verified_lead",
      requirementStatus: "Any",
      requirementDistrict: "Any District",
      requirementBedrooms: "Any Bedrooms",
      requirementMinPrice: "Any",
      requirementMaxPrice: "Any",
      requirementCondition: "Any Condition",
      requirementPropertyTypes: [],
      requirementPropertyLocations: [],
    },
  );

  assert.equal(result.verdict, "maybe");
  assert.equal(result.qualificationEvidence?.anchorCount, 1);
  assert.deepEqual(result.qualificationEvidence?.anchors, ["globally verified lead"]);
});

test("structured matcher does not count generic buy goal text as specific property evidence", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
    },
    {
      requirementStatus: "For Sale",
      requirementDistrict: "Any District",
      requirementBedrooms: "Any Bedrooms",
      requirementMinPrice: "Any",
      requirementMaxPrice: "Any",
      requirementCondition: "Any Condition",
      requirementPropertyTypes: [],
      requirementPropertyLocations: [],
      requirementOtherDetails: "Goal: To Buy. Source: BUYSELL CYPRUS. Next Action: please contact.",
    },
  );

  assert.equal(result.verdict, "maybe");
  assert.deepEqual(result.qualificationEvidence?.anchors, ["sale/rent intent matches"]);
});

test("structured matcher rejects land or plot intent for a house campaign", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "Sale",
      type: "House",
      price: 350000,
      bedrooms: 3,
      city: "Paphos",
      propertyArea: "Pegeia",
      description: "Two-storey three-bedroom house with swimming pool in Pegeia.",
    },
    {
      contactType: "Lead",
      contactName: "Ahmad Awwad Lead Sale Land with sea views, residential land, 200K 300K",
      profileVerificationStatus: "verified_lead",
      leadGoal: "To Buy",
      requirementStatus: "For Sale",
      requirementDistrict: "Any District",
      requirementBedrooms: "Any Bedrooms",
      requirementMinPrice: "Any",
      requirementMaxPrice: "Any",
      requirementPropertyTypes: [],
      requirementPropertyLocations: [],
      recentMessagesText: "if there is plots on the beach/ sea view let me know\nplease accept the group invite, I am sending land options there for you",
    },
  );

  assert.equal(result.verdict, "no");
  assert.match(result.hardMismatches?.join(" ") || "", /property type intent/);
  assert.equal(result.dimensions?.find((dimension) => dimension.key === "recent_type_intent")?.status, "no");
});

test("structured matcher rejects ground-floor apartment or townhouse intent for a detached house", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "Sale",
      type: "House",
      price: 350000,
      bedrooms: 3,
      city: "Paphos",
      propertyArea: "Pegeia",
      description: "Available for sale is a two-storey, three-bedroom house. The ground floor consists of a living room and kitchen, with bedrooms on the first floor.",
    },
    {
      contactType: "Lead",
      profileVerificationStatus: "verified_lead",
      leadGoal: "To Buy",
      requirementStatus: "For Sale",
      requirementDistrict: "Any District",
      requirementBedrooms: "Any Bedrooms",
      requirementMinPrice: "Any",
      requirementMaxPrice: "Any",
      requirementPropertyTypes: [],
      requirementPropertyLocations: [],
      recentMessagesText: "Unfortunately, we need a ground floor apartment or town house.",
    },
  );

  assert.equal(result.verdict, "no");
  assert.equal(result.dimensions?.find((dimension) => dimension.key === "recent_type_intent")?.status, "no");
  assert.equal(result.dimensions?.find((dimension) => dimension.key === "features")?.status, "no");
  assert.match(result.hardMismatches?.join(" ") || "", /property type intent/);
});

test("structured matcher keeps one concrete fit anchor as AI review instead of yes", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "Sale",
      type: "House",
      price: 350000,
      bedrooms: 3,
      city: "Paphos",
      propertyArea: "Pegeia",
      description: "Three-bedroom house with sea views.",
    },
    {
      contactType: "Lead",
      profileVerificationStatus: "verified_lead",
      leadGoal: "To Buy",
      requirementStatus: "For Sale",
      requirementDistrict: "Any District",
      requirementBedrooms: "Any Bedrooms",
      requirementMinPrice: "Any",
      requirementMaxPrice: "Any",
      requirementPropertyTypes: [],
      requirementPropertyLocations: [],
      recentMessagesText: "Looking for something with sea view.",
    },
  );

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
  assert.equal(result.qualificationEvidence?.concreteFitAnchorCount, 1);
});

test("structured matcher keeps type and feature overlap as AI review without grounding fit", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "Sale",
      type: "House",
      price: 350000,
      bedrooms: 3,
      city: "Paphos",
      propertyArea: "Pegeia",
      description: "Three-bedroom house with swimming pool and sea views.",
    },
    {
      contactType: "Lead",
      profileVerificationStatus: "verified_lead",
      leadGoal: "To Buy",
      requirementStatus: "For Sale",
      requirementDistrict: "Any District",
      requirementBedrooms: "Any Bedrooms",
      requirementMinPrice: "Any",
      requirementMaxPrice: "Any",
      requirementPropertyTypes: [],
      requirementPropertyLocations: [],
      recentMessagesText: "Looking for a house with pool or sea view.",
    },
  );

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
  assert.deepEqual(result.qualificationEvidence?.concreteFitAnchors, ["recent property type intent matches", "requested features match"]);
  assert.equal(result.qualificationEvidence?.groundingFitAnchorCount, 0);
});

test("structured matcher returns yes when verified lead has multiple concrete anchors", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
    },
    {
      profileVerificationStatus: "verified_lead",
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Paphos"],
    },
  );

  assert.equal(result.verdict, "yes");
  assert.ok((result.qualificationEvidence?.anchorCount || 0) >= 2);
});

test("structured matcher disqualifies leads who stopped searching", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
    },
    {
      requirementStatus: "For Sale",
      requirementPropertyLocations: ["Paphos"],
      recentMessagesText: "Thanks but we already bought a property. Please stop sending.",
    },
  );

  assert.equal(result.verdict, "no");
  assert.match(result.disqualifiers?.join(" ") || "", /no longer searching/);
});

test("structured matcher does not classify contact identity from agent-like names", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
    },
    {
      contactType: "Lead",
      contactName: "Maria Property Agent",
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Paphos"],
    },
  );

  assert.notEqual(result.verdict, "no");
  assert.equal(result.dimensions?.some((dimension) => dimension.key === "lead_eligibility"), false);
  assert.doesNotMatch(result.disqualifiers?.join(" ") || "", /Agent/);
});

test("structured matcher does not classify contact identity from owner-like names", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
    },
    {
      contactType: "Lead",
      contactName: "Andreas Owner",
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Paphos"],
    },
  );

  assert.notEqual(result.verdict, "no");
  assert.doesNotMatch(result.disqualifiers?.join(" ") || "", /Owner/);
});

test("structured matcher omits campaign-owned lead eligibility dimension", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      city: "Paphos",
      propertyArea: "Peyia",
    },
    {
      contactType: "Lead",
      contactName: "John Buyer",
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Paphos"],
    },
  );

  assert.notEqual(result.verdict, "no");
  assert.equal(result.dimensions?.some((dimension) => dimension.key === "lead_eligibility"), false);
});

test("structured matcher rejects explicit minimum size mismatch", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      areaSqm: 46,
      city: "Paphos",
      propertyArea: "Peyia",
      propertyLocation: "Paphos",
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Paphos"],
      requirementOtherDetails: "Needs at least 60m2 covered area.",
    },
  );

  assert.equal(result.verdict, "no");
  assert.match(result.hardMismatches?.join(" ") || "", /covered area/);
});

test("structured matcher compares requested features", () => {
  const matching = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      areaSqm: 46,
      city: "Paphos",
      propertyArea: "Peyia",
      propertyLocation: "Paphos",
      features: ["swimming_pool_communal", "parking_covered", "title_deeds_available"],
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Paphos"],
      requirementOtherDetails: "Needs title deeds and pool.",
    },
  );
  assert.notEqual(matching.verdict, "no");
  assert.equal(matching.dimensions?.find((dimension) => dimension.key === "features")?.status, "yes");

  const missingRequired = evaluateStructuredPropertyMatch(
    {
      goal: "SALE",
      type: "Apartment",
      price: 149000,
      bedrooms: 1,
      areaSqm: 46,
      city: "Paphos",
      propertyArea: "Peyia",
      propertyLocation: "Paphos",
      features: ["parking_covered"],
    },
    {
      requirementStatus: "For Sale",
      requirementBedrooms: "1+ Bedrooms",
      requirementMaxPrice: "€175,000",
      requirementPropertyTypes: ["Apartment"],
      requirementPropertyLocations: ["Paphos"],
      requirementOtherDetails: "Must have title deeds.",
    },
  );
  assert.equal(missingRequired.verdict, "no");
  assert.match(missingRequired.hardMismatches?.join(" ") || "", /required feature/);
});

test("structured matcher treats lead goal as primary when requirement status is stale", () => {
  const result = evaluateStructuredPropertyMatch(
    {
      goal: "Sale",
      type: "House",
      price: 350000,
      bedrooms: 3,
      propertyLocation: "Peyia",
      city: "Paphos",
    },
    {
      contactType: "Lead",
      profileVerificationStatus: "verified_lead",
      leadGoal: "To Rent",
      requirementStatus: "For Sale",
      requirementBedrooms: "Any Bedrooms",
      requirementMaxPrice: "Any",
      requirementSummary: "Looking for an apartment to rent, budget below 1000 euro.",
    },
  );

  assert.equal(result.verdict, "no");
  assert.match(result.hardMismatches?.join(" ") || "", /lead goal/);
  assert.equal(result.dimensions?.find((dimension) => dimension.key === "goal")?.status, "no");
});
