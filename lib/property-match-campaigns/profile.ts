export const PROPERTY_MATCH_PROFILE_SCHEMA_VERSION = 2;

export type InteractionPropertySnapshot = {
  id: string | null;
  reference: string | null;
  title: string | null;
  goal: string | null;
  type: string | null;
  price: number | null;
  bedrooms: number | null;
  areaSqm: number | null;
  city: string | null;
  propertyLocation: string | null;
  propertyArea: string | null;
  condition: string | null;
  features: string[];
};

export type PropertyInteractionExample = {
  eventType: string;
  sentiment: string | null;
  reason: string | null;
  occurredAt: string | null;
  property: InteractionPropertySnapshot;
};

export type PropertyMatchCriterion<T> = {
  value: T | null;
  certainty: "hard" | "soft" | "possible" | "unknown";
  confidence: number;
  source: "assessed_requirement" | "legacy_requirement" | "contact_profile" | "default";
  observedAt: string | null;
};

export type PropertyInteractionSignal = {
  eventType: string;
  sentiment?: string | null;
  propertyReference?: string | null;
  occurredAt?: Date | string | null;
  evidence?: unknown;
  property?: Record<string, unknown> | null;
};

export type ContactPropertyMatchProfile = {
  schemaVersion: number;
  status: "ready" | "sparse" | "ineligible";
  eligibility: {
    status: "eligible" | "ineligible" | "unknown";
    confidence: number;
    reasons: string[];
  };
  requirements: {
    goal: PropertyMatchCriterion<string>;
    district: PropertyMatchCriterion<string>;
    bedrooms: PropertyMatchCriterion<string>;
    minPrice: PropertyMatchCriterion<string>;
    maxPrice: PropertyMatchCriterion<string>;
    condition: PropertyMatchCriterion<string>;
    propertyTypes: PropertyMatchCriterion<string[]>;
    propertyLocations: PropertyMatchCriterion<string[]>;
    otherDetails: PropertyMatchCriterion<string>;
    summary: PropertyMatchCriterion<string>;
    anchorCount: number;
    freshness: "assessed" | "stale" | "unassessed";
  };
  interactions: {
    sentPropertyReferences: string[];
    positivePropertyReferences: string[];
    negativePropertyReferences: string[];
    sentCount: number;
    positiveCount: number;
    negativeCount: number;
    latestInteractionAt: string | null;
    positiveExamples: PropertyInteractionExample[];
    negativeExamples: PropertyInteractionExample[];
  };
  requirementSummary: string;
  interactionSummary: string;
  sourceContactUpdatedAt: string | null;
  evidenceWatermarkAt: string | null;
};

type ContactProfileInput = Record<string, any>;

function normalize(value: unknown): string {
  return String(value || "").trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalize).filter(Boolean)));
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isBroad(value: unknown): boolean {
  const text = normalize(value).toLowerCase();
  return !text || text === "any" || text.startsWith("any ");
}

function criterion<T>(args: {
  value: T | null;
  isKnown: boolean;
  assessedAt: string | null;
  source?: PropertyMatchCriterion<T>["source"];
  soft?: boolean;
}): PropertyMatchCriterion<T> {
  if (!args.isKnown || args.value == null) {
    return { value: null, certainty: "unknown", confidence: 0, source: "default", observedAt: null };
  }
  if (args.soft) {
    return {
      value: args.value,
      certainty: "soft",
      confidence: args.assessedAt ? 0.85 : 0.65,
      source: args.assessedAt ? "assessed_requirement" : args.source || "legacy_requirement",
      observedAt: args.assessedAt,
    };
  }
  return {
    value: args.value,
    certainty: args.assessedAt ? "hard" : "possible",
    confidence: args.assessedAt ? 0.95 : 0.55,
    source: args.assessedAt ? "assessed_requirement" : args.source || "legacy_requirement",
    observedAt: args.assessedAt,
  };
}

function stoppedSearch(text: string): boolean {
  return /\b(already\s+(bought|purchased|rented|found)|not\s+(looking|searching|interested)\s+any\s*more|no\s+longer\s+(looking|searching)|stop\s+(sending|contacting|messaging)|remove\s+me|unsubscribe)\b/i.test(text);
}

function interactionReference(signal: PropertyInteractionSignal): string | null {
  return normalize(signal.propertyReference) || null;
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function interactionExample(signal: PropertyInteractionSignal): PropertyInteractionExample | null {
  if (!signal.property || typeof signal.property !== "object") return null;
  const property = signal.property as Record<string, unknown>;
  const evidence = signal.evidence && typeof signal.evidence === "object"
    ? signal.evidence as Record<string, unknown>
    : {};
  const reference = normalize(property.reference || signal.propertyReference) || null;
  const id = normalize(property.id) || null;
  if (!id && !reference) return null;
  return {
    eventType: signal.eventType,
    sentiment: normalize(signal.sentiment) || null,
    reason: normalize(evidence.reason) || null,
    occurredAt: toIso(signal.occurredAt),
    property: {
      id,
      reference,
      title: normalize(property.title) || null,
      goal: normalize(property.goal) || null,
      type: normalize(property.type) || null,
      price: finiteNumber(property.price),
      bedrooms: finiteNumber(property.bedrooms),
      areaSqm: finiteNumber(property.areaSqm),
      city: normalize(property.city) || null,
      propertyLocation: normalize(property.propertyLocation) || null,
      propertyArea: normalize(property.propertyArea) || null,
      condition: normalize(property.condition) || null,
      features: uniqueStrings(Array.isArray(property.features) ? property.features : []),
    },
  };
}

function signalSentimentGroup(signal: PropertyInteractionSignal): "positive" | "negative" | null {
  if (signal.sentiment === "positive" || ["liked", "viewing_requested"].includes(signal.eventType)) return "positive";
  if (signal.sentiment === "negative" || signal.eventType === "rejected") return "negative";
  return null;
}

function latestInteractionExamples(interactionSignals: PropertyInteractionSignal[]) {
  const seen = new Set<string>();
  const positive: PropertyInteractionExample[] = [];
  const negative: PropertyInteractionExample[] = [];
  const sorted = [...interactionSignals].sort((left, right) => (
    String(toIso(right.occurredAt) || "").localeCompare(String(toIso(left.occurredAt) || ""))
  ));
  for (const signal of sorted) {
    const group = signalSentimentGroup(signal);
    const example = group ? interactionExample(signal) : null;
    if (!group || !example) continue;
    const key = example.property.id || example.property.reference;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (group === "positive") positive.push(example);
    else negative.push(example);
  }
  return { positive: positive.slice(0, 20), negative: negative.slice(0, 20) };
}

export function buildContactPropertyMatchProfile(
  contact: ContactProfileInput,
  interactionSignals: PropertyInteractionSignal[] = [],
): ContactPropertyMatchProfile {
  const assessedAt = toIso(contact.requirementsLastAssessedAt);
  const dueAt = toIso(contact.requirementsAssessmentDueAt);
  const isStale = Boolean(dueAt && new Date(dueAt) <= new Date());
  const effectiveAssessedAt = isStale ? null : assessedAt;
  const summaryText = [
    contact.requirementSummary,
    contact.requirementOtherDetails,
    contact.recentMessagesText,
  ].map(normalize).filter(Boolean).join("\n");

  const contactType = normalize(contact.contactType).toLowerCase();
  const verification = normalize(contact.profileVerificationStatus).toLowerCase();
  const ineligibleTypes = new Set(["owner", "agent", "partner", "associate", "maintenance", "whatsappgroup"]);
  const ineligibleVerification = new Set(["likely_owner", "likely_agent", "not_a_lead"]);
  const eligibilityReasons: string[] = [];
  if (ineligibleTypes.has(contactType)) eligibilityReasons.push(`contact type is ${contact.contactType}`);
  if (ineligibleVerification.has(verification)) eligibilityReasons.push(`profile verification is ${contact.profileVerificationStatus}`);
  if (stoppedSearch(summaryText)) eligibilityReasons.push("contact has indicated that the search has stopped");
  const eligibilityStatus = eligibilityReasons.length > 0
    ? "ineligible"
    : verification === "verified_lead"
      ? "eligible"
      : "unknown";

  const types = uniqueStrings(Array.isArray(contact.requirementPropertyTypes) ? contact.requirementPropertyTypes : []);
  const locations = uniqueStrings(Array.isArray(contact.requirementPropertyLocations) ? contact.requirementPropertyLocations : []);
  const requirements = {
    goal: criterion({
      value: normalize(contact.leadGoal || contact.requirementStatus) || null,
      isKnown: !isBroad(contact.leadGoal || contact.requirementStatus),
      assessedAt: effectiveAssessedAt,
      source: "contact_profile" as const,
    }),
    district: criterion({ value: normalize(contact.requirementDistrict) || null, isKnown: !isBroad(contact.requirementDistrict), assessedAt: effectiveAssessedAt }),
    bedrooms: criterion({ value: normalize(contact.requirementBedrooms) || null, isKnown: !isBroad(contact.requirementBedrooms), assessedAt: effectiveAssessedAt }),
    minPrice: criterion({ value: normalize(contact.requirementMinPrice) || null, isKnown: !isBroad(contact.requirementMinPrice), assessedAt: effectiveAssessedAt }),
    maxPrice: criterion({ value: normalize(contact.requirementMaxPrice) || null, isKnown: !isBroad(contact.requirementMaxPrice), assessedAt: effectiveAssessedAt }),
    condition: criterion({ value: normalize(contact.requirementCondition) || null, isKnown: !isBroad(contact.requirementCondition), assessedAt: effectiveAssessedAt }),
    propertyTypes: criterion({ value: types.length ? types : null, isKnown: types.length > 0, assessedAt: effectiveAssessedAt }),
    propertyLocations: criterion({ value: locations.length ? locations : null, isKnown: locations.length > 0, assessedAt: effectiveAssessedAt }),
    otherDetails: criterion({ value: normalize(contact.requirementOtherDetails) || null, isKnown: Boolean(normalize(contact.requirementOtherDetails)), assessedAt: effectiveAssessedAt, soft: true }),
    summary: criterion({ value: normalize(contact.requirementSummary) || null, isKnown: Boolean(normalize(contact.requirementSummary)), assessedAt: effectiveAssessedAt, soft: true }),
  };

  const anchorCount = [
    requirements.district.value,
    requirements.bedrooms.value,
    requirements.minPrice.value || requirements.maxPrice.value,
    requirements.condition.value,
    requirements.propertyTypes.value,
    requirements.propertyLocations.value,
    requirements.otherDetails.value,
    requirements.summary.value,
  ].filter(Boolean).length;

  const legacySent = uniqueStrings(Array.isArray(contact.propertiesEmailed) ? contact.propertiesEmailed : []);
  const legacyPositive = uniqueStrings([
    ...(Array.isArray(contact.propertiesInterested) ? contact.propertiesInterested : []),
    ...(Array.isArray(contact.propertiesInspected) ? contact.propertiesInspected : []),
  ]);
  const sentSignals = interactionSignals.filter((signal) => signal.eventType === "sent");
  const positiveSignals = interactionSignals.filter((signal) => signal.sentiment === "positive" || ["liked", "viewing_requested"].includes(signal.eventType));
  const negativeSignals = interactionSignals.filter((signal) => signal.sentiment === "negative" || signal.eventType === "rejected");
  const sentPropertyReferences = uniqueStrings([...legacySent, ...sentSignals.map(interactionReference)]);
  const positivePropertyReferences = uniqueStrings([...legacyPositive, ...positiveSignals.map(interactionReference)]);
  const negativePropertyReferences = uniqueStrings(negativeSignals.map(interactionReference));
  const currentExamples = latestInteractionExamples(interactionSignals);
  const positiveExamples = currentExamples.positive;
  const negativeExamples = currentExamples.negative;
  const interactionDates = interactionSignals.map((signal) => toIso(signal.occurredAt)).filter(Boolean) as string[];
  const latestInteractionAt = interactionDates.sort().at(-1) || null;
  const evidenceWatermarkAt = latestInteractionAt || toIso(contact.requirementsLastAssessedAt) || null;

  const requirementLines = [
    requirements.goal.value ? `Goal: ${requirements.goal.value}` : null,
    requirements.propertyTypes.value?.length ? `Types: ${requirements.propertyTypes.value.join(", ")}` : null,
    requirements.propertyLocations.value?.length ? `Locations: ${requirements.propertyLocations.value.join(", ")}` : requirements.district.value ? `District: ${requirements.district.value}` : null,
    requirements.bedrooms.value ? `Bedrooms: ${requirements.bedrooms.value}` : null,
    requirements.minPrice.value || requirements.maxPrice.value ? `Budget: ${[requirements.minPrice.value, requirements.maxPrice.value].filter(Boolean).join(" – ")}` : null,
    requirements.summary.value || requirements.otherDetails.value,
  ].filter(Boolean) as string[];
  const interactionLines = [
    sentPropertyReferences.length ? `${sentPropertyReferences.length} properties sent (neutral exposure)` : null,
    positivePropertyReferences.length ? `${positivePropertyReferences.length} positive property signals` : null,
    negativePropertyReferences.length ? `${negativePropertyReferences.length} negative property signals` : null,
  ].filter(Boolean) as string[];
  const status = eligibilityStatus === "ineligible" ? "ineligible" : anchorCount >= 2 ? "ready" : "sparse";

  return {
    schemaVersion: PROPERTY_MATCH_PROFILE_SCHEMA_VERSION,
    status,
    eligibility: {
      status: eligibilityStatus,
      confidence: eligibilityStatus === "ineligible" ? 0.98 : eligibilityStatus === "eligible" ? 0.9 : 0.35,
      reasons: eligibilityReasons,
    },
    requirements: {
      ...requirements,
      anchorCount,
      freshness: isStale ? "stale" : assessedAt ? "assessed" : "unassessed",
    },
    interactions: {
      sentPropertyReferences,
      positivePropertyReferences,
      negativePropertyReferences,
      sentCount: sentPropertyReferences.length,
      positiveCount: positivePropertyReferences.length,
      negativeCount: negativePropertyReferences.length,
      latestInteractionAt,
      positiveExamples,
      negativeExamples,
    },
    requirementSummary: requirementLines.join(". ") || "No concrete current requirements are known.",
    interactionSummary: interactionLines.join(". ") || "No property interaction evidence is recorded.",
    sourceContactUpdatedAt: toIso(contact.updatedAt),
    evidenceWatermarkAt,
  };
}

export function resolveContactPropertyMatchProfile(contact: ContactProfileInput): ContactPropertyMatchProfile {
  const stored = contact.propertyMatchProfile;
  const storedSourceAt = toIso(stored?.sourceContactUpdatedAt);
  const contactUpdatedAt = toIso(contact.updatedAt);
  if (
    stored
    && Number(stored.schemaVersion) === PROPERTY_MATCH_PROFILE_SCHEMA_VERSION
    && (!contactUpdatedAt || (storedSourceAt && storedSourceAt >= contactUpdatedAt))
  ) {
    return {
      schemaVersion: stored.schemaVersion,
      status: stored.status,
      eligibility: stored.eligibilityProfile,
      requirements: stored.requirementProfile,
      interactions: stored.interactionProfile,
      requirementSummary: stored.requirementSummary || "No concrete current requirements are known.",
      interactionSummary: stored.interactionSummary || "No property interaction evidence is recorded.",
      sourceContactUpdatedAt: storedSourceAt,
      evidenceWatermarkAt: toIso(stored.evidenceWatermarkAt),
    } as ContactPropertyMatchProfile;
  }
  return buildContactPropertyMatchProfile(contact, contact.propertyMatchInteractions || []);
}
