import type { PropertyMatchInput } from "@/lib/property-match-campaigns/matching";
import type {
  ContactPropertyMatchProfile,
  PropertyInteractionExample,
} from "@/lib/property-match-campaigns/profile";

export type PropertyInteractionSimilarityExample = {
  reference: string | null;
  eventType: string;
  reason: string | null;
  occurredAt: string | null;
  similarity: number;
  matchedFields: string[];
  differingFields: string[];
};

export type PropertyInteractionSimilarity = {
  positiveMatches: PropertyInteractionSimilarityExample[];
  negativeCautions: PropertyInteractionSimilarityExample[];
  hasPositiveGrounding: boolean;
  requiresReview: boolean;
  summary: string;
};

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function typeCategory(value: unknown): string | null {
  const text = normalize(value);
  if (!text) return null;
  if (/\b(plot|land|parcel)\b/.test(text)) return "land";
  if (/\b(townhouse|town house|maisonette)\b/.test(text)) return "townhouse";
  if (/\b(villa|house|detached|bungalow)\b/.test(text)) return "house";
  if (/\b(apartment|flat|studio|penthouse)\b/.test(text)) return "apartment";
  if (/\b(office|shop|commercial|warehouse)\b/.test(text)) return "commercial";
  return text;
}

function locationTokens(property: {
  propertyLocation?: unknown;
  propertyArea?: unknown;
  city?: unknown;
}): Set<string> {
  return new Set([
    property.propertyLocation,
    property.propertyArea,
    property.city,
  ].map(normalize).filter(Boolean));
}

function relativeDifference(left: number, right: number): number {
  const denominator = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / denominator;
}

function compareExample(
  property: PropertyMatchInput,
  example: PropertyInteractionExample,
): PropertyInteractionSimilarityExample | null {
  const matchedFields: string[] = [];
  const differingFields: string[] = [];
  let matchedWeight = 0;
  let knownWeight = 0;

  const compare = (field: string, weight: number, matches: boolean | null) => {
    if (matches == null) return;
    knownWeight += weight;
    if (matches) {
      matchedWeight += weight;
      matchedFields.push(field);
    } else {
      differingFields.push(field);
    }
  };

  const currentType = typeCategory(property.type);
  const exampleType = typeCategory(example.property.type);
  compare("type", 2, currentType && exampleType ? currentType === exampleType : null);

  const currentLocations = locationTokens(property);
  const exampleLocations = locationTokens(example.property);
  compare(
    "location",
    3,
    currentLocations.size && exampleLocations.size
      ? Array.from(currentLocations).some((location) => exampleLocations.has(location))
      : null,
  );

  const currentPrice = finiteNumber(property.price);
  const examplePrice = finiteNumber(example.property.price);
  compare("price", 2, currentPrice != null && examplePrice != null
    ? relativeDifference(currentPrice, examplePrice) <= 0.2
    : null);

  const currentBedrooms = finiteNumber(property.bedrooms);
  const exampleBedrooms = finiteNumber(example.property.bedrooms);
  compare("bedrooms", 2, currentBedrooms != null && exampleBedrooms != null
    ? currentBedrooms === exampleBedrooms
    : null);

  const currentArea = finiteNumber(property.areaSqm);
  const exampleArea = finiteNumber(example.property.areaSqm);
  compare("size", 1, currentArea != null && exampleArea != null
    ? relativeDifference(currentArea, exampleArea) <= 0.2
    : null);

  const currentGoal = normalize(property.goal);
  const exampleGoal = normalize(example.property.goal);
  compare("goal", 1, currentGoal && exampleGoal ? currentGoal === exampleGoal : null);

  if (knownWeight === 0 || matchedFields.length < 2) return null;
  const similarity = Math.round((matchedWeight / knownWeight) * 100) / 100;
  if (similarity < 0.6) return null;
  return {
    reference: example.property.reference,
    eventType: example.eventType,
    reason: example.reason,
    occurredAt: example.occurredAt,
    similarity,
    matchedFields,
    differingFields,
  };
}

function negativeReasonStillApplies(
  property: PropertyMatchInput,
  example: PropertyInteractionExample,
  comparison: PropertyInteractionSimilarityExample,
): boolean {
  if (example.reason === "price_rejection") {
    const current = finiteNumber(property.price);
    const rejected = finiteNumber(example.property.price);
    return current != null && rejected != null && current >= rejected * 0.9;
  }
  if (example.reason === "location_rejection") return comparison.matchedFields.includes("location");
  if (example.reason === "size_rejection") {
    return comparison.matchedFields.includes("size") || comparison.matchedFields.includes("bedrooms");
  }
  return true;
}

export function comparePropertyToInteractionProfile(
  property: PropertyMatchInput,
  interactions: ContactPropertyMatchProfile["interactions"] | null | undefined,
): PropertyInteractionSimilarity {
  const positiveMatches = (interactions?.positiveExamples || [])
    .map((example) => compareExample(property, example))
    .filter(Boolean)
    .sort((left, right) => Number(right?.similarity) - Number(left?.similarity))
    .slice(0, 3) as PropertyInteractionSimilarityExample[];
  const negativeCautions = (interactions?.negativeExamples || [])
    .map((example) => {
      const comparison = compareExample(property, example);
      return comparison && negativeReasonStillApplies(property, example, comparison) ? comparison : null;
    })
    .filter(Boolean)
    .sort((left, right) => Number(right?.similarity) - Number(left?.similarity))
    .slice(0, 3) as PropertyInteractionSimilarityExample[];
  const hasPositiveGrounding = positiveMatches.some((match) => (
    match.matchedFields.some((field) => ["location", "price", "bedrooms", "size"].includes(field))
  ));
  return {
    positiveMatches,
    negativeCautions,
    hasPositiveGrounding,
    requiresReview: negativeCautions.length > 0,
    summary: [
      positiveMatches.length ? `Similar to ${positiveMatches.length} positively received propert${positiveMatches.length === 1 ? "y" : "ies"}.` : null,
      negativeCautions.length ? `Similar to ${negativeCautions.length} previously rejected propert${negativeCautions.length === 1 ? "y" : "ies"}; review the rejection reason.` : null,
    ].filter(Boolean).join(" ") || "No strong property-interaction similarity found.",
  };
}
