import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStructuredPropertyMatch } from "./matching";

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
