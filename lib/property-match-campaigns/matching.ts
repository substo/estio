export type MatchVerdict = "yes" | "maybe" | "no";

export type PropertyMatchInput = {
  goal?: string | null;
  type?: string | null;
  price?: number | null;
  bedrooms?: number | null;
  city?: string | null;
  propertyLocation?: string | null;
  propertyArea?: string | null;
  condition?: string | null;
};

export type ContactRequirementInput = {
  requirementStatus?: string | null;
  requirementDistrict?: string | null;
  requirementBedrooms?: string | null;
  requirementMinPrice?: string | null;
  requirementMaxPrice?: string | null;
  requirementCondition?: string | null;
  requirementPropertyTypes?: string[] | null;
  requirementPropertyLocations?: string[] | null;
  requirementOtherDetails?: string | null;
  requirementSummary?: string | null;
};

export type StructuredMatchResult = {
  verdict: MatchVerdict;
  score: number;
  needsAi: boolean;
  matches: string[];
  mismatches: string[];
  unknowns: string[];
};

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(normalize).filter(Boolean)
    : [];
}

function isAny(value: unknown): boolean {
  const text = normalize(value);
  return !text || text === "any" || text.startsWith("any ");
}

function includesLoose(candidates: string[], value: string): boolean {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return false;
  return candidates.some((candidate) => {
    const normalizedCandidate = normalize(candidate);
    return normalizedCandidate === normalizedValue
      || normalizedCandidate.includes(normalizedValue)
      || normalizedValue.includes(normalizedCandidate);
  });
}

function parseMoney(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const digits = String(value).replace(/[^\d.]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function bedroomRequirementMatches(requirement: unknown, bedrooms: number | null | undefined): boolean | null {
  if (isAny(requirement)) return true;
  const source = normalize(requirement);
  const propertyBedrooms = typeof bedrooms === "number" ? bedrooms : null;
  if (propertyBedrooms == null) return null;

  if (source.includes("studio")) return propertyBedrooms === 0;

  const numbers = Array.from(source.matchAll(/\d+/g)).map((match) => Number(match[0])).filter(Number.isFinite);
  if (numbers.length === 0) return null;
  if (/\+|plus|or more|minimum|min/.test(source)) return propertyBedrooms >= numbers[0];
  return numbers.includes(propertyBedrooms);
}

function statusMatches(requirementStatus: unknown, goal: unknown): boolean | null {
  if (isAny(requirementStatus)) return true;
  const status = normalize(requirementStatus);
  const normalizedGoal = normalize(goal);
  if (!normalizedGoal) return null;
  if (status.includes("rent")) return normalizedGoal === "rent";
  if (status.includes("sale") || status.includes("buy")) return normalizedGoal === "sale";
  return null;
}

export function evaluateStructuredPropertyMatch(
  property: PropertyMatchInput,
  contact: ContactRequirementInput,
): StructuredMatchResult {
  const matches: string[] = [];
  const mismatches: string[] = [];
  const unknowns: string[] = [];

  const status = statusMatches(contact.requirementStatus, property.goal);
  if (status === true && !isAny(contact.requirementStatus)) matches.push("listing goal matches requirement status");
  if (status === false) mismatches.push("listing goal does not match requirement status");
  if (status == null) unknowns.push("requirement status is unclear");

  const propertyType = normalize(property.type);
  const requiredTypes = normalizeList(contact.requirementPropertyTypes);
  if (requiredTypes.length > 0 && propertyType) {
    if (includesLoose(requiredTypes, propertyType)) matches.push("property type matches");
    else mismatches.push("property type does not match");
  } else if (requiredTypes.length > 0) {
    unknowns.push("property type is missing");
  }

  const bedroomMatch = bedroomRequirementMatches(contact.requirementBedrooms, property.bedrooms);
  if (bedroomMatch === true && !isAny(contact.requirementBedrooms)) matches.push("bedrooms match");
  if (bedroomMatch === false) mismatches.push("bedrooms do not match");
  if (bedroomMatch == null) unknowns.push("bedroom requirement is unclear");

  const price = parseMoney(property.price);
  const minPrice = parseMoney(contact.requirementMinPrice);
  const maxPrice = parseMoney(contact.requirementMaxPrice);
  if (price != null) {
    if (minPrice != null && price < minPrice) mismatches.push("price is below the minimum budget");
    else if (minPrice != null) matches.push("price is above minimum budget");

    if (maxPrice != null && price > maxPrice) mismatches.push("price exceeds maximum budget");
    else if (maxPrice != null) matches.push("price is within maximum budget");
  } else if (minPrice != null || maxPrice != null) {
    unknowns.push("property price is missing");
  }

  const propertyLocations = [
    property.propertyLocation,
    property.city,
    property.propertyArea,
  ].map(normalize).filter(Boolean);
  const requiredDistrict = normalize(contact.requirementDistrict);
  const requiredLocations = normalizeList(contact.requirementPropertyLocations);
  const hasLocationRequirement = !isAny(requiredDistrict) || requiredLocations.length > 0;
  if (hasLocationRequirement && propertyLocations.length > 0) {
    const districtMatches = !isAny(requiredDistrict) && includesLoose(propertyLocations, requiredDistrict);
    const locationMatches = requiredLocations.length > 0 && requiredLocations.some((item) => includesLoose(propertyLocations, item));
    if (districtMatches || locationMatches) matches.push("location matches");
    else mismatches.push("location does not match");
  } else if (hasLocationRequirement) {
    unknowns.push("property location is missing");
  }

  const requiredCondition = normalize(contact.requirementCondition);
  const propertyCondition = normalize(property.condition);
  if (!isAny(requiredCondition) && propertyCondition) {
    if (propertyCondition.includes(requiredCondition) || requiredCondition.includes(propertyCondition)) {
      matches.push("condition matches");
    } else {
      unknowns.push("condition preference needs review");
    }
  }

  const hasUnstructuredRequirements = Boolean(
    normalize(contact.requirementOtherDetails) || normalize(contact.requirementSummary)
  );
  const score = matches.length - mismatches.length * 2 - Math.min(unknowns.length, 3) * 0.25;

  if (mismatches.length > 0) {
    return { verdict: "no", score, needsAi: false, matches, mismatches, unknowns };
  }

  if (matches.length >= 3 && !hasUnstructuredRequirements && unknowns.length <= 1) {
    return { verdict: "yes", score, needsAi: false, matches, mismatches, unknowns };
  }

  if (matches.length >= 2 && !hasUnstructuredRequirements && unknowns.length <= 2) {
    return { verdict: "yes", score, needsAi: false, matches, mismatches, unknowns };
  }

  return { verdict: "maybe", score, needsAi: true, matches, mismatches, unknowns };
}
