import { PROPERTY_LOCATIONS } from "@/lib/properties/locations";

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
  leadGoal?: string | null;
  contactType?: string | null;
  contactName?: string | null;
  recentMessagesText?: string | null;
};

export type MatchDimension = {
  key: string;
  label: string;
  propertyValue?: string | number | null;
  requirementValue?: string | number | null;
  status: MatchVerdict | "unknown";
  weight: number;
  score: number;
  reason: string;
};

export type StructuredMatchResult = {
  verdict: MatchVerdict;
  score: number;
  needsAi: boolean;
  matches: string[];
  mismatches: string[];
  unknowns: string[];
  dimensions?: MatchDimension[];
  hardMismatches?: string[];
  disqualifiers?: string[];
  recentIntent?: {
    districts: string[];
    areas: string[];
    stoppedSearch: boolean;
    source: string | null;
  };
};

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(normalize).filter(Boolean)
    : [];
}

function display(value: unknown): string | null {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || null;
  const text = String(value ?? "").trim();
  return text || null;
}

function compactLocation(value: unknown): string {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

const LOCATION_ALIASES: Record<string, string> = {
  peia: "peyia",
  pegeia: "peyia",
  paphostown: "paphos_town",
  paphos: "paphos",
  limassol: "limassol",
  larnaca: "larnaca",
  nicosia: "nicosia",
  famagusta: "famagusta",
};

const DISTRICT_BY_TOKEN = new Map<string, string>();
const AREA_BY_TOKEN = new Map<string, { area: string; district: string; label: string }>();

for (const district of PROPERTY_LOCATIONS) {
  const districtTokens = [
    district.district_key,
    district.district_label,
    compactLocation(district.district_key),
    compactLocation(district.district_label),
  ];
  for (const token of districtTokens) {
    const key = LOCATION_ALIASES[compactLocation(token)] || compactLocation(token);
    if (key) DISTRICT_BY_TOKEN.set(key, normalize(district.district_label));
  }
  for (const location of district.locations) {
    const areaTokens = [
      location.key,
      location.label,
      compactLocation(location.key),
      compactLocation(location.label),
    ];
    for (const token of areaTokens) {
      const key = LOCATION_ALIASES[compactLocation(token)] || compactLocation(token);
      if (key) AREA_BY_TOKEN.set(key, {
        area: normalize(location.label),
        district: normalize(district.district_label),
        label: location.label,
      });
    }
  }
}

function locationInfo(value: unknown): { districts: string[]; areas: string[] } {
  const text = normalize(value);
  if (!text) return { districts: [], areas: [] };
  const compact = LOCATION_ALIASES[compactLocation(text)] || compactLocation(text);
  const districts = new Set<string>();
  const areas = new Set<string>();

  const directArea = AREA_BY_TOKEN.get(compact);
  if (directArea) {
    areas.add(directArea.area);
    districts.add(directArea.district);
  }
  const directDistrict = DISTRICT_BY_TOKEN.get(compact);
  if (directDistrict) districts.add(directDistrict);

  for (const [token, district] of DISTRICT_BY_TOKEN.entries()) {
    if (token.length >= 4 && compact.includes(token)) districts.add(district);
  }
  for (const [token, area] of AREA_BY_TOKEN.entries()) {
    if (token.length >= 4 && compact.includes(token)) {
      areas.add(area.area);
      districts.add(area.district);
    }
  }

  return { districts: Array.from(districts), areas: Array.from(areas) };
}

function mergeLocationInfo(values: unknown[]): { districts: string[]; areas: string[] } {
  const districts = new Set<string>();
  const areas = new Set<string>();
  for (const value of values) {
    const info = locationInfo(value);
    info.districts.forEach((item) => districts.add(item));
    info.areas.forEach((item) => areas.add(item));
  }
  return { districts: Array.from(districts), areas: Array.from(areas) };
}

function detectRecentIntent(contact: ContactRequirementInput) {
  const sources = [
    contact.contactName,
    contact.requirementOtherDetails,
    contact.requirementSummary,
    contact.recentMessagesText,
  ].map((item) => display(item)).filter(Boolean) as string[];
  const text = sources.join("\n");
  const info = mergeLocationInfo(sources);
  const explicitDistricts = PROPERTY_LOCATIONS
    .filter((district) => new RegExp(`\\b${district.district_label}\\b`, "i").test(text))
    .map((district) => normalize(district.district_label));
  const explicitAreas = PROPERTY_LOCATIONS.flatMap((district) => (
    district.locations
      .filter((location) => {
        const label = location.label.replace(/\s*\([^)]*\)\s*/g, " ").trim();
        if (!label || !new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) return false;
        return explicitDistricts.length === 0 || explicitDistricts.includes(normalize(district.district_label));
      })
      .map((location) => normalize(location.label))
  ));
  const stoppedSearch = /\b(already\s+(bought|purchased|rented|found)|found\s+(something|a\s+property|one)|not\s+(looking|searching|interested)\s+any\s*more|no\s+longer\s+(looking|searching)|stop\s+(sending|contacting|messaging)|remove\s+me|unsubscribe|wrong\s+number)\b/i.test(text);
  return {
    districts: explicitDistricts.length ? explicitDistricts : info.districts,
    areas: Array.from(new Set([...explicitAreas, ...info.areas])),
    stoppedSearch,
    source: text ? text.slice(0, 500) : null,
  };
}

function addDimension(
  dimensions: MatchDimension[],
  args: Omit<MatchDimension, "score"> & { score?: number },
) {
  dimensions.push({
    ...args,
    score: args.score ?? (
      args.status === "yes" ? args.weight : args.status === "no" ? -args.weight : 0
    ),
  });
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
  const dimensions: MatchDimension[] = [];
  const hardMismatches: string[] = [];
  const disqualifiers: string[] = [];
  const recentIntent = detectRecentIntent(contact);

  if (recentIntent.stoppedSearch) {
    disqualifiers.push("lead has clearly indicated they are no longer searching");
  }
  const leadGoal = normalize(contact.leadGoal);
  const contactType = normalize(contact.contactType);
  if (["to list", "to sell", "other"].includes(leadGoal)) {
    disqualifiers.push(`lead goal is ${contact.leadGoal}, not a buyer or renter requirement`);
  }
  if (["owner", "agent", "partner", "associate", "maintenance"].includes(contactType)) {
    disqualifiers.push(`contact type is ${contact.contactType}, not a buyer or renter lead`);
  }

  const status = statusMatches(contact.requirementStatus, property.goal);
  if (status === true && !isAny(contact.requirementStatus)) matches.push("listing goal matches requirement status");
  if (status === false) {
    mismatches.push("listing goal does not match requirement status");
    hardMismatches.push("listing goal does not match requirement status");
  }
  if (status == null) unknowns.push("requirement status is unclear");
  addDimension(dimensions, {
    key: "goal",
    label: "Goal",
    propertyValue: display(property.goal),
    requirementValue: display(contact.requirementStatus),
    status: status == null ? "unknown" : status ? "yes" : "no",
    weight: 3,
    reason: status === true ? "Sale/rent intent matches." : status === false ? "Sale/rent intent conflicts." : "Sale/rent intent is unclear.",
  });

  const propertyType = normalize(property.type);
  const requiredTypes = normalizeList(contact.requirementPropertyTypes);
  if (requiredTypes.length > 0 && propertyType) {
    if (includesLoose(requiredTypes, propertyType)) matches.push("property type matches");
    else {
      mismatches.push("property type does not match");
      hardMismatches.push("property type does not match");
    }
  } else if (requiredTypes.length > 0) {
    unknowns.push("property type is missing");
  }
  if (requiredTypes.length > 0 || propertyType) {
    const typeMatches = requiredTypes.length > 0 && propertyType ? includesLoose(requiredTypes, propertyType) : null;
    addDimension(dimensions, {
      key: "type",
      label: "Type",
      propertyValue: display(property.type),
      requirementValue: display(contact.requirementPropertyTypes),
      status: typeMatches == null ? "unknown" : typeMatches ? "yes" : "no",
      weight: 2,
      reason: typeMatches === true ? "Property type matches." : typeMatches === false ? "Property type conflicts." : "Property type is incomplete.",
    });
  }

  const bedroomMatch = bedroomRequirementMatches(contact.requirementBedrooms, property.bedrooms);
  if (bedroomMatch === true && !isAny(contact.requirementBedrooms)) matches.push("bedrooms match");
  if (bedroomMatch === false) {
    mismatches.push("bedrooms do not match");
    hardMismatches.push("bedrooms do not match");
  }
  if (bedroomMatch == null) unknowns.push("bedroom requirement is unclear");
  if (!isAny(contact.requirementBedrooms) || property.bedrooms != null) {
    addDimension(dimensions, {
      key: "bedrooms",
      label: "Bedrooms",
      propertyValue: property.bedrooms ?? null,
      requirementValue: display(contact.requirementBedrooms),
      status: bedroomMatch == null ? "unknown" : bedroomMatch ? "yes" : "no",
      weight: 2,
      reason: bedroomMatch === true ? "Bedroom count fits." : bedroomMatch === false ? "Bedroom count conflicts." : "Bedroom requirement is unclear.",
    });
  }

  const price = parseMoney(property.price);
  const minPrice = parseMoney(contact.requirementMinPrice);
  const maxPrice = parseMoney(contact.requirementMaxPrice);
  let priceStatus: MatchVerdict | "unknown" = "unknown";
  const priceReasons: string[] = [];
  if (price != null) {
    priceStatus = "yes";
    if (minPrice != null && price < minPrice) {
      mismatches.push("price is below the minimum budget");
      hardMismatches.push("price is below the minimum budget");
      priceStatus = "no";
      priceReasons.push("below minimum budget");
    } else if (minPrice != null) {
      matches.push("price is above minimum budget");
      priceReasons.push("above minimum budget");
    }

    if (maxPrice != null && price > maxPrice) {
      mismatches.push("price exceeds maximum budget");
      hardMismatches.push("price exceeds maximum budget");
      priceStatus = "no";
      priceReasons.push("exceeds maximum budget");
    } else if (maxPrice != null) {
      matches.push("price is within maximum budget");
      priceReasons.push("within maximum budget");
    }
  } else if (minPrice != null || maxPrice != null) {
    unknowns.push("property price is missing");
  }
  if (minPrice != null || maxPrice != null || price != null) {
    addDimension(dimensions, {
      key: "price",
      label: "Price",
      propertyValue: price,
      requirementValue: [display(contact.requirementMinPrice), display(contact.requirementMaxPrice)].filter(Boolean).join(" - ") || null,
      status: minPrice == null && maxPrice == null ? "unknown" : priceStatus,
      weight: 3,
      reason: priceReasons.length ? `Price is ${priceReasons.join(" and ")}.` : "Budget is broad or unclear.",
    });
  }

  const propertyLocations = [property.propertyLocation, property.city, property.propertyArea].map(normalize).filter(Boolean);
  const propertyLocationInfo = mergeLocationInfo(propertyLocations);
  const requiredDistrict = normalize(contact.requirementDistrict);
  const requiredLocations = normalizeList(contact.requirementPropertyLocations);
  const hasLocationRequirement = !isAny(requiredDistrict) || requiredLocations.length > 0;
  let locationStatus: MatchVerdict | "unknown" = "unknown";
  let locationReason = "Location requirement is broad or unclear.";
  if (hasLocationRequirement && propertyLocations.length > 0) {
    const requirementInfo = mergeLocationInfo([requiredDistrict, ...requiredLocations]);
    const hasSpecificRequiredArea = requirementInfo.areas.length > 0;
    const districtMatches = !hasSpecificRequiredArea && (
      requirementInfo.districts.some((district) => propertyLocationInfo.districts.includes(district))
      || (!isAny(requiredDistrict) && includesLoose(propertyLocations, requiredDistrict))
    );
    const areaMatches = requirementInfo.areas.some((area) => propertyLocationInfo.areas.includes(area));
    const locationMatches = requirementInfo.areas.some((area) => propertyLocationInfo.areas.includes(area))
      || requiredLocations.some((item) => includesLoose(propertyLocations, item));
    const structuredLocationMatches = hasSpecificRequiredArea ? areaMatches || locationMatches : districtMatches || locationMatches;
    if (structuredLocationMatches) matches.push("location matches");
    else {
      mismatches.push("location does not match");
      hardMismatches.push("location does not match");
    }
    locationStatus = structuredLocationMatches ? "yes" : "no";
    locationReason = structuredLocationMatches ? "Location matches structured requirement." : "Location conflicts with structured requirement.";
  } else if (hasLocationRequirement) {
    unknowns.push("property location is missing");
  }
  const recentDistrictMismatch = recentIntent.districts.length > 0
    && propertyLocationInfo.districts.length > 0
    && !recentIntent.districts.some((district) => propertyLocationInfo.districts.includes(district));
  const recentAreaMismatch = !recentDistrictMismatch
    && recentIntent.areas.length > 0
    && propertyLocationInfo.areas.length > 0
    && !recentIntent.areas.some((area) => propertyLocationInfo.areas.includes(area));
  if (recentDistrictMismatch) {
    mismatches.push("recent lead intent points to a different district/city");
    hardMismatches.push("recent lead intent points to a different district/city");
    locationStatus = "no";
    locationReason = "Recent lead intent points to a different district/city.";
  } else if (recentAreaMismatch && locationStatus !== "no") {
    unknowns.push("recent lead intent points to a different local area");
    locationStatus = "maybe";
    locationReason = "Same district, but recent lead intent points to a different local area.";
  }
  addDimension(dimensions, {
    key: "location",
    label: "Location",
    propertyValue: propertyLocations.join(", ") || null,
    requirementValue: [display(contact.requirementDistrict), display(contact.requirementPropertyLocations), recentIntent.areas.length || recentIntent.districts.length ? `Recent: ${[...recentIntent.areas, ...recentIntent.districts].join(", ")}` : null].filter(Boolean).join(" | ") || null,
    status: locationStatus,
    weight: 5,
    reason: locationReason,
  });

  const requiredCondition = normalize(contact.requirementCondition);
  const propertyCondition = normalize(property.condition);
  if (!isAny(requiredCondition) && propertyCondition) {
    if (propertyCondition.includes(requiredCondition) || requiredCondition.includes(propertyCondition)) {
      matches.push("condition matches");
    } else {
      unknowns.push("condition preference needs review");
    }
    addDimension(dimensions, {
      key: "condition",
      label: "Condition",
      propertyValue: display(property.condition),
      requirementValue: display(contact.requirementCondition),
      status: propertyCondition.includes(requiredCondition) || requiredCondition.includes(propertyCondition) ? "yes" : "maybe",
      weight: 1,
      reason: propertyCondition.includes(requiredCondition) || requiredCondition.includes(propertyCondition) ? "Condition matches." : "Condition needs review.",
    });
  }

  const hasUnstructuredRequirements = Boolean(
    normalize(contact.requirementOtherDetails) || normalize(contact.requirementSummary)
  );
  const concreteRequirementCount = [
    !isAny(contact.requirementStatus),
    requiredTypes.length > 0,
    !isAny(contact.requirementBedrooms),
    minPrice != null || maxPrice != null,
    hasLocationRequirement,
    !isAny(contact.requirementCondition),
    hasUnstructuredRequirements,
  ].filter(Boolean).length;
  const sparseLead = concreteRequirementCount <= 1;
  if (sparseLead) unknowns.push("lead has sparse requirements");
  if (sparseLead) {
    addDimension(dimensions, {
      key: "sparse",
      label: "Requirement Depth",
      propertyValue: null,
      requirementValue: "Sparse",
      status: "maybe",
      weight: 2,
      score: -1,
      reason: "Lead has too few concrete requirements for a confident recommendation.",
    });
  }

  const score = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.score, 0) * 100) / 100;

  if (disqualifiers.length > 0) {
    return { verdict: "no", score: Math.min(score, -5), needsAi: false, matches, mismatches, unknowns, dimensions, hardMismatches, disqualifiers, recentIntent };
  }

  if (hardMismatches.length > 0) {
    return { verdict: "no", score, needsAi: false, matches, mismatches, unknowns, dimensions, hardMismatches, disqualifiers, recentIntent };
  }

  if (sparseLead) {
    return { verdict: "maybe", score, needsAi: true, matches, mismatches, unknowns, dimensions, hardMismatches, disqualifiers, recentIntent };
  }

  if (recentAreaMismatch) {
    return { verdict: "maybe", score, needsAi: true, matches, mismatches, unknowns, dimensions, hardMismatches, disqualifiers, recentIntent };
  }

  if (matches.length >= 3 && !hasUnstructuredRequirements && unknowns.length <= 1 && score >= 6) {
    return { verdict: "yes", score, needsAi: false, matches, mismatches, unknowns, dimensions, hardMismatches, disqualifiers, recentIntent };
  }

  if (matches.length >= 2 && !hasUnstructuredRequirements && unknowns.length <= 2 && score >= 5) {
    return { verdict: "yes", score, needsAi: false, matches, mismatches, unknowns, dimensions, hardMismatches, disqualifiers, recentIntent };
  }

  return { verdict: "maybe", score, needsAi: true, matches, mismatches, unknowns, dimensions, hardMismatches, disqualifiers, recentIntent };
}
