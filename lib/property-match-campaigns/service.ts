import db from "@/lib/db";
import { calculateRunCost } from "@/lib/ai/pricing";
import { GEMINI_FLASH_LITE_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { callLLMWithMetadata } from "@/lib/ai/llm";
import { resolveAiModelDefault } from "@/lib/ai/fetch-models";
import {
  CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX,
  stripChatGptSubscriptionModelPrefix,
} from "@/lib/ai/chatgpt-subscription";
import { OPENAI_MODEL_VALUE_PREFIX } from "@/lib/ai/openai-models";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { deriveComposerInitialChannel } from "@/lib/conversations/channel-summary";
import { resolvePropertyPublicUrl } from "@/lib/properties/public-url";
import { extractLegacyCrmRefCandidates } from "@/lib/crm/old-crm-import";
import { importOldCrmPropertyToLocalDb } from "@/lib/crm/old-crm-property-import-service";
import { getLocationMarketContext, type LocationMarketContext } from "@/lib/locations/market-context";
import {
  evaluateStructuredPropertyMatch,
  type MatchVerdict,
  type PropertyMatchInput,
  type ContactRequirementInput,
  type StructuredMatchResult,
} from "@/lib/property-match-campaigns/matching";
import { resolveContactPropertyMatchProfile } from "@/lib/property-match-campaigns/profile";
import { recordContactPropertyInteraction } from "@/lib/property-match-campaigns/profile-service";
import {
  comparePropertyToInteractionProfile,
  type PropertyInteractionSimilarity,
} from "@/lib/property-match-campaigns/interaction-similarity";
import { acquirePropertyMatchCampaignWorkerLease } from "@/lib/property-match-campaigns/worker-lease";

type AnyRecord = Record<string, any>;
export type PropertyMatchCampaignQueue =
  | "review"
  | "approved"
  | "sent"
  | "skipped"
  | "rejected"
  | "needs_profile_verification"
  | "ai_error"
  | "not_match"
  | "already_shared"
  | "all";
export type PropertyMatchFallbackPolicy = "same_provider" | "allow_paid";

const CAMPAIGN_STATUSES = new Set(["draft", "processing", "review", "completed", "canceled", "failed"]);
const REVIEWER_STATUSES = new Set(["pending", "approved", "rejected", "sent", "skipped"]);
const LOW_CONFIDENCE_YES_THRESHOLD = 0.72;
const PROPERTY_MATCH_THINKING_BUDGET = Math.max(
  256,
  Math.min(4096, Number(process.env.PROPERTY_MATCH_THINKING_BUDGET || 1024)),
);
const AI_REVIEW_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const CONTACT_COLLECTION_BATCH_SIZE = 40;
const AI_SCORING_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.PROPERTY_MATCH_AI_SCORING_CONCURRENCY || 4)));
const PROPERTY_MATCH_FAST_MODEL = String(process.env.PROPERTY_MATCH_FAST_MODEL || GEMINI_FLASH_LITE_LATEST_ALIAS).trim() || GEMINI_FLASH_LITE_LATEST_ALIAS;
const DEFAULT_PROPERTY_MATCH_FALLBACK_POLICY: PropertyMatchFallbackPolicy = "same_provider";
const CAMPAIGN_STOPPED_STATUS = "canceled";
const CAMPAIGN_STOPPED_ERROR = "Processing stopped by user.";
const PROPERTY_TYPE_HINTS = [
  "Studio",
  "Apartment",
  "House",
  "Villa",
  "Townhouse",
  "Maisonette",
  "Penthouse",
  "Office",
  "Shop",
  "Plot",
  "Land",
];

const PROPERTY_MATCH_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommend: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    matchSummary: { type: "string" },
    reasoning: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          quote: { type: "string" },
          supports: { type: "string", enum: ["yes", "maybe", "no"] },
        },
        required: ["field", "quote", "supports"],
      },
    },
  },
  required: ["recommend", "confidence", "matchSummary", "reasoning", "evidence"],
};

export function normalizePropertyMatchFallbackPolicy(value: unknown): PropertyMatchFallbackPolicy {
  return value === "allow_paid" ? "allow_paid" : DEFAULT_PROPERTY_MATCH_FALLBACK_POLICY;
}

function propertyMatchModelProvider(model: string): "chatgpt_subscription" | "openai" | "gemini" {
  if (model.startsWith(CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX)) return "chatgpt_subscription";
  if (model.startsWith(OPENAI_MODEL_VALUE_PREFIX)) return "openai";
  return "gemini";
}

function sameProviderFallbackModel(model: string): string | null {
  const provider = propertyMatchModelProvider(model);
  if (provider === "chatgpt_subscription") {
    const raw = stripChatGptSubscriptionModelPrefix(model);
    return raw === "gpt-5.4"
      ? `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.5`
      : `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.4`;
  }
  if (provider === "gemini") {
    return model === GEMINI_FLASH_STABLE_FALLBACK ? null : GEMINI_FLASH_STABLE_FALLBACK;
  }
  return model === `${OPENAI_MODEL_VALUE_PREFIX}gpt-4.1`
    ? null
    : `${OPENAI_MODEL_VALUE_PREFIX}gpt-4.1`;
}

export function buildPropertyMatchModelAttempts(
  primaryModel: string,
  fallbackPolicy: PropertyMatchFallbackPolicy,
): string[] {
  const primary = normalizeText(primaryModel, 120) || PROPERTY_MATCH_FAST_MODEL;
  const attempts = [primary, primary];
  const sameProvider = sameProviderFallbackModel(primary);
  if (sameProvider && sameProvider !== primary) attempts.push(sameProvider);
  if (
    fallbackPolicy === "allow_paid"
    && propertyMatchModelProvider(primary) === "chatgpt_subscription"
    && !attempts.includes(GEMINI_FLASH_STABLE_FALLBACK)
  ) {
    attempts.push(GEMINI_FLASH_STABLE_FALLBACK);
  }
  return attempts;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

function logPropertyMatchCampaignTiming(event: string, fields: Record<string, unknown> = {}) {
  console.info("[Property Match Campaign Timing]", JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...fields,
  }));
}

export function hasPriorPropertyShareEvidence(candidate: {
  evidence?: unknown;
  matchSummary?: unknown;
  reasoning?: unknown;
}): boolean {
  const evidence = (candidate.evidence || {}) as AnyRecord;
  return Boolean(evidence.priorShare)
    || String(candidate.matchSummary || "").toLowerCase().includes("already shared")
    || String(candidate.reasoning || "").toLowerCase().includes("already been shared");
}

export function hasProfileVerificationBlock(candidate: {
  evidence?: unknown;
  matchSummary?: unknown;
  reasoning?: unknown;
}): boolean {
  const evidence = (candidate.evidence || {}) as AnyRecord;
  return Boolean(evidence.profileVerificationBlock)
    || String(candidate.matchSummary || "").toLowerCase().includes("needs profile verification")
    || String(candidate.reasoning || "").toLowerCase().includes("not globally verified");
}

export function propertyMatchCandidateQueue(candidate: {
  aiVerdict?: unknown;
  aiReviewStatus?: unknown;
  reviewerStatus?: unknown;
  contact?: { profileVerificationStatus?: unknown } | null;
  profileVerificationStatus?: unknown;
  evidence?: unknown;
  matchSummary?: unknown;
  reasoning?: unknown;
}): PropertyMatchCampaignQueue | "processing" {
  const reviewerStatus = String(candidate.reviewerStatus || "pending");
  const aiVerdict = String(candidate.aiVerdict || "maybe");
  const aiReviewStatus = String(candidate.aiReviewStatus || "done");

  if (reviewerStatus === "sent") return "sent";
  if (reviewerStatus === "approved") return "approved";
  if (reviewerStatus === "skipped") return "skipped";
  if (reviewerStatus === "rejected") return "rejected";
  if (hasPriorPropertyShareEvidence(candidate)) return "already_shared";
  if (hasProfileVerificationBlock(candidate)) return "needs_profile_verification";
  if (aiReviewStatus === "pending" || aiReviewStatus === "processing") return "processing";
  if (aiReviewStatus === "failed") return "ai_error";
  if (reviewerStatus === "pending" && aiVerdict === "no") return "not_match";
  if (reviewerStatus === "pending" && (aiVerdict === "yes" || aiVerdict === "maybe")) return "review";
  return "not_match";
}

export function summarizePropertyMatchCandidateQueues(rows: Array<{
  aiVerdict?: unknown;
  aiReviewStatus?: unknown;
  reviewerStatus?: unknown;
  contact?: { profileVerificationStatus?: unknown } | null;
  profileVerificationStatus?: unknown;
  evidence?: unknown;
  matchSummary?: unknown;
  reasoning?: unknown;
}>) {
  const counts = {
    allCount: rows.length,
    pendingAiCount: 0,
    queuedAiCount: 0,
    processingAiCount: 0,
    reviewCount: 0,
    approvedCount: 0,
    sentCount: 0,
    skippedCount: 0,
    rejectedCount: 0,
    needsProfileVerificationCount: 0,
    aiErrorCount: 0,
    notMatchCount: 0,
    alreadySharedCount: 0,
  };

  for (const row of rows) {
    const queue = propertyMatchCandidateQueue(row);
    if (queue === "processing") {
      counts.pendingAiCount += 1;
      if (row.aiReviewStatus === "processing") counts.processingAiCount += 1;
      else counts.queuedAiCount += 1;
    }
    else if (queue === "review") counts.reviewCount += 1;
    else if (queue === "approved") counts.approvedCount += 1;
    else if (queue === "sent") counts.sentCount += 1;
    else if (queue === "skipped") counts.skippedCount += 1;
    else if (queue === "rejected") counts.rejectedCount += 1;
    else if (queue === "needs_profile_verification") counts.needsProfileVerificationCount += 1;
    else if (queue === "ai_error") counts.aiErrorCount += 1;
    else if (queue === "not_match") counts.notMatchCount += 1;
    else if (queue === "already_shared") counts.alreadySharedCount += 1;
  }

  return counts;
}

export function attachPropertyMatchAiRunEvidence(evidence: unknown, run: {
  modelRequested: string;
  modelUsed: string;
  provider?: string | null;
  scoredAt?: string | null;
}) {
  return {
    ...((evidence || {}) as AnyRecord),
    aiRun: {
      modelRequested: run.modelRequested,
      modelUsed: run.modelUsed,
      provider: run.provider || null,
      scoredAt: run.scoredAt || new Date().toISOString(),
    },
  };
}

function normalizeText(value: unknown, max = 4000): string | null {
  const text = String(value || "").trim();
  return text ? text.slice(0, max).trim() : null;
}

function normalizeVerdict(value: unknown): MatchVerdict {
  const text = String(value || "").trim().toLowerCase();
  return text === "yes" || text === "no" || text === "maybe" ? text : "maybe";
}

function normalizeSearchToken(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeUrlToken(value: unknown): string | null {
  const text = normalizeText(value, 1200);
  if (!text) return null;
  return text.replace(/[)\].,;!?]+$/g, "").replace(/\/+$/g, "");
}

export function buildPriorPropertyShareSearchTerms(snapshot: AnyRecord): {
  referenceTerms: string[];
  urlTerms: string[];
} {
  const reference = normalizeText(snapshot.reference, 120);
  const sourceUrl = normalizeUrlToken(snapshot.sourceUrl);
  const urlTerms = new Set<string>();
  if (sourceUrl) {
    urlTerms.add(sourceUrl);
    urlTerms.add(sourceUrl.replace(/^https?:\/\//i, ""));
  }

  return {
    referenceTerms: reference ? [reference] : [],
    urlTerms: Array.from(urlTerms).filter((term) => term.length >= 8),
  };
}

export function findPriorPropertyShareEvidence(args: {
  snapshot: AnyRecord;
  messages: Array<{
    id?: string | null;
    body?: string | null;
    direction?: string | null;
    createdAt?: Date | string | null;
  }>;
}) {
  const terms = buildPriorPropertyShareSearchTerms(args.snapshot);
  if (terms.referenceTerms.length === 0 && terms.urlTerms.length === 0) return null;

  for (const message of args.messages) {
    const body = String(message.body || "");
    const lowerBody = body.toLowerCase();
    const matchedBy: string[] = [];
    const matchedTerms: string[] = [];

    for (const term of terms.urlTerms) {
      if (lowerBody.includes(term.toLowerCase())) {
        matchedBy.push("url");
        matchedTerms.push(term);
        break;
      }
    }
    for (const term of terms.referenceTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
      if (pattern.test(body)) {
        matchedBy.push("reference");
        matchedTerms.push(term);
        break;
      }
    }

    if (matchedBy.length > 0) {
      return {
        alreadyShared: true,
        matchedBy: Array.from(new Set(matchedBy)),
        matchedTerms: Array.from(new Set(matchedTerms)),
        messageId: message.id || null,
        messageDirection: message.direction || null,
        messageCreatedAt: message.createdAt instanceof Date
          ? message.createdAt.toISOString()
          : message.createdAt || null,
        quote: normalizeText(body, 500),
      };
    }
  }

  return null;
}

export function sortPropertyMatchSearchRows<T extends {
  reference?: string | null;
  title?: string | null;
  slug?: string | null;
  city?: string | null;
  propertyLocation?: string | null;
  updatedAt?: Date | string | null;
}>(query: string, rows: T[]): T[] {
  const token = normalizeSearchToken(query);
  if (!token) return rows;
  const score = (row: T) => {
    const reference = normalizeSearchToken(row.reference);
    const title = normalizeSearchToken(row.title);
    const slug = normalizeSearchToken(row.slug);
    const location = normalizeSearchToken([row.propertyLocation, row.city].filter(Boolean).join(" "));
    if (reference === token) return 0;
    if (reference.startsWith(token)) return 1;
    if (reference.includes(token)) return 2;
    if (slug === token || slug.includes(token)) return 3;
    if (title.includes(token)) return 4;
    if (location.includes(token)) return 5;
    return 6;
  };
  return [...rows].sort((a, b) => {
    const scoreDiff = score(a) - score(b);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
}

function extractJsonObject(text: string): AnyRecord {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty AI response.");
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON.");
    return JSON.parse(match[0]);
  }
}

export function normalizeAiMatchAssessment(raw: AnyRecord, fallbackEvidence: AnyRecord = {}) {
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0.5;
  const requestedVerdict = typeof raw.recommend === "boolean"
    ? raw.recommend ? "yes" : "no"
    : normalizeVerdict(raw.verdict);
  const structuredEvidence = fallbackEvidence?.structured || {};
  const qualificationEvidence = structuredEvidence.qualificationEvidence || null;
  const hasDisqualifier = Array.isArray(structuredEvidence.disqualifiers) && structuredEvidence.disqualifiers.length > 0;
  const hasStructuredBlocker = hasDisqualifier;
  const lacksPositiveEvidence = Boolean(qualificationEvidence) && (
    Boolean(qualificationEvidence.sparseLead)
    || Number(qualificationEvidence.anchorCount || 0) < Number(qualificationEvidence.minimumAnchorsForYes || 2)
    || Number(qualificationEvidence.concreteFitAnchorCount || 0) < Number(qualificationEvidence.minimumConcreteFitAnchorsForYes || 2)
    || Number(qualificationEvidence.groundingFitAnchorCount || 0) < 1
  );
  const verdict: MatchVerdict = hasStructuredBlocker
    ? "no"
    : requestedVerdict === "yes" && lacksPositiveEvidence
    ? "no"
    : requestedVerdict === "yes" && confidence < LOW_CONFIDENCE_YES_THRESHOLD
    ? "no"
    : requestedVerdict;

  return {
    verdict,
    confidence,
    reasoning: verdict === "no" && requestedVerdict === "yes" && lacksPositiveEvidence
      ? "Do not recommend: the contact lacks enough concrete positive evidence."
      : normalizeText(raw.reasoning, 3000) || (
        verdict === "no" && requestedVerdict === "yes"
          ? "Do not recommend: AI confidence was below the recommendation threshold."
          : hasStructuredBlocker
            ? "The contact is not eligible to receive property recommendations."
          : "AI compared the contact summary with the property summary."
      ),
    matchSummary: normalizeText(raw.matchSummary || raw.summary, 1200) || "AI compared the contact and property summaries.",
    evidence: {
      ...fallbackEvidence,
      structured: {
        ...(fallbackEvidence?.structured || {}),
        needsAi: false,
      },
      ai: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 8) : [],
    },
  };
}

function propertySnapshot(property: AnyRecord) {
  return {
    id: property.id,
    title: property.title,
    reference: property.reference,
    goal: property.goal,
    type: property.type,
    price: property.price,
    currency: property.currency,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    areaSqm: property.areaSqm,
    city: property.city,
    propertyLocation: property.propertyLocation,
    propertyArea: property.propertyArea,
    condition: property.condition,
    features: property.features || [],
    status: property.status,
    publicationStatus: property.publicationStatus,
    slug: property.slug,
    sourceUrl: property.sourceUrl || property.externalPublicUrl || null,
    description: normalizeText(property.description, 1600),
  };
}

function extractReferenceFromSource(text: string): string | null {
  const explicit = text.match(/\b(?:ref(?:erence)?\.?|ref\s*no\.?)\s*[:#-]?\s*([A-Z]{1,6}\s*-?\s*\d{2,8})\b/i);
  const loose = explicit || text.match(/\b([A-Z]{1,6}\s*-?\s*\d{2,8})\b/);
  return loose?.[1] ? loose[1].replace(/\s|-/g, "").toUpperCase() : null;
}

function extractPriceFromSource(text: string): number | null {
  const match = text.match(/(?:€|eur\s*)\s*([0-9][0-9.,\s]{2,})/i);
  if (!match?.[1]) return null;
  const normalized = match[1].replace(/[\s,.](?=\d{3}\b)/g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function extractBedroomsFromSource(text: string): number | null {
  const studio = /\bstudio\b/i.test(text);
  if (studio) return 0;
  const match = text.match(/\b([0-9]+)\s*(?:bed|beds|bedroom|bedrooms)\b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractTypeFromSource(text: string): string | null {
  const found = PROPERTY_TYPE_HINTS.find((type) => new RegExp(`\\b${type}\\b`, "i").test(text));
  return found || null;
}

function extractGoalFromSource(text: string): string | null {
  if (/\b(for\s+rent|to\s+rent|rent\b|per\s+month|\/month|pcm)\b/i.test(text)) return "Rent";
  if (/\b(for\s+sale|to\s+buy|sale\b|buy\b|asking\s+price)\b/i.test(text)) return "Sale";
  return null;
}

function extractLocationFromSource(text: string, marketContext?: LocationMarketContext | null): string | null {
  const match = text.match(/\b(?:(?:property|listing)\s+)?(?:location|city)\s*[:#-]\s*([^\n,;|]{2,80})/i);
  const explicit = normalizeText(match?.[1], 120);
  if (explicit) return explicit;
  const candidates = (marketContext?.serviceAreas || [])
    .flatMap((area) => [area.label, ...area.aliases].map((label) => ({
      label,
      canonicalLabel: area.label,
      specificity: ["locality", "neighborhood"].includes(area.kind) ? 2 : 1,
    })))
    .sort((a, b) => b.specificity - a.specificity || b.label.length - a.label.length);
  for (const candidate of candidates) {
    const escaped = candidate.label.replace(/\s*\([^)]*\)\s*/g, " ").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped && new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text)) {
      return candidate.canonicalLabel;
    }
  }
  return null;
}

function primaryPropertySourceText(text: string): string {
  const markers = [
    /\n\s*SIMILAR\s+NEARBY\s*\n/i,
    /\n\s*SIMILAR\s+PROPERTIES\s*\n/i,
    /\n\s*YOU\s+MAY\s+ALSO\s+LIKE\s*\n/i,
  ];
  let end = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match?.index != null) end = Math.min(end, match.index);
  }
  return text.slice(0, end).trim();
}

export function propertySourceSnapshot(args: {
  url?: string | null;
  sourceText?: string | null;
  title?: string | null;
  description?: string | null;
  linkedProperty?: AnyRecord | null;
  marketContext?: LocationMarketContext | null;
}) {
  const sourceText = normalizeText(args.sourceText, 12000);
  const primarySourceText = primaryPropertySourceText(sourceText || "");
  const combined = [
    args.title ? `Title: ${args.title}` : null,
    args.description ? `Description: ${args.description}` : null,
    primarySourceText,
    args.url ? `Source URL: ${args.url}` : null,
  ].filter(Boolean).join("\n");
  const linked: AnyRecord = args.linkedProperty ? propertySnapshot(args.linkedProperty) : {};
  const reference = linked.reference || extractReferenceFromSource(combined);
  const title = normalizeText(args.title, 240)
    || linked.title
    || (reference ? `Property ${reference}` : "Website property campaign");

  return {
    ...linked,
    id: linked.id || null,
    title,
    reference,
    goal: linked.goal || extractGoalFromSource(args.title || "") || extractGoalFromSource(combined),
    type: linked.type || extractTypeFromSource(args.title || "") || extractTypeFromSource(combined),
    price: linked.price ?? extractPriceFromSource(primarySourceText || combined),
    currency: linked.currency || args.marketContext?.currencyCode || null,
    bedrooms: linked.bedrooms
      ?? extractBedroomsFromSource(args.title || "")
      ?? extractBedroomsFromSource(args.description || "")
      ?? extractBedroomsFromSource(primarySourceText),
    city: linked.city || null,
    propertyLocation: linked.propertyLocation
      || extractLocationFromSource(args.title || "", args.marketContext)
      || extractLocationFromSource(primarySourceText, args.marketContext),
    sourceUrl: normalizeText(args.url, 1200),
    sourceText,
    description: linked.description || normalizeText(args.description || sourceText, 1600),
  };
}

function propertyMatchInput(property: AnyRecord): PropertyMatchInput {
  return {
    goal: property.goal,
    type: property.type,
    price: property.price,
    bedrooms: property.bedrooms,
    areaSqm: property.areaSqm,
    city: property.city,
    propertyLocation: property.propertyLocation,
    propertyArea: property.propertyArea,
    condition: property.condition,
    features: property.features || [],
    description: property.description,
    sourceText: property.sourceText,
  };
}

function contactRequirementInput(contact: AnyRecord): ContactRequirementInput {
  return {
    requirementStatus: contact.requirementStatus,
    requirementDistrict: contact.requirementDistrict,
    requirementBedrooms: contact.requirementBedrooms,
    requirementMinPrice: contact.requirementMinPrice,
    requirementMaxPrice: contact.requirementMaxPrice,
    requirementCondition: contact.requirementCondition,
    requirementPropertyTypes: contact.requirementPropertyTypes || [],
    requirementPropertyLocations: contact.requirementPropertyLocations || [],
    requirementOtherDetails: contact.requirementOtherDetails,
    requirementSummary: contact.requirementSummary,
    leadGoal: contact.leadGoal,
    contactType: contact.contactType,
    contactName: contact.name,
    profileVerificationStatus: contact.profileVerificationStatus,
    recentMessagesText: Array.isArray(contact.recentMessages)
      ? contact.recentMessages
        .filter((message: AnyRecord) => {
          const direction = String(message.direction || "").toLowerCase();
          return direction ? direction === "inbound" : true;
        })
        .map((message: AnyRecord) => message.body)
        .filter(Boolean)
        .join("\n")
      : contact.recentMessagesText,
  };
}

function contactRequirementsAreStaleForCampaign(contact: AnyRecord): boolean {
  if (!contact.requirementsLastAssessedAt) return true;
  const dueAt = contact.requirementsAssessmentDueAt ? new Date(contact.requirementsAssessmentDueAt) : null;
  return Boolean(dueAt && !Number.isNaN(dueAt.getTime()) && dueAt <= new Date());
}

function evidenceForStructuredMatch(result: StructuredMatchResult) {
  return {
    structured: {
      matches: result.matches,
      mismatches: result.mismatches,
      unknowns: result.unknowns,
      needsAi: result.needsAi,
      overallScore: result.score,
      verdict: result.verdict,
      dimensions: result.dimensions || [],
      hardMismatches: result.hardMismatches || [],
      disqualifiers: result.disqualifiers || [],
      qualificationEvidence: result.qualificationEvidence || null,
      recentIntent: result.recentIntent || null,
    },
  };
}

export function applyInteractionSimilarityToStructuredMatch(
  result: StructuredMatchResult,
  similarity: PropertyInteractionSimilarity,
): StructuredMatchResult {
  if (similarity.positiveMatches.length === 0 && similarity.negativeCautions.length === 0) return result;

  const next: StructuredMatchResult = {
    ...result,
    matches: [...result.matches],
    mismatches: [...result.mismatches],
    unknowns: [...result.unknowns],
    dimensions: [...(result.dimensions || [])],
    qualificationEvidence: result.qualificationEvidence ? {
      ...result.qualificationEvidence,
      anchors: [...result.qualificationEvidence.anchors],
      concreteFitAnchors: [...result.qualificationEvidence.concreteFitAnchors],
      groundingFitAnchors: [...result.qualificationEvidence.groundingFitAnchors],
    } : undefined,
  };
  let scoreAdjustment = 0;

  if (similarity.positiveMatches.length > 0) {
    const references = similarity.positiveMatches.map((match) => match.reference).filter(Boolean);
    next.matches.push(`similar to positively received propert${references.length === 1 ? "y" : "ies"}${references.length ? ` (${references.join(", ")})` : ""}`);
    scoreAdjustment += 2;
    const qualification = next.qualificationEvidence;
    if (qualification) {
      const anchor = "similar to a positively received property";
      qualification.anchors = Array.from(new Set([...qualification.anchors, anchor]));
      qualification.concreteFitAnchors = Array.from(new Set([...qualification.concreteFitAnchors, anchor]));
      if (similarity.hasPositiveGrounding) {
        qualification.groundingFitAnchors = Array.from(new Set([...qualification.groundingFitAnchors, anchor]));
      }
      qualification.anchorCount = qualification.anchors.length;
      qualification.concreteFitAnchorCount = qualification.concreteFitAnchors.length;
      qualification.groundingFitAnchorCount = qualification.groundingFitAnchors.length;
      qualification.sparseLead = qualification.anchorCount < qualification.minimumAnchorsForYes
        || qualification.concreteFitAnchorCount < qualification.minimumConcreteFitAnchorsForYes
        || qualification.groundingFitAnchorCount < 1;
      qualification.broadOnly = false;
      qualification.reason = qualification.sparseLead
        ? "Positive property history provides grounding, but more concrete fit evidence is still needed."
        : "Current requirements and positive property history provide enough concrete evidence for AI adjudication.";
    }
  }

  if (similarity.negativeCautions.length > 0) {
    const references = similarity.negativeCautions.map((match) => match.reference).filter(Boolean);
    next.unknowns.push(`similar to previously rejected propert${references.length === 1 ? "y" : "ies"}${references.length ? ` (${references.join(", ")})` : ""}; rejection reason requires review`);
    scoreAdjustment -= 1;
    if (next.verdict === "yes" && (next.hardMismatches?.length || 0) === 0 && (next.disqualifiers?.length || 0) === 0) {
      next.verdict = "maybe";
      next.needsAi = true;
    }
  }

  next.dimensions?.push({
    key: "interaction_similarity",
    label: "Property History",
    propertyValue: "Current campaign property",
    requirementValue: similarity.summary,
    status: similarity.negativeCautions.length > 0 ? "maybe" : "yes",
    weight: 2,
    score: scoreAdjustment,
    reason: similarity.summary,
  });
  next.score = Math.round((next.score + scoreAdjustment) * 100) / 100;
  return next;
}

function structuredCandidateData(args: {
  locationId: string;
  campaignId: string;
  contact: AnyRecord;
  propertyInput: PropertyMatchInput;
  marketContext: LocationMarketContext;
}) {
  const conversation = args.contact.conversations?.[0];
  if (!conversation?.id) return null;
  const recentMessages = [...(conversation.messages || [])].reverse();
  const campaignProfile = resolveContactPropertyMatchProfile({
    ...args.contact,
    recentMessagesText: recentMessages
      .filter((message: AnyRecord) => String(message.direction || "").toLowerCase() === "inbound")
      .map((message: AnyRecord) => message.body)
      .filter(Boolean)
      .join("\n"),
  });
  const interactionSimilarity = comparePropertyToInteractionProfile(
    args.propertyInput,
    campaignProfile.interactions,
  );
  const structured = applyInteractionSimilarityToStructuredMatch(
    evaluateStructuredPropertyMatch(args.propertyInput, contactRequirementInput({
      ...args.contact,
      recentMessages,
    }), { marketContext: args.marketContext }),
    interactionSimilarity,
  );
  if (campaignProfile.eligibility.status === "ineligible") {
    structured.disqualifiers = Array.from(new Set([
      ...(structured.disqualifiers || []),
      ...campaignProfile.eligibility.reasons,
    ]));
    structured.verdict = "no";
    structured.needsAi = false;
  }
  const requirementsAreStale = contactRequirementsAreStaleForCampaign(args.contact);
  const structuredNeedsConversationReview = requirementsAreStale
    && structured.verdict === "no"
    && (structured.hardMismatches?.length || 0) > 0
    && (structured.disqualifiers?.length || 0) === 0;
  const hasEligibilityBlocker = (structured.disqualifiers?.length || 0) > 0;
  const effectiveVerdict = hasEligibilityBlocker ? "no" : "maybe";
  // Every eligible contact gets the same final AI comparison. Structured matching
  // remains supporting evidence, not a second decision engine.
  const effectiveNeedsAi = !hasEligibilityBlocker;
  const preferredChannel = deriveComposerInitialChannel(conversation as any);
  return {
    locationId: args.locationId,
    campaignId: args.campaignId,
    contactId: args.contact.id,
    conversationId: conversation.id,
    structuredVerdict: structured.verdict,
    aiVerdict: effectiveVerdict,
    aiReviewStatus: effectiveNeedsAi ? "pending" : "done",
    aiReviewLockedAt: null,
    aiReviewLockedBy: null,
    reviewerStatus: "pending",
    score: structuredNeedsConversationReview ? Math.max(structured.score, -0.5) : structured.score,
    confidence: effectiveNeedsAi ? 0.5 : effectiveVerdict === "yes" ? 0.9 : 0.85,
    evidence: {
      ...evidenceForStructuredMatch({
        ...structured,
        needsAi: effectiveNeedsAi,
      }),
      campaignProfile,
      interactionSimilarity,
      marketContext: {
        locationId: args.marketContext.locationId,
        locationName: args.marketContext.locationName,
        countryCode: args.marketContext.countryCode,
        countryName: args.marketContext.countryName,
        locale: args.marketContext.locale,
        currencyCode: args.marketContext.currencyCode,
        supportedLanguages: args.marketContext.supportedLanguages,
        serviceAreas: args.marketContext.serviceAreas,
      },
      ...(requirementsAreStale ? {
        warnings: [
          "Requirement fields are stale or have never been assessed; campaign AI must verify against conversation context.",
        ],
      } : {}),
    },
    reasoning: structuredNeedsConversationReview
      ? `Stored requirement fields may be stale, so AI must verify the conversation before rejecting. Structured blockers: ${structured.mismatches.join("; ") || "none"}.`
      : structured.mismatches.length
      ? structured.mismatches.join("; ")
      : structured.matches.join("; ") || "Needs requirement review.",
    matchSummary: structuredNeedsConversationReview
      ? "Needs fast AI review because stored requirements may be stale."
      : structured.verdict === "yes"
      ? "Structured requirements match."
      : structured.verdict === "no"
        ? "Hard structured mismatch."
        : "Structured fit is incomplete or has unstructured requirements.",
    preferredChannel,
    lastError: null,
  };
}

export function isAiReviewTerminal(status: unknown) {
  return status === "done";
}

export function isPropertyMatchCampaignStopped(campaign: {
  status?: unknown;
  collectionStatus?: unknown;
} | null | undefined) {
  return campaign?.status === CAMPAIGN_STOPPED_STATUS || campaign?.collectionStatus === CAMPAIGN_STOPPED_STATUS;
}

export function propertyMatchCampaignStatusAfterCounts(args: {
  currentStatus?: unknown;
  collectionStatus?: unknown;
  pendingAiCount: number;
}) {
  if (args.currentStatus === CAMPAIGN_STOPPED_STATUS || args.collectionStatus === CAMPAIGN_STOPPED_STATUS) {
    return {
      status: CAMPAIGN_STOPPED_STATUS,
      processingFinishedAt: null,
    };
  }
  const readyForReview = args.collectionStatus === "done" && args.pendingAiCount === 0;
  return {
    status: readyForReview ? "review" : "processing",
    processingFinishedAt: readyForReview ? new Date() : null,
  };
}

export function canCandidateEnterHumanReview(candidate: {
  reviewerStatus?: unknown;
  aiVerdict?: unknown;
  aiReviewStatus?: unknown;
  contact?: { profileVerificationStatus?: unknown } | null;
  profileVerificationStatus?: unknown;
}) {
  return candidate.reviewerStatus === "pending"
    && (candidate.aiVerdict === "yes" || candidate.aiVerdict === "maybe")
    && isAiReviewTerminal(candidate.aiReviewStatus);
}

export function canCandidateDraftOrSend(candidate: {
  aiVerdict?: unknown;
  aiReviewStatus?: unknown;
  contact?: { profileVerificationStatus?: unknown } | null;
  profileVerificationStatus?: unknown;
}) {
  return (candidate.aiVerdict === "yes" || candidate.aiVerdict === "maybe")
    && isAiReviewTerminal(candidate.aiReviewStatus);
}

type PropertyMatchContactCursor = {
  createdAt: string;
  id: string;
};

function encodePropertyMatchContactCursor(contact: { createdAt?: Date | string | null; id?: string | null }): string | null {
  const id = normalizeText(contact.id, 120);
  const createdAt = contact.createdAt instanceof Date
    ? contact.createdAt.toISOString()
    : normalizeText(contact.createdAt, 80);
  if (!id || !createdAt) return null;
  return JSON.stringify({ createdAt, id } satisfies PropertyMatchContactCursor);
}

function decodePropertyMatchContactCursor(cursor?: string | null): PropertyMatchContactCursor | null {
  const text = normalizeText(cursor, 300);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<PropertyMatchContactCursor>;
    const id = normalizeText(parsed.id, 120);
    const createdAt = normalizeText(parsed.createdAt, 80);
    if (!id || !createdAt || Number.isNaN(new Date(createdAt).getTime())) return null;
    return { id, createdAt };
  } catch {
    return null;
  }
}

export function buildPropertyMatchContactWhere(locationId: string, cursor?: string | null) {
  const decodedCursor = decodePropertyMatchContactCursor(cursor);
  return {
    locationId,
    contactType: {
      notIn: ["Owner", "Agent", "Partner", "Associate", "Maintenance", "WhatsAppGroup"],
    },
    ...(decodedCursor ? {
      OR: [
        { createdAt: { lt: new Date(decodedCursor.createdAt) } },
        { createdAt: new Date(decodedCursor.createdAt), id: { lt: decodedCursor.id } },
      ],
    } : cursor ? { id: { lt: cursor } } : {}),
    NOT: [
      { matchingEmailMatchedProperties: { startsWith: "No" } },
    ],
    AND: [
      {
        OR: [
          { profileVerificationStatus: null },
          { profileVerificationStatus: { notIn: ["likely_owner", "likely_agent", "not_a_lead"] } },
        ],
      },
    ],
    conversations: { some: { locationId, deletedAt: null } },
  };
}

function buildVerifiedPropertyMatchContactWhere(locationId: string) {
  return buildPropertyMatchContactWhere(locationId);
}

const campaignPropertyMatchProfileSelect = {
  schemaVersion: true,
  status: true,
  eligibilityProfile: true,
  requirementProfile: true,
  interactionProfile: true,
  requirementSummary: true,
  interactionSummary: true,
  sourceContactUpdatedAt: true,
  evidenceWatermarkAt: true,
};

function campaignContactSelect(locationId: string) {
  return {
    id: true,
    createdAt: true,
    updatedAt: true,
    name: true,
    email: true,
    phone: true,
    contactType: true,
    leadGoal: true,
    profileVerificationStatus: true,
    profileVerifiedAt: true,
    profileVerificationSource: true,
    profileVerificationConfidence: true,
    profileVerificationSummary: true,
    requirementStatus: true,
    requirementDistrict: true,
    requirementBedrooms: true,
    requirementMinPrice: true,
    requirementMaxPrice: true,
    requirementCondition: true,
    requirementPropertyTypes: true,
    requirementPropertyLocations: true,
    requirementOtherDetails: true,
    requirementSummary: true,
    requirementsLastAssessedAt: true,
    requirementsAssessmentDueAt: true,
    propertiesInterested: true,
    propertiesInspected: true,
    propertiesEmailed: true,
    propertyMatchProfile: {
      select: campaignPropertyMatchProfileSelect,
    },
    conversations: {
      where: { locationId, deletedAt: null },
      orderBy: { lastMessageAt: "desc" as const },
      take: 1,
      select: {
        id: true,
        lastMessageType: true,
        messages: {
          orderBy: { createdAt: "desc" as const },
          take: 8,
          select: { body: true, direction: true, createdAt: true },
        },
      },
    },
  };
}

export function buildAiReviewClaimWhere(args: {
  campaignId: string;
  locationId: string;
  staleLockedBefore: Date;
  ids?: string[];
}) {
  return {
    ...(args.ids?.length ? { id: { in: args.ids } } : {}),
    campaignId: args.campaignId,
    locationId: args.locationId,
    reviewerStatus: "pending",
    OR: [
      { aiReviewStatus: "pending" },
      {
        aiReviewStatus: "processing",
        aiReviewLockedAt: { lt: args.staleLockedBefore },
      },
    ],
  };
}

async function finalizeUnverifiedPropertyMatchCandidates(args: {
  locationId: string;
  campaignId: string;
}) {
  void args;
  return { count: 0 };
}

function profileVerificationBlockWhere() {
  return {
    OR: [
      { matchSummary: { contains: "Needs profile verification", mode: "insensitive" as const } },
      { reasoning: { contains: "not globally verified", mode: "insensitive" as const } },
    ],
  };
}

function alreadySharedCandidateData(candidate: AnyRecord, evidence: AnyRecord) {
  return {
    ...candidate,
    aiVerdict: "no",
    aiReviewStatus: "done",
    score: Math.min(Number(candidate.score || 0), -2),
    confidence: 0.95,
    evidence: {
      ...((candidate.evidence as AnyRecord) || {}),
      priorShare: evidence,
      structured: {
        ...((candidate.evidence as AnyRecord)?.structured || {}),
        needsAi: false,
      },
    },
    reasoning: [
      "This property appears to have already been shared with the contact.",
      evidence.matchedBy?.length ? `Matched by ${evidence.matchedBy.join(" and ")}.` : null,
    ].filter(Boolean).join(" "),
    matchSummary: "Already shared with this contact.",
  };
}

async function reopenVerifiedProfileBlockedCandidates(args: {
  locationId: string;
  campaign: AnyRecord;
  contactId?: string;
  limit?: number;
}) {
  const rows = await db.propertyMatchCandidate.findMany({
    where: {
      campaignId: args.campaign.id,
      locationId: args.locationId,
      ...(args.contactId ? { contactId: args.contactId } : {}),
      reviewerStatus: "pending",
      contact: { profileVerificationStatus: "verified_lead" },
      ...profileVerificationBlockWhere(),
    },
    include: {
      contact: {
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          name: true,
          email: true,
          phone: true,
          contactType: true,
          leadGoal: true,
          profileVerificationStatus: true,
          profileVerifiedAt: true,
          profileVerificationSource: true,
          profileVerificationConfidence: true,
          profileVerificationSummary: true,
          requirementStatus: true,
          requirementDistrict: true,
          requirementBedrooms: true,
          requirementMinPrice: true,
          requirementMaxPrice: true,
          requirementCondition: true,
          requirementPropertyTypes: true,
          requirementPropertyLocations: true,
          requirementOtherDetails: true,
          requirementSummary: true,
          propertiesInterested: true,
          propertiesInspected: true,
          propertiesEmailed: true,
          propertyMatchProfile: { select: campaignPropertyMatchProfileSelect },
          conversations: {
            where: { locationId: args.locationId, deletedAt: null },
            orderBy: { lastMessageAt: "desc" },
            take: 1,
            select: {
              id: true,
              lastMessageType: true,
              messages: {
                orderBy: { createdAt: "desc" },
                take: 8,
                select: { body: true, direction: true, createdAt: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(200, Number(args.limit || 100))),
  });

  const propertySnapshotForCampaign = args.campaign.propertySnapshot || {};
  const propertyInput = propertyMatchInput(propertySnapshotForCampaign);
  const marketContext = await getLocationMarketContext(args.locationId);
  const rebuilt = rows.flatMap((row: AnyRecord) => {
    const candidate = structuredCandidateData({
      locationId: args.locationId,
      campaignId: args.campaign.id,
      contact: row.contact,
      propertyInput,
      marketContext,
    });
    return candidate ? [{ row, candidate }] : [];
  });
  const priorShareEvidence = await findPriorPropertyShareEvidenceByConversation({
    snapshot: propertySnapshotForCampaign,
    conversationIds: rebuilt.map((item) => item.candidate.conversationId),
  });

  let reopened = 0;
  for (const item of rebuilt) {
    const evidence = priorShareEvidence.get(item.candidate.conversationId);
    const candidate = evidence ? alreadySharedCandidateData(item.candidate, evidence) : item.candidate;
    await db.propertyMatchCandidate.update({
      where: { id: item.row.id },
      data: candidate,
    });
    reopened += 1;
  }

  return reopened;
}

export async function reprocessVerifiedContactProfileBlocks(args: {
  locationId: string;
  contactId: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(100, Number(args.limit || 50)));
  const blockedRows = await db.propertyMatchCandidate.findMany({
    where: {
      locationId: args.locationId,
      contactId: args.contactId,
      reviewerStatus: "pending",
      contact: { profileVerificationStatus: "verified_lead" },
      ...profileVerificationBlockWhere(),
    },
    select: {
      campaignId: true,
      campaign: true,
    },
    distinct: ["campaignId"],
    take: limit,
  });

  let reprocessed = 0;
  for (const row of blockedRows) {
    reprocessed += await reopenVerifiedProfileBlockedCandidates({
      locationId: args.locationId,
      campaign: row.campaign,
      contactId: args.contactId,
      limit,
    });
    await refreshCampaignCounts(row.campaignId);
  }

  return { success: true as const, reprocessed };
}

function alreadySharedCandidateWhere() {
  return {
    OR: [
      { matchSummary: { contains: "Already shared", mode: "insensitive" as const } },
      { reasoning: { contains: "already been shared", mode: "insensitive" as const } },
    ],
  };
}

export async function reprocessPendingCampaignCandidatesForContactRequirements(args: {
  locationId: string;
  contactId: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(200, Number(args.limit || 100)));
  const rows = await db.propertyMatchCandidate.findMany({
    where: {
      locationId: args.locationId,
      contactId: args.contactId,
      reviewerStatus: "pending",
      NOT: alreadySharedCandidateWhere(),
    },
    include: {
      campaign: true,
      contact: {
        select: {
          id: true,
          updatedAt: true,
          name: true,
          email: true,
          phone: true,
          contactType: true,
          leadGoal: true,
          profileVerificationStatus: true,
          profileVerifiedAt: true,
          profileVerificationSource: true,
          profileVerificationConfidence: true,
          profileVerificationSummary: true,
          requirementStatus: true,
          requirementDistrict: true,
          requirementBedrooms: true,
          requirementMinPrice: true,
          requirementMaxPrice: true,
          requirementCondition: true,
          requirementPropertyTypes: true,
          requirementPropertyLocations: true,
          requirementOtherDetails: true,
          requirementSummary: true,
          propertiesInterested: true,
          propertiesInspected: true,
          propertiesEmailed: true,
          propertyMatchProfile: { select: campaignPropertyMatchProfileSelect },
          conversations: {
            where: { locationId: args.locationId, deletedAt: null },
            orderBy: { lastMessageAt: "desc" },
            take: 1,
            select: {
              id: true,
              lastMessageType: true,
              messages: {
                orderBy: { createdAt: "desc" },
                take: 8,
                select: { body: true, direction: true, createdAt: true },
              },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  const marketContext = await getLocationMarketContext(args.locationId);
  const rebuilt = rows.flatMap((row: AnyRecord) => {
    const candidate = structuredCandidateData({
      locationId: args.locationId,
      campaignId: row.campaignId,
      contact: row.contact,
      propertyInput: propertyMatchInput(row.campaign.propertySnapshot || {}),
      marketContext,
    });
    return candidate ? [{ row, candidate }] : [];
  });
  const priorShareEvidenceByCandidate = new Map<string, ReturnType<typeof findPriorPropertyShareEvidence>>();
  const rebuiltByCampaign = new Map<string, typeof rebuilt>();
  for (const item of rebuilt) {
    const items = rebuiltByCampaign.get(item.row.campaignId) || [];
    items.push(item);
    rebuiltByCampaign.set(item.row.campaignId, items);
  }
  for (const items of rebuiltByCampaign.values()) {
    const campaign = items[0]?.row.campaign;
    if (!campaign) continue;
    const priorShareEvidence = await findPriorPropertyShareEvidenceByConversation({
      snapshot: campaign.propertySnapshot || {},
      conversationIds: items.map((item) => item.candidate.conversationId),
    });
    for (const item of items) {
      const evidence = priorShareEvidence.get(item.candidate.conversationId);
      if (evidence) priorShareEvidenceByCandidate.set(item.row.id, evidence);
    }
  }

  let reprocessed = 0;
  const campaignIds = new Set<string>();
  for (const item of rebuilt) {
    const evidence = priorShareEvidenceByCandidate.get(item.row.id);
    const candidate = evidence ? alreadySharedCandidateData(item.candidate, evidence) : item.candidate;
    await db.propertyMatchCandidate.update({
      where: { id: item.row.id },
      data: candidate,
    });
    campaignIds.add(item.row.campaignId);
    reprocessed += 1;
  }
  for (const campaignId of campaignIds) {
    await refreshCampaignCounts(campaignId);
  }

  return { success: true as const, reprocessed };
}

async function findPriorPropertyShareEvidenceByConversation(args: {
  snapshot: AnyRecord;
  conversationIds: string[];
}) {
  const conversationIds = Array.from(new Set(args.conversationIds.filter(Boolean)));
  const terms = buildPriorPropertyShareSearchTerms(args.snapshot);
  const searchTerms = [...terms.referenceTerms, ...terms.urlTerms];
  const evidenceByConversationId = new Map<string, ReturnType<typeof findPriorPropertyShareEvidence>>();
  if (conversationIds.length === 0 || searchTerms.length === 0) return evidenceByConversationId;

  const messages = await db.message.findMany({
    where: {
      conversationId: { in: conversationIds },
      OR: searchTerms.map((term) => ({
        body: { contains: term, mode: "insensitive" as const },
      })),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      conversationId: true,
      direction: true,
      body: true,
      createdAt: true,
    },
    take: Math.min(1000, conversationIds.length * 10),
  });

  const messagesByConversationId = new Map<string, typeof messages>();
  for (const message of messages) {
    const rows = messagesByConversationId.get(message.conversationId) || [];
    rows.push(message);
    messagesByConversationId.set(message.conversationId, rows);
  }

  for (const conversationId of conversationIds) {
    const evidence = findPriorPropertyShareEvidence({
      snapshot: args.snapshot,
      messages: messagesByConversationId.get(conversationId) || [],
    });
    if (evidence) evidenceByConversationId.set(conversationId, evidence);
  }

  return evidenceByConversationId;
}

export async function findPriorPropertyShareForCandidate(args: {
  locationId: string;
  candidateId: string;
}) {
  const candidate = await db.propertyMatchCandidate.findFirst({
    where: { id: args.candidateId, locationId: args.locationId },
    select: {
      id: true,
      conversationId: true,
      campaign: { select: { propertySnapshot: true } },
    },
  });
  if (!candidate?.conversationId) return null;

  const evidenceByConversationId = await findPriorPropertyShareEvidenceByConversation({
    snapshot: (candidate.campaign?.propertySnapshot as AnyRecord) || {},
    conversationIds: [candidate.conversationId],
  });
  return evidenceByConversationId.get(candidate.conversationId) || null;
}

export async function markPropertyMatchCandidateAlreadyShared(args: {
  locationId: string;
  candidateId: string;
  evidence: AnyRecord;
}) {
  const candidate = await db.propertyMatchCandidate.findFirst({
    where: { id: args.candidateId, locationId: args.locationId },
    select: { id: true, campaignId: true, evidence: true, score: true },
  });
  if (!candidate) return { success: false as const, error: "Candidate not found." };

  await db.propertyMatchCandidate.update({
    where: { id: candidate.id },
    data: {
      aiVerdict: "no",
      aiReviewStatus: "done",
      aiReviewLockedAt: null,
      aiReviewLockedBy: null,
      reviewerStatus: "rejected",
      reviewedAt: new Date(),
      rejectedReason: "Property already shared with this contact.",
      score: Math.min(Number(candidate.score || 0), -2),
      confidence: 0.95,
      evidence: {
        ...((candidate.evidence as AnyRecord) || {}),
        priorShare: args.evidence,
        structured: {
          ...((candidate.evidence as AnyRecord)?.structured || {}),
          needsAi: false,
        },
      },
      reasoning: "This property appears to have already been shared with the contact.",
      matchSummary: "Already shared with this contact.",
      lastError: null,
    },
  });
  await refreshCampaignCounts(candidate.campaignId);
  return { success: true as const };
}

function formatPropertyFacts(snapshot: AnyRecord): string {
  return [
    snapshot.reference ? `Ref: ${snapshot.reference}` : null,
    snapshot.title ? `Title: ${snapshot.title}` : null,
    snapshot.goal ? `Goal: ${snapshot.goal}` : null,
    snapshot.type ? `Type: ${snapshot.type}` : null,
    Number.isFinite(Number(snapshot.price)) ? `Price: ${snapshot.currency || "EUR"} ${snapshot.price}` : null,
    snapshot.bedrooms != null ? `Bedrooms: ${snapshot.bedrooms}` : null,
    snapshot.bathrooms != null ? `Bathrooms: ${snapshot.bathrooms}` : null,
    snapshot.propertyLocation || snapshot.city ? `Location: ${[snapshot.propertyLocation, snapshot.city].filter(Boolean).join(", ")}` : null,
    snapshot.condition ? `Condition: ${snapshot.condition}` : null,
    Array.isArray(snapshot.features) && snapshot.features.length ? `Features: ${snapshot.features.slice(0, 12).join(", ")}` : null,
    snapshot.sourceUrl ? `Source URL: ${snapshot.sourceUrl}` : null,
    snapshot.description ? `Description: ${snapshot.description}` : null,
    snapshot.sourceText ? `Source text: ${normalizeText(snapshot.sourceText, 1800)}` : null,
  ].filter(Boolean).join("\n");
}

function formatInteractionExample(example: AnyRecord): string {
  const property = example?.property || {};
  return [
    property.reference || property.title || "Property",
    property.type,
    property.bedrooms != null ? `${property.bedrooms} bed` : null,
    property.price != null ? `${property.price}` : null,
    property.propertyLocation || property.city,
    example.reason ? `reason: ${example.reason}` : null,
  ].filter(Boolean).join(" · ");
}

export function buildPropertyMatchDecisionContext(args: {
  propertySnapshot: AnyRecord;
  campaignProfile?: AnyRecord | null;
  recentMessages?: Array<{ direction?: string | null; body?: string | null }>;
}) {
  const profile = args.campaignProfile || {};
  const interactions = profile.interactions || {};
  const recentClientMessages = (args.recentMessages || [])
    .filter((message) => String(message.direction || "").toLowerCase() === "inbound")
    .map((message) => normalizeText(message.body, 500))
    .filter(Boolean)
    .slice(-8);
  const positive = (interactions.positiveExamples || []).slice(0, 5).map(formatInteractionExample);
  const negative = (interactions.negativeExamples || []).slice(0, 5).map(formatInteractionExample);
  const sent = (interactions.sentPropertyReferences || []).slice(0, 20);

  return {
    contactSummary: [
      `Current requirements: ${profile.requirementSummary || "No concrete current requirements recorded."}`,
      `Interested/positive history: ${positive.length ? positive.join(" | ") : interactions.positivePropertyReferences?.join(", ") || "None recorded."}`,
      `Rejected/negative history: ${negative.length ? negative.join(" | ") : interactions.negativePropertyReferences?.join(", ") || "None recorded."}`,
      `Previously sent: ${sent.length ? sent.join(", ") : "None recorded."}`,
      recentClientMessages.length ? `Recent client statements:\n${recentClientMessages.map((text) => `- ${text}`).join("\n")}` : null,
    ].filter(Boolean).join("\n"),
    propertySummary: formatPropertyFacts(args.propertySnapshot),
  };
}

function candidateProfileWarnings(candidate: AnyRecord): string[] {
  const warnings: string[] = [];
  const contact = candidate.contact || {};
  if (contact.profileVerificationStatus !== "verified_lead") {
    warnings.push("Contact profile is not verified as a buyer/renter lead; review identity and requirements before sending.");
  }
  const qualificationEvidence = candidate.evidence?.structured?.qualificationEvidence;
  if (qualificationEvidence?.sparseLead || qualificationEvidence?.broadOnly) {
    warnings.push(qualificationEvidence.reason || "Contact requirements are sparse or broad.");
  }
  return Array.from(new Set(warnings));
}

export async function refreshCampaignCounts(campaignId: string) {
  const campaign = await db.propertyMatchCampaign.findUnique({
    where: { id: campaignId },
    select: { status: true, collectionStatus: true },
  });
  const rows = await db.propertyMatchCandidate.findMany({
    where: { campaignId },
    select: {
      aiVerdict: true,
      aiReviewStatus: true,
      reviewerStatus: true,
      evidence: true,
      matchSummary: true,
      reasoning: true,
      contact: { select: { profileVerificationStatus: true } },
    },
  });
  const queueCounts = summarizePropertyMatchCandidateQueues(rows as any[]);
  const pendingAiCount = queueCounts.pendingAiCount;
  const processedCandidates = Math.max(0, rows.length - pendingAiCount);
  const yesCount = rows.filter((row: any) => row.aiVerdict === "yes").length;
  const maybeCount = rows.filter((row: any) => row.aiVerdict === "maybe").length;
  const noCount = rows.filter((row: any) => row.aiVerdict === "no").length;
  const approvedCount = rows.filter((row: any) => row.reviewerStatus === "approved").length;
  const sentCount = rows.filter((row: any) => row.reviewerStatus === "sent").length;
  const nextStatus = propertyMatchCampaignStatusAfterCounts({
    currentStatus: campaign?.status,
    collectionStatus: campaign?.collectionStatus,
    pendingAiCount,
  });

  return db.propertyMatchCampaign.update({
    where: { id: campaignId },
    data: {
      totalCandidates: rows.length,
      processedCandidates,
      yesCount,
      maybeCount,
      noCount,
      approvedCount,
      sentCount,
      status: nextStatus.status,
      processingFinishedAt: nextStatus.processingFinishedAt,
    },
  });
}

export function buildCampaignDraftInstruction(args: {
  propertySnapshot: AnyRecord;
  priorityNote?: string | null;
}) {
  return [
    "Use the property information below to draft the exact next message the agent should send.",
    "Write a natural new-listing notification message about this property.",
    "Keep it brief enough for WhatsApp/SMS: 2-3 short chat lines.",
    "Use the existing conversation, contact requirements, language, channel, and recent context to decide what matters.",
    "If the property appears to match the lead's requirements, mention the strongest matching details conversationally.",
    "If the match is uncertain, phrase it softly and invite them to confirm interest.",
    "Write in WhatsApp/SMS style: each idea on its own short line, with natural line breaks between the hook, key details, next step, and link.",
    "Never return one bulky paragraph. Do not use bullets, headings, Markdown, or numbered lists.",
    "Do not invent missing facts, availability, prices, locations, viewings, or promises.",
    args.priorityNote ? `Agent priority details:\n${args.priorityNote}` : null,
    "",
    "Property source:",
    formatPropertyFacts(args.propertySnapshot),
  ].filter((line) => line != null).join("\n");
}

export async function createPropertyMatchCampaign(args: {
  locationId: string;
  propertyId: string;
  actorUserId?: string | null;
  priorityNote?: string | null;
  scoringModel?: string | null;
  fallbackPolicy?: PropertyMatchFallbackPolicy | null;
}) {
  const property = await db.property.findFirst({
    where: { id: args.propertyId, locationId: args.locationId },
  });
  if (!property) return { success: false as const, error: "Property not found." };

  const sourceUrl = await resolvePropertyPublicUrl({
    locationId: args.locationId,
    property,
  });
  const snapshot = propertySnapshot({ ...(property as any), sourceUrl });
  const campaign = await db.propertyMatchCampaign.create({
    data: {
      locationId: args.locationId,
      propertyId: property.id,
      createdByUserId: args.actorUserId || null,
      title: `${property.title} match campaign`,
      status: "processing",
      priorityNote: normalizeText(args.priorityNote, 2000),
      scoringModel: normalizeText(args.scoringModel, 120),
      fallbackPolicy: normalizePropertyMatchFallbackPolicy(args.fallbackPolicy),
      propertySnapshot: snapshot,
      collectionStatus: "pending",
      processingStartedAt: new Date(),
    },
  });

  await refreshCampaignCounts(campaign.id);
  return { success: true as const, campaignId: campaign.id };
}

export async function createPropertyMatchCampaignFromSource(args: {
  locationId: string;
  propertyUrl?: string | null;
  propertyText?: string | null;
  extractedTitle?: string | null;
  extractedDescription?: string | null;
  extractedText?: string | null;
  actorUserId?: string | null;
  priorityNote?: string | null;
  scoringModel?: string | null;
  fallbackPolicy?: PropertyMatchFallbackPolicy | null;
}) {
  const marketContext = await getLocationMarketContext(args.locationId);
  const sourceText = [
    normalizeText(args.extractedText, 8000),
    normalizeText(args.propertyText, 8000),
  ].filter(Boolean).join("\n\n");
  const snapshotWithoutLink = propertySourceSnapshot({
    url: args.propertyUrl,
    sourceText,
    title: args.extractedTitle,
    description: args.extractedDescription,
    marketContext,
  });
  const reference = normalizeText(snapshotWithoutLink.reference, 120);
  const identityCandidates = extractLegacyCrmRefCandidates([
    args.propertyUrl,
    args.propertyText,
    args.extractedTitle,
    args.extractedDescription,
    args.extractedText,
  ].filter(Boolean).join("\n"));
  const legacyIds = identityCandidates.map((candidate) => candidate.oldCrmPropertyId);
  const publicReferences = Array.from(new Set([
    reference,
    ...identityCandidates.map((candidate) => candidate.publicReference),
  ].filter(Boolean))) as string[];
  let linkedProperty = await db.property.findFirst({
    where: {
      locationId: args.locationId,
      OR: [
        ...(publicReferences.length ? [{
          reference: { in: publicReferences, mode: "insensitive" as const },
        }] : []),
        ...(legacyIds.length ? [{ legacyCrmPropertyId: { in: legacyIds } }] : []),
        ...(args.propertyUrl ? [{
          externalPublicUrl: { equals: args.propertyUrl, mode: "insensitive" as const },
        }] : []),
      ],
    },
  });
  let importWarning: string | null = null;
  if (!linkedProperty && args.actorUserId && identityCandidates[0]) {
    try {
      const imported = await importOldCrmPropertyToLocalDb({
        actorUserId: args.actorUserId,
        locationId: args.locationId,
        oldCrmPropertyId: identityCandidates[0].oldCrmPropertyId,
        publicReference: identityCandidates[0].publicReference,
      });
      linkedProperty = await db.property.findFirst({
        where: { id: imported.propertyId, locationId: args.locationId },
      });
      importWarning = imported.warnings.length ? imported.warnings.join(" ") : null;
    } catch (error) {
      console.warn("[property-match-campaigns] old CRM source property import failed; continuing with source snapshot", {
        locationId: args.locationId,
        reference: identityCandidates[0].publicReference,
        error: error instanceof Error ? error.message : String(error),
      });
      importWarning = "The old CRM property could not be imported, so this campaign is using the URL snapshot.";
    }
  }
  const effectivePropertyUrl = linkedProperty
    ? (await resolvePropertyPublicUrl({
      locationId: args.locationId,
      property: linkedProperty,
    })) || normalizeText(args.propertyUrl, 1200)
    : normalizeText(args.propertyUrl, 1200);
  const snapshot = propertySourceSnapshot({
    url: effectivePropertyUrl,
    sourceText,
    title: args.extractedTitle,
    description: args.extractedDescription,
    linkedProperty: linkedProperty as any,
    marketContext,
  });
  if (!snapshot.sourceText && !snapshot.title && !snapshot.reference) {
    return { success: false as const, error: "Add a property URL or pasted property text." };
  }

  const campaign = await db.propertyMatchCampaign.create({
    data: {
      locationId: args.locationId,
      propertyId: linkedProperty?.id || null,
      createdByUserId: args.actorUserId || null,
      title: `${snapshot.reference || snapshot.title} match campaign`,
      status: "processing",
      priorityNote: normalizeText(args.priorityNote, 2000),
      scoringModel: normalizeText(args.scoringModel, 120),
      fallbackPolicy: normalizePropertyMatchFallbackPolicy(args.fallbackPolicy),
      propertySnapshot: snapshot,
      collectionStatus: "pending",
      processingStartedAt: new Date(),
    },
  });

  await refreshCampaignCounts(campaign.id);
  return {
    success: true as const,
    campaignId: campaign.id,
    linkedPropertyId: linkedProperty?.id || null,
    importWarning,
  };
}

async function collectPropertyMatchCandidatesBatch(args: {
  locationId: string;
  campaign: AnyRecord;
  limit?: number;
  workerId: string;
}) {
  if (args.campaign.collectionStatus === "done") {
    const [eligibleContacts, existingCandidates] = await Promise.all([
      db.contact.count({
        where: buildVerifiedPropertyMatchContactWhere(args.locationId),
      }),
      db.propertyMatchCandidate.count({
        where: {
          campaignId: args.campaign.id,
          locationId: args.locationId,
        },
      }),
    ]);
    if (eligibleContacts <= existingCandidates) {
      return { collected: 0, done: true };
    }
    args.campaign.collectionStatus = "pending";
    args.campaign.collectionCursor = null;
  }
  if (isPropertyMatchCampaignStopped(args.campaign)) {
    return { collected: 0, done: true, stopped: true };
  }

  const limit = Math.max(1, Math.min(500, Number(args.limit || CONTACT_COLLECTION_BATCH_SIZE)));
  const now = new Date();
  const claimed = await db.propertyMatchCampaign.updateMany({
    where: {
      id: args.campaign.id,
      locationId: args.locationId,
      status: { not: CAMPAIGN_STOPPED_STATUS },
      collectionStatus: { not: CAMPAIGN_STOPPED_STATUS },
    },
    data: {
      collectionStatus: "processing",
      collectionLockedAt: now,
      collectionLockedBy: args.workerId,
    },
  });
  if (claimed.count === 0) {
    return { collected: 0, done: true, stopped: true };
  }

  const contacts = await db.contact.findMany({
    where: buildPropertyMatchContactWhere(args.locationId, args.campaign.collectionCursor),
    select: campaignContactSelect(args.locationId),
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: limit,
  });

  const propertySnapshotForCampaign = args.campaign.propertySnapshot || {};
  const propertyInput = propertyMatchInput(propertySnapshotForCampaign);
  const marketContext = await getLocationMarketContext(args.locationId);
  const candidateContacts = contacts as AnyRecord[];
  const blockerData: AnyRecord[] = [];
  logPropertyMatchCampaignTiming("collection_contacts", {
    locationId: args.locationId,
    campaignId: args.campaign.id,
    contactsScanned: contacts.length,
    candidateContacts: candidateContacts.length,
  });

  const baseCandidateData = candidateContacts.flatMap((contact: any) => {
    const candidate = structuredCandidateData({
      locationId: args.locationId,
      campaignId: args.campaign.id,
      contact,
      propertyInput,
      marketContext,
    });
    return candidate ? [candidate] : [];
  });

  const priorShareEvidence = await findPriorPropertyShareEvidenceByConversation({
    snapshot: propertySnapshotForCampaign,
    conversationIds: baseCandidateData.map((candidate) => candidate.conversationId),
  });
  const candidateData = baseCandidateData.map((candidate) => {
    const evidence = priorShareEvidence.get(candidate.conversationId);
    if (!evidence) return candidate;
    return {
      ...candidate,
      aiVerdict: "no",
      aiReviewStatus: "done",
      score: Math.min(Number(candidate.score || 0), -2),
      confidence: 0.95,
      evidence: {
        ...(candidate.evidence || {}),
        priorShare: evidence,
        structured: {
          ...(candidate.evidence?.structured || {}),
          needsAi: false,
        },
      },
      reasoning: [
        "This property appears to have already been shared with the contact.",
        evidence.matchedBy?.length ? `Matched by ${evidence.matchedBy.join(" and ")}.` : null,
      ].filter(Boolean).join(" "),
      matchSummary: "Already shared with this contact.",
    };
  });

  const beforeWriteCampaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaign.id, locationId: args.locationId },
    select: { status: true, collectionStatus: true },
  });
  if (isPropertyMatchCampaignStopped(beforeWriteCampaign)) {
    await db.propertyMatchCampaign.updateMany({
      where: { id: args.campaign.id, collectionLockedBy: args.workerId },
      data: {
        collectionLockedAt: null,
        collectionLockedBy: null,
      },
    });
    return { collected: 0, done: true, stopped: true };
  }

  if (candidateData.length > 0) {
    await db.propertyMatchCandidate.createMany({
      data: candidateData,
      skipDuplicates: true,
    });
  }
  if (blockerData.length > 0) {
    await db.propertyMatchCandidate.createMany({
      data: blockerData,
      skipDuplicates: true,
    });
  }
  if (priorShareEvidence.size > 0) {
    const existingSharedCandidates = await db.propertyMatchCandidate.findMany({
      where: {
        campaignId: args.campaign.id,
        locationId: args.locationId,
        conversationId: { in: Array.from(priorShareEvidence.keys()) },
        reviewerStatus: { not: "sent" },
      },
      select: { id: true, conversationId: true, evidence: true, score: true },
    });
    for (const candidate of existingSharedCandidates) {
      const evidence = priorShareEvidence.get(candidate.conversationId || "");
      if (!evidence) continue;
      await db.propertyMatchCandidate.update({
        where: { id: candidate.id },
        data: {
          aiVerdict: "no",
          aiReviewStatus: "done",
          aiReviewLockedAt: null,
          aiReviewLockedBy: null,
          score: Math.min(Number(candidate.score || 0), -2),
          confidence: 0.95,
          evidence: {
            ...((candidate.evidence as AnyRecord) || {}),
            priorShare: evidence,
            structured: {
              ...((candidate.evidence as AnyRecord)?.structured || {}),
              needsAi: false,
            },
          },
          reasoning: [
            "This property appears to have already been shared with the contact.",
            evidence.matchedBy?.length ? `Matched by ${evidence.matchedBy.join(" and ")}.` : null,
          ].filter(Boolean).join(" "),
          matchSummary: "Already shared with this contact.",
          lastError: null,
        },
      });
    }
  }

  const lastContact = contacts.length > 0 ? contacts[contacts.length - 1] : null;
  const lastCursor = lastContact
    ? encodePropertyMatchContactCursor(lastContact as any) || args.campaign.collectionCursor || null
    : args.campaign.collectionCursor || null;
  const done = contacts.length < limit;
  const finished = await db.propertyMatchCampaign.updateMany({
    where: {
      id: args.campaign.id,
      locationId: args.locationId,
      status: { not: CAMPAIGN_STOPPED_STATUS },
      collectionStatus: { not: CAMPAIGN_STOPPED_STATUS },
      collectionLockedBy: args.workerId,
    },
    data: {
      collectionStatus: done ? "done" : "pending",
      collectionCursor: lastCursor,
      collectionLockedAt: null,
      collectionLockedBy: null,
      collectionFinishedAt: done ? new Date() : null,
      lastError: null,
    },
  });
  if (finished.count === 0) {
    return { collected: candidateData.length + blockerData.length, done: true, stopped: true };
  }

  return { collected: candidateData.length + blockerData.length, done };
}

async function isPropertyMatchCampaignStopRequested(args: {
  locationId: string;
  campaignId: string;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
    select: { status: true, collectionStatus: true },
  });
  return isPropertyMatchCampaignStopped(campaign);
}

async function releasePropertyMatchAiLocks(args: {
  locationId: string;
  campaignId: string;
  workerId?: string | null;
}) {
  return db.propertyMatchCandidate.updateMany({
    where: {
      campaignId: args.campaignId,
      locationId: args.locationId,
      aiReviewStatus: "processing",
      ...(args.workerId ? { aiReviewLockedBy: args.workerId } : {}),
    },
    data: {
      aiReviewStatus: "pending",
      aiReviewLockedAt: null,
      aiReviewLockedBy: null,
    },
  });
}

export async function retryPropertyMatchCampaignAiErrors(args: {
  locationId: string;
  campaignId: string;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
    select: { id: true },
  });
  if (!campaign) return { success: false as const, error: "Campaign not found." };

  const retried = await db.propertyMatchCandidate.updateMany({
    where: {
      campaignId: campaign.id,
      locationId: args.locationId,
      aiReviewStatus: "failed",
    },
    data: {
      aiReviewStatus: "pending",
      aiReviewLockedAt: null,
      aiReviewLockedBy: null,
      lastError: null,
    },
  });
  if (retried.count > 0) {
    await db.propertyMatchCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "processing",
        processingFinishedAt: null,
        lastError: null,
      },
    });
    await refreshCampaignCounts(campaign.id);
  }
  return { success: true as const, retried: retried.count };
}

export async function cancelPropertyMatchCampaignBatch(args: {
  locationId: string;
  campaignId: string;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
    select: { id: true },
  });
  if (!campaign) return { success: false as const, error: "Campaign not found." };

  const [released] = await db.$transaction([
    db.propertyMatchCandidate.updateMany({
      where: {
        campaignId: campaign.id,
        locationId: args.locationId,
        aiReviewStatus: "processing",
      },
      data: {
        aiReviewStatus: "pending",
        aiReviewLockedAt: null,
        aiReviewLockedBy: null,
      },
    }),
    db.propertyMatchCampaign.update({
      where: { id: campaign.id },
      data: {
        status: CAMPAIGN_STOPPED_STATUS,
        collectionStatus: CAMPAIGN_STOPPED_STATUS,
        collectionLockedAt: null,
        collectionLockedBy: null,
        processingFinishedAt: null,
        lastError: CAMPAIGN_STOPPED_ERROR,
      },
    }),
  ]);

  return { success: true as const, released: released.count };
}

async function scoreCandidateWithAi(args: {
  locationId: string;
  campaign: AnyRecord;
  candidate: AnyRecord;
  model?: string | null;
  fallbackPolicy?: PropertyMatchFallbackPolicy | null;
  actorUserId?: string | null;
}) {
  const primaryModel = normalizeText(args.model, 120)
    || PROPERTY_MATCH_FAST_MODEL
    || await resolveAiModelDefault(args.locationId, "general")
    || GEMINI_FLASH_STABLE_FALLBACK;
  const fallbackPolicy = normalizePropertyMatchFallbackPolicy(args.fallbackPolicy);
  const prompt = `Decide whether this real-estate contact should be sent this property.

Return JSON only:
{
  "recommend": boolean,
  "confidence": number,
  "matchSummary": string,
  "reasoning": string,
  "evidence": [{"field": string, "quote": string, "supports": "yes"|"maybe"|"no"}]
}

Rules:
- Recommend only when the contact summary contains clear positive evidence that this property fits.
- Compare current requirements first, then use interested/rejected property history as supporting evidence.
- Previously sent properties are neutral history. Never treat silence after a send as interest.
- Do not recommend the same property if it is listed as previously sent.
- Newer explicit client statements override older stored requirements.
- Missing, broad, stale, or contradictory information means recommend=false.
- A good recommendation normally matches at least two important needs, including one of location, budget, bedrooms, or size.
- Explain the decisive matches or conflicts plainly. Do not invent facts.`;

  const recentMessages = await db.message.findMany({
    where: { conversationId: args.candidate.conversationId || "" },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, direction: true, body: true, createdAt: true },
  });
  recentMessages.reverse();
  const warnings = candidateProfileWarnings(args.candidate);
  const decisionContext = buildPropertyMatchDecisionContext({
    propertySnapshot: args.campaign.propertySnapshot || {},
    campaignProfile: args.candidate.evidence?.campaignProfile || null,
    recentMessages,
  });

  const userContent = `CONTACT SUMMARY
${decisionContext.contactSummary}

PROPERTY SUMMARY
${decisionContext.propertySummary}`;

  const attemptedModels: string[] = [];
  const attemptErrors: string[] = [];
  let result: Awaited<ReturnType<typeof callLLMWithMetadata>> | null = null;
  let normalized: ReturnType<typeof normalizeAiMatchAssessment> | null = null;
  for (const modelName of buildPropertyMatchModelAttempts(primaryModel, fallbackPolicy)) {
    attemptedModels.push(modelName);
    try {
      const attemptResult = await callLLMWithMetadata(modelName, prompt, userContent, {
        jsonMode: true,
        jsonSchema: PROPERTY_MATCH_RESPONSE_SCHEMA,
        jsonSchemaName: "property_match_assessment",
        temperature: 0.1,
        maxOutputTokens: 700,
        thinkingBudget: PROPERTY_MATCH_THINKING_BUDGET,
        locationId: args.locationId,
      });
      const parsed = extractJsonObject(attemptResult.text);
      normalized = normalizeAiMatchAssessment(parsed, {
        ...(args.candidate.evidence || {}),
        warnings,
        decisionContext,
      });
      result = attemptResult;
      break;
    } catch (error) {
      attemptErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!result || !normalized) {
    const failure = attemptErrors[attemptErrors.length - 1] || "AI review failed.";
    throw new Error(`AI review failed after ${attemptedModels.length} attempt${attemptedModels.length === 1 ? "" : "s"}: ${failure}`);
  }
  const promptTokens = Number(result.usage.promptTokens || 0);
  const completionTokens = Number(result.usage.completionTokens || 0);
  const totalTokens = Number(result.usage.totalTokens || promptTokens + completionTokens);
  const meteredModel = result.model || attemptedModels[attemptedModels.length - 1] || primaryModel;
  normalized.evidence = attachPropertyMatchAiRunEvidence(normalized.evidence, {
    modelRequested: primaryModel,
    modelUsed: meteredModel,
    provider: result.provider,
  });
  normalized.evidence.aiRun = {
    ...normalized.evidence.aiRun,
    fallbackPolicy,
    attemptedModels,
  };
  const estimatedCostUsd = calculateRunCost(meteredModel, promptTokens, completionTokens);

  await securelyRecordAiUsage({
    locationId: args.locationId,
    userId: args.actorUserId || null,
    resourceType: "contact",
    resourceId: args.candidate.contactId,
    featureArea: "property_match_campaigns",
    action: "score_candidate",
    provider: result.provider,
    model: meteredModel,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    metadata: {
      campaignId: args.campaign.id,
      candidateId: args.candidate.id,
      modelRequested: primaryModel,
      modelUsed: meteredModel,
      fallbackPolicy,
      attemptedModels,
      totalTokens,
      estimatedCostUsd,
      verdict: normalized.verdict,
    },
  });

  return normalized;
}

async function resolvePropertyMatchCampaignProcessingConfig(args: {
  campaign: AnyRecord;
  model?: string | null;
  fallbackPolicy?: PropertyMatchFallbackPolicy | null;
}) {
  let scoringModel = normalizeText(args.model, 120) || normalizeText(args.campaign.scoringModel, 120);
  let fallbackPolicy = normalizePropertyMatchFallbackPolicy(
    args.fallbackPolicy ?? args.campaign.fallbackPolicy,
  );

  if (!scoringModel && args.campaign.createdByUserId) {
    const preference = await settingsService.getDocument<{
      propertyMatchCampaignModel?: string | null;
      propertyMatchCampaignFallbackPolicy?: PropertyMatchFallbackPolicy | null;
    }>({
      scopeType: "USER",
      scopeId: args.campaign.createdByUserId,
      domain: SETTINGS_DOMAINS.USER_AI_PREFERENCES,
    }).catch(() => null);
    scoringModel = normalizeText(preference?.payload?.propertyMatchCampaignModel, 120);
    fallbackPolicy = normalizePropertyMatchFallbackPolicy(
      preference?.payload?.propertyMatchCampaignFallbackPolicy || fallbackPolicy,
    );
  }

  scoringModel = scoringModel || PROPERTY_MATCH_FAST_MODEL;
  if (
    scoringModel !== args.campaign.scoringModel
    || fallbackPolicy !== args.campaign.fallbackPolicy
  ) {
    await db.propertyMatchCampaign.update({
      where: { id: args.campaign.id },
      data: { scoringModel, fallbackPolicy },
    });
  }

  return { scoringModel, fallbackPolicy };
}

export async function startPropertyMatchCampaignProcessing(args: {
  locationId: string;
  campaignId: string;
  model?: string | null;
  fallbackPolicy?: PropertyMatchFallbackPolicy | null;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
  });
  if (!campaign) return { success: false as const, error: "Campaign not found." };
  const processingConfig = await resolvePropertyMatchCampaignProcessingConfig({
    campaign,
    model: args.model,
    fallbackPolicy: args.fallbackPolicy,
  });
  const resumingStoppedCampaign = isPropertyMatchCampaignStopped(campaign);
  const updated = await db.propertyMatchCampaign.update({
    where: { id: campaign.id },
    data: {
      status: "processing",
      ...(resumingStoppedCampaign ? {
        collectionStatus: campaign.collectionStatus === "done" ? "done" : "pending",
        collectionLockedAt: null,
        collectionLockedBy: null,
      } : {}),
      processingStartedAt: new Date(),
      processingFinishedAt: null,
      lastError: null,
      scoringModel: processingConfig.scoringModel,
      fallbackPolicy: processingConfig.fallbackPolicy,
    },
  });
  return { success: true as const, campaign: updated };
}

export async function processPropertyMatchCampaignBatch(args: {
  locationId: string;
  campaignId: string;
  actorUserId?: string | null;
  limit?: number;
  model?: string | null;
  fallbackPolicy?: PropertyMatchFallbackPolicy | null;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
  });
  if (!campaign) return { success: false as const, error: "Campaign not found." };
  if (!CAMPAIGN_STATUSES.has(campaign.status)) return { success: false as const, error: "Invalid campaign status." };
  const processingConfig = await resolvePropertyMatchCampaignProcessingConfig({
    campaign,
    model: args.model,
    fallbackPolicy: args.fallbackPolicy,
  });

  const limit = Math.max(1, Math.min(20, Number(args.limit || 5)));
  const workerId = [
    "property-match",
    args.campaignId,
    Date.now(),
    Math.random().toString(36).slice(2),
  ].join(":");

  const campaignForProcessing = isPropertyMatchCampaignStopped(campaign)
    ? await db.propertyMatchCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "processing",
        collectionStatus: campaign.collectionStatus === "done" ? "done" : "pending",
        collectionLockedAt: null,
        collectionLockedBy: null,
        lastError: null,
        processingStartedAt: campaign.processingStartedAt || new Date(),
        processingFinishedAt: null,
      },
    })
    : campaign;

  const staleLockedBefore = new Date(Date.now() - AI_REVIEW_LOCK_TIMEOUT_MS);
  const pendingAiBeforeCollection = await db.propertyMatchCandidate.findFirst({
    where: buildAiReviewClaimWhere({
      campaignId: campaign.id,
      locationId: args.locationId,
      staleLockedBefore,
    }),
    select: { id: true },
  });

  const collection = pendingAiBeforeCollection
    ? { collected: 0, done: campaignForProcessing.collectionStatus === "done" }
    : await collectPropertyMatchCandidatesBatch({
      locationId: args.locationId,
      campaign: campaignForProcessing,
      workerId,
      limit: Math.max(20, limit * 2),
    });
  if (collection.stopped || await isPropertyMatchCampaignStopRequested({
    locationId: args.locationId,
    campaignId: args.campaignId,
  })) {
    await releasePropertyMatchAiLocks({
      locationId: args.locationId,
      campaignId: args.campaignId,
      workerId,
    });
    return {
      success: true as const,
      collected: collection.collected,
      processed: 0,
      failed: 0,
      remaining: false,
      stopped: true,
      status: CAMPAIGN_STOPPED_STATUS,
    };
  }
  const refreshedCampaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
  });
  if (!refreshedCampaign) return { success: false as const, error: "Campaign not found." };

  const reopenedProfileBlocked = await reopenVerifiedProfileBlockedCandidates({
    locationId: args.locationId,
    campaign: refreshedCampaign,
    limit: Math.max(50, limit),
  });

  const finalizedUnverified = await finalizeUnverifiedPropertyMatchCandidates({
    locationId: args.locationId,
    campaignId: args.campaignId,
  });

  const claimable = await db.propertyMatchCandidate.findMany({
    where: buildAiReviewClaimWhere({
      campaignId: campaign.id,
      locationId: args.locationId,
      staleLockedBefore,
    }),
    orderBy: [
      { score: "desc" },
      { confidence: "desc" },
      { contact: { createdAt: "desc" } },
      { createdAt: "desc" },
    ],
    select: { id: true },
    take: limit,
  });
  const claimableIds = claimable.map((candidate: any) => candidate.id);
  if (claimableIds.length > 0) {
    await db.propertyMatchCandidate.updateMany({
      where: buildAiReviewClaimWhere({
        ids: claimableIds,
        campaignId: campaign.id,
        locationId: args.locationId,
        staleLockedBefore,
      }),
      data: {
        aiReviewStatus: "processing",
        aiReviewLockedAt: new Date(),
        aiReviewLockedBy: workerId,
      },
    });
  }

  const candidates = claimableIds.length > 0
    ? await db.propertyMatchCandidate.findMany({
      where: {
        id: { in: claimableIds },
        locationId: args.locationId,
        aiReviewStatus: "processing",
        aiReviewLockedBy: workerId,
      },
      include: { contact: true },
      orderBy: [
        { score: "desc" },
        { confidence: "desc" },
        { contact: { createdAt: "desc" } },
        { createdAt: "desc" },
      ],
    })
    : [];

  let processed = finalizedUnverified.count + reopenedProfileBlocked;
  let failed = 0;
  const aiScoringStartedAt = Date.now();
  const aiResults = await mapWithConcurrency(candidates as AnyRecord[], Math.min(AI_SCORING_CONCURRENCY, limit), async (candidate) => {
    if (await isPropertyMatchCampaignStopRequested({
      locationId: args.locationId,
      campaignId: args.campaignId,
    })) {
      return { processed: 0, failed: 0, stopped: true };
    }
    try {
      const ai = await scoreCandidateWithAi({
        locationId: args.locationId,
        campaign: refreshedCampaign,
        candidate,
        model: processingConfig.scoringModel,
        fallbackPolicy: processingConfig.fallbackPolicy,
        actorUserId: args.actorUserId || null,
      });
      const updatedCandidate = await db.propertyMatchCandidate.updateMany({
        where: {
          id: candidate.id,
          locationId: args.locationId,
          aiReviewStatus: "processing",
          aiReviewLockedBy: workerId,
        },
        data: {
          aiVerdict: ai.verdict,
          confidence: ai.confidence,
          evidence: ai.evidence,
          reasoning: ai.reasoning,
          matchSummary: ai.matchSummary,
          aiReviewStatus: "done",
          aiReviewAttempts: { increment: 1 },
          aiReviewLockedAt: null,
          aiReviewLockedBy: null,
          lastError: null,
        },
      });
      if (updatedCandidate.count === 0) {
        return { processed: 0, failed: 0, stopped: false };
      }
      return { processed: 1, failed: 0, stopped: false };
    } catch (error: any) {
      await db.propertyMatchCandidate.updateMany({
        where: {
          id: candidate.id,
          locationId: args.locationId,
          aiReviewStatus: "processing",
          aiReviewLockedBy: workerId,
        },
        data: {
          aiVerdict: "maybe",
          confidence: 0.4,
          evidence: {
            ...(candidate.evidence || {}),
            structured: {
              ...(candidate.evidence?.structured || {}),
              needsAi: false,
            },
          },
          reasoning: "AI review failed; kept for human review.",
          aiReviewStatus: "failed",
          aiReviewAttempts: { increment: 1 },
          aiReviewLockedAt: null,
          aiReviewLockedBy: null,
          lastError: error?.message || "AI review failed.",
        },
      });
      return { processed: 0, failed: 1, stopped: false };
    }
  });
  for (const result of aiResults) {
    processed += result.processed;
    failed += result.failed;
  }
  if (candidates.length > 0) {
    logPropertyMatchCampaignTiming("ai_scored_candidates", {
      locationId: args.locationId,
      campaignId: args.campaignId,
      candidates: candidates.length,
      processed: aiResults.reduce((sum, result) => sum + result.processed, 0),
      failed: aiResults.reduce((sum, result) => sum + result.failed, 0),
      stopped: aiResults.some((result) => result.stopped),
      concurrency: Math.min(AI_SCORING_CONCURRENCY, limit),
      model: processingConfig.scoringModel,
      fallbackPolicy: processingConfig.fallbackPolicy,
      elapsedMs: Date.now() - aiScoringStartedAt,
    });
  }
  if (aiResults.some((result) => result.stopped)) {
    await releasePropertyMatchAiLocks({
      locationId: args.locationId,
      campaignId: args.campaignId,
      workerId,
    });
    const stopped = await refreshCampaignCounts(campaign.id);
    return {
      success: true as const,
      collected: collection.collected,
      processed,
      failed,
      remaining: false,
      stopped: true,
      status: stopped.status,
    };
  }

  const updated = await refreshCampaignCounts(campaign.id);
  return {
    success: true as const,
    collected: collection.collected,
    processed,
    failed,
    remaining: updated.status === "processing",
    status: updated.status,
  };
}

export async function processPropertyMatchCampaignUntilIdle(args: {
  locationId: string;
  campaignId: string;
  actorUserId?: string | null;
  model?: string | null;
  fallbackPolicy?: PropertyMatchFallbackPolicy | null;
  timeBudgetMs?: number;
  limit?: number;
}) {
  const lease = await acquirePropertyMatchCampaignWorkerLease(args.campaignId);
  if (!lease.acquired) {
    return {
      success: true as const,
      collected: 0,
      processed: 0,
      failed: 0,
      waves: 0,
      remaining: true,
      stopped: false,
      status: "processing",
      skipped: true as const,
      reason: "already_processing",
      elapsedMs: 0,
    };
  }
  const startedAt = Date.now();
  const timeBudgetMs = Math.max(5_000, Math.min(120_000, Number(args.timeBudgetMs || 50_000)));
  const limit = Math.max(1, Math.min(AI_SCORING_CONCURRENCY, Number(args.limit || AI_SCORING_CONCURRENCY)));
  let collected = 0;
  let processed = 0;
  let failed = 0;
  let waves = 0;
  let latest: Awaited<ReturnType<typeof processPropertyMatchCampaignBatch>> | null = null;

  try {
    do {
      latest = await processPropertyMatchCampaignBatch({
        locationId: args.locationId,
        campaignId: args.campaignId,
        actorUserId: args.actorUserId || null,
        model: args.model || null,
        fallbackPolicy: args.fallbackPolicy,
        limit,
      });
      waves += 1;
      if (!latest.success) return { ...latest, collected, processed, failed, waves };
      collected += Number(latest.collected || 0);
      processed += Number(latest.processed || 0);
      failed += Number(latest.failed || 0);
      if (latest.stopped || !latest.remaining) break;
    } while (Date.now() - startedAt < timeBudgetMs);

    return {
      success: true as const,
      collected,
      processed,
      failed,
      waves,
      remaining: Boolean(latest?.success && latest.remaining && !latest.stopped),
      stopped: Boolean(latest?.success && latest.stopped),
      status: latest?.success ? latest.status : "failed",
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await lease.release();
  }
}

export async function listPropertyMatchCampaigns(args: {
  locationId: string;
  limit?: number;
  query?: string | null;
}) {
  const query = normalizeText(args.query, 120);
  const campaigns = await db.propertyMatchCampaign.findMany({
    where: {
      locationId: args.locationId,
      ...(query ? {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          {
            property: {
              is: {
                OR: [
                  { title: { contains: query, mode: "insensitive" } },
                  { reference: { contains: query, mode: "insensitive" } },
                  { city: { contains: query, mode: "insensitive" } },
                  { propertyLocation: { contains: query, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      } : {}),
    },
    include: {
      property: { select: { id: true, title: true, reference: true, price: true, city: true, propertyLocation: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(50, Number(args.limit || 50))),
  });
  // Campaign rows already carry denormalized headline totals. Exact queue counts
  // belong to the selected campaign detail request; loading every candidate and
  // its AI evidence here makes opening the campaign browser scale with all leads.
  return campaigns;
}

export async function getPropertyMatchCampaignProgress(args: {
  locationId: string;
  campaignId: string;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
    include: {
      property: { select: { id: true, title: true, reference: true, price: true, city: true, propertyLocation: true } },
    },
  });
  if (!campaign) return null;
  const [campaignWithCounts] = await withPropertyMatchQueueCounts(args.locationId, [campaign as any]);
  const queueCounts = campaignWithCounts?.queueCounts || summarizePropertyMatchCandidateQueues([]);
  return {
    ...(campaignWithCounts || campaign),
    totalCandidates: queueCounts.allCount,
    processedCandidates: Math.max(0, queueCounts.allCount - queueCounts.pendingAiCount),
    queueCounts,
  };
}

export async function listContactPropertyRecommendations(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(12, Number(args.limit || 5)));
  const rows = await db.propertyMatchCandidate.findMany({
    where: {
      locationId: args.locationId,
      contactId: args.contactId,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      aiVerdict: "yes",
      aiReviewStatus: "done",
      reviewerStatus: { notIn: ["rejected", "skipped"] },
      NOT: alreadySharedCandidateWhere(),
    },
    include: {
      campaign: {
        select: {
          id: true,
          title: true,
          status: true,
          propertySnapshot: true,
          property: {
            select: {
              id: true,
              title: true,
              reference: true,
              price: true,
              city: true,
              propertyLocation: true,
            },
          },
        },
      },
      contact: {
        select: {
          profileVerificationStatus: true,
        },
      },
      conversation: {
        select: {
          id: true,
          ghlConversationId: true,
        },
      },
    },
    orderBy: [
      { reviewerStatus: "asc" },
      { aiVerdict: "desc" },
      { score: "desc" },
      { confidence: "desc" },
      { updatedAt: "desc" },
    ],
    take: limit,
  });

  return rows.map((row: AnyRecord) => {
    const snapshot = (row.campaign?.propertySnapshot || {}) as AnyRecord;
    const property = row.campaign?.property || {};
    const warningEvidence = Array.isArray(row.evidence?.warnings) ? row.evidence.warnings : [];
    return {
      candidateId: row.id,
      campaignId: row.campaignId,
      campaignTitle: row.campaign?.title || null,
      campaignStatus: row.campaign?.status || null,
      contactId: row.contactId,
      conversationId: row.conversationId,
      property: {
        id: property.id || snapshot.id || null,
        title: property.title || snapshot.title || row.campaign?.title || "Property",
        reference: property.reference || snapshot.reference || null,
        price: property.price ?? snapshot.price ?? null,
        currency: snapshot.currency || "EUR",
        city: property.city || snapshot.city || null,
        propertyLocation: property.propertyLocation || snapshot.propertyLocation || null,
        sourceUrl: snapshot.sourceUrl || null,
      },
      aiVerdict: row.aiVerdict,
      aiReviewStatus: row.aiReviewStatus,
      reviewerStatus: row.reviewerStatus,
      confidence: row.confidence,
      score: row.score,
      matchSummary: row.matchSummary || null,
      reasoning: row.reasoning || null,
      draftBody: row.draftBody || "",
      sentAt: row.sentAt,
      reviewedAt: row.reviewedAt,
      warnings: warningEvidence.length ? warningEvidence : candidateProfileWarnings(row),
      contactSummary: row.evidence?.decisionContext?.contactSummary
        || row.evidence?.campaignProfile?.requirementSummary
        || null,
      interactionSummary: row.evidence?.campaignProfile?.interactionSummary || null,
      propertySummary: row.evidence?.decisionContext?.propertySummary || formatPropertyFacts(snapshot),
    };
  });
}

async function withPropertyMatchQueueCounts(locationId: string, campaigns: AnyRecord[]) {
  const campaignIds = campaigns.map((campaign) => campaign.id).filter(Boolean);
  if (campaignIds.length === 0) return campaigns;
  const candidates = await db.propertyMatchCandidate.findMany({
    where: { locationId, campaignId: { in: campaignIds } },
    select: {
      campaignId: true,
      aiVerdict: true,
      aiReviewStatus: true,
      reviewerStatus: true,
      matchSummary: true,
      reasoning: true,
    },
  });
  const byCampaign = new Map<string, any[]>();
  for (const candidate of candidates as any[]) {
    const rows = byCampaign.get(candidate.campaignId) || [];
    rows.push(candidate);
    byCampaign.set(candidate.campaignId, rows);
  }
  return campaigns.map((campaign) => ({
    ...campaign,
    queueCounts: summarizePropertyMatchCandidateQueues(byCampaign.get(campaign.id) || []),
  }));
}

export async function updatePropertyMatchCampaign(args: {
  locationId: string;
  campaignId: string;
  title?: string | null;
  priorityNote?: string | null;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
    select: { id: true },
  });
  if (!campaign) return { success: false as const, error: "Campaign not found." };

  const title = normalizeText(args.title, 240);
  const priorityNote = normalizeText(args.priorityNote, 4000);
  if (!title) return { success: false as const, error: "Campaign title is required." };

  const updated = await db.propertyMatchCampaign.update({
    where: { id: campaign.id },
    data: {
      title,
      priorityNote: priorityNote || null,
    },
    include: {
      property: { select: { id: true, title: true, reference: true, price: true, city: true, propertyLocation: true } },
    },
  });

  return { success: true as const, campaign: updated };
}

export async function updatePropertyMatchCampaignProcessingConfig(args: {
  locationId: string;
  campaignId: string;
  scoringModel: string;
  fallbackPolicy: PropertyMatchFallbackPolicy;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
    select: { id: true },
  });
  if (!campaign) return { success: false as const, error: "Campaign not found." };
  const scoringModel = normalizeText(args.scoringModel, 120);
  if (!scoringModel) return { success: false as const, error: "Select an AI model." };
  const updated = await db.propertyMatchCampaign.update({
    where: { id: campaign.id },
    data: {
      scoringModel,
      fallbackPolicy: normalizePropertyMatchFallbackPolicy(args.fallbackPolicy),
    },
  });
  return { success: true as const, campaign: updated };
}

export async function deletePropertyMatchCampaign(args: {
  locationId: string;
  campaignId: string;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
    select: { id: true },
  });
  if (!campaign) return { success: false as const, error: "Campaign not found." };

  await db.propertyMatchCampaign.delete({ where: { id: campaign.id } });
  return { success: true as const };
}

export async function getPropertyMatchCampaignDetail(args: {
  locationId: string;
  campaignId: string;
  queue?: PropertyMatchCampaignQueue;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
    include: {
      property: { select: { id: true, title: true, reference: true, price: true, city: true, propertyLocation: true } },
    },
  });
  if (!campaign) return null;

  const queue = args.queue || "review";
  const candidateWhere = propertyMatchCandidateWhereForQueue(queue);

  const candidates = await db.propertyMatchCandidate.findMany({
    where: {
      campaignId: campaign.id,
      locationId: args.locationId,
      ...candidateWhere,
    },
    include: {
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          contactType: true,
          leadGoal: true,
          profileVerificationStatus: true,
          requirementStatus: true,
          requirementBedrooms: true,
          requirementMaxPrice: true,
          requirementPropertyTypes: true,
          requirementPropertyLocations: true,
          requirementSummary: true,
        },
      },
      conversation: { select: { id: true, ghlConversationId: true, lastMessageAt: true, updatedAt: true } },
    },
    orderBy: [
      { aiVerdict: "desc" },
      { score: "desc" },
      { confidence: "desc" },
      { contact: { createdAt: "desc" } },
      { conversation: { lastMessageAt: "desc" } },
    ],
    take: 100,
  });

  const [campaignWithCounts] = await withPropertyMatchQueueCounts(args.locationId, [campaign as any]);
  return { campaign: campaignWithCounts || campaign, candidates };
}

function propertyMatchCandidateWhereForQueue(queue: PropertyMatchCampaignQueue) {
  if (queue === "all") return {};
  if (queue === "review") {
    return {
      reviewerStatus: "pending",
      aiVerdict: { in: ["yes", "maybe"] },
      aiReviewStatus: "done",
    };
  }
  if (queue === "approved") return { reviewerStatus: "approved" };
  if (queue === "sent") return { reviewerStatus: "sent" };
  if (queue === "skipped") return { reviewerStatus: "skipped" };
  if (queue === "rejected") return { reviewerStatus: "rejected" };
  if (queue === "needs_profile_verification") {
    return {
      reviewerStatus: "pending",
      ...profileVerificationBlockWhere(),
    };
  }
  if (queue === "already_shared") {
    return {
      OR: [
        { matchSummary: { contains: "Already shared", mode: "insensitive" } },
        { reasoning: { contains: "already been shared", mode: "insensitive" } },
      ],
    };
  }
  if (queue === "ai_error") {
    return { aiReviewStatus: "failed" };
  }
  return {
    reviewerStatus: "pending",
    OR: [
      { aiVerdict: "no" },
      {
        aiVerdict: { in: ["yes", "maybe"] },
        aiReviewStatus: { in: ["done", "failed"] },
        contact: {
          OR: [
            { profileVerificationStatus: null },
            { profileVerificationStatus: { not: "verified_lead" } },
          ],
        },
      },
    ],
    NOT: {
      OR: [
        { matchSummary: { contains: "Already shared", mode: "insensitive" } },
        { reasoning: { contains: "already been shared", mode: "insensitive" } },
        ...profileVerificationBlockWhere().OR,
      ],
    },
  };
}

export async function updatePropertyMatchCandidateReview(args: {
  locationId: string;
  candidateId: string;
  reviewerStatus: string;
  actorUserId?: string | null;
  rejectedReason?: string | null;
  refreshCampaignCount?: boolean;
}) {
  const reviewerStatus = String(args.reviewerStatus || "").trim();
  if (!REVIEWER_STATUSES.has(reviewerStatus)) {
    return { success: false as const, error: "Invalid review status." };
  }
  const candidate = await db.propertyMatchCandidate.findFirst({
    where: { id: args.candidateId, locationId: args.locationId },
    select: {
      id: true,
      campaignId: true,
      reviewerStatus: true,
      aiVerdict: true,
      aiReviewStatus: true,
      contact: { select: { profileVerificationStatus: true } },
    },
  });
  if (!candidate) return { success: false as const, error: "Candidate not found." };
  if (candidate.reviewerStatus === "sent") return { success: false as const, error: "Sent candidates cannot be changed." };
  if (reviewerStatus === "approved" && !canCandidateDraftOrSend(candidate)) {
    return { success: false as const, error: "AI review must finish before approval." };
  }
  if (reviewerStatus === "approved") {
    const priorShare = await findPriorPropertyShareForCandidate({
      locationId: args.locationId,
      candidateId: candidate.id,
    });
    if (priorShare) {
      await markPropertyMatchCandidateAlreadyShared({
        locationId: args.locationId,
        candidateId: candidate.id,
        evidence: priorShare,
      });
      return { success: false as const, error: "This property was already shared with this contact." };
    }
  }

  await db.propertyMatchCandidate.update({
    where: { id: candidate.id },
    data: {
      reviewerStatus,
      reviewedByUserId: args.actorUserId || null,
      reviewedAt: new Date(),
      rejectedReason: reviewerStatus === "rejected" || reviewerStatus === "skipped"
        ? normalizeText(args.rejectedReason, 1000)
        : null,
    },
  });
  if (args.refreshCampaignCount !== false) {
    await refreshCampaignCounts(candidate.campaignId);
  }
  return { success: true as const };
}

export async function savePropertyMatchCandidateDraft(args: {
  locationId: string;
  candidateId: string;
  draftBody: string;
}) {
  const draftBody = normalizeText(args.draftBody, 12000);
  if (!draftBody) return { success: false as const, error: "Draft cannot be empty." };
  const candidate = await db.propertyMatchCandidate.findFirst({
    where: { id: args.candidateId, locationId: args.locationId },
    select: {
      id: true,
      aiVerdict: true,
      aiReviewStatus: true,
      contact: { select: { profileVerificationStatus: true } },
    },
  });
  if (!candidate) return { success: false as const, error: "Candidate not found." };
  if (!canCandidateDraftOrSend(candidate)) {
    return { success: false as const, error: "AI review must finish before drafting or approval." };
  }
  const priorShare = await findPriorPropertyShareForCandidate({
    locationId: args.locationId,
    candidateId: candidate.id,
  });
  if (priorShare) {
    await markPropertyMatchCandidateAlreadyShared({
      locationId: args.locationId,
      candidateId: candidate.id,
      evidence: priorShare,
    });
    return { success: false as const, error: "This property was already shared with this contact." };
  }
  const updated = await db.propertyMatchCandidate.update({
    where: { id: candidate.id },
    data: {
      draftBody,
      draftGeneratedAt: new Date(),
      reviewerStatus: "approved",
      reviewedAt: new Date(),
    },
  });
  return { success: true as const, candidate: updated };
}

export async function savePropertyMatchCandidateGeneratedDraft(args: {
  locationId: string;
  candidateId: string;
  draftBody: string;
}) {
  const draftBody = normalizeText(args.draftBody, 12000);
  if (!draftBody) return { success: false as const, error: "Draft cannot be empty." };
  const candidate = await db.propertyMatchCandidate.findFirst({
    where: { id: args.candidateId, locationId: args.locationId },
    select: {
      id: true,
      aiVerdict: true,
      aiReviewStatus: true,
      contact: { select: { profileVerificationStatus: true } },
    },
  });
  if (!candidate) return { success: false as const, error: "Candidate not found." };
  if (!canCandidateDraftOrSend(candidate)) {
    return { success: false as const, error: "AI review must finish before drafting." };
  }
  const priorShare = await findPriorPropertyShareForCandidate({
    locationId: args.locationId,
    candidateId: candidate.id,
  });
  if (priorShare) {
    await markPropertyMatchCandidateAlreadyShared({
      locationId: args.locationId,
      candidateId: candidate.id,
      evidence: priorShare,
    });
    return { success: false as const, error: "This property was already shared with this contact." };
  }
  const updated = await db.propertyMatchCandidate.update({
    where: { id: candidate.id },
    data: {
      draftBody,
      draftGeneratedAt: new Date(),
    },
  });
  return { success: true as const, candidate: updated };
}

export async function markPropertyMatchCandidateSent(args: {
  locationId: string;
  candidateId: string;
}) {
  const candidate = await db.propertyMatchCandidate.findFirst({
    where: { id: args.candidateId, locationId: args.locationId },
    select: {
      id: true,
      campaignId: true,
      contactId: true,
      conversationId: true,
      aiVerdict: true,
      aiReviewStatus: true,
      campaign: { select: { propertyId: true, propertySnapshot: true } },
      contact: { select: { profileVerificationStatus: true } },
    },
  });
  if (!candidate) return { success: false as const, error: "Candidate not found." };
  if (!canCandidateDraftOrSend(candidate)) {
    return { success: false as const, error: "Contact profile must be verified before sending." };
  }
  const sentAt = new Date();
  await db.propertyMatchCandidate.update({
    where: { id: candidate.id },
    data: {
      reviewerStatus: "sent",
      sentAt,
      lastError: null,
    },
  });
  const snapshot = (candidate.campaign.propertySnapshot || {}) as AnyRecord;
  try {
    await recordContactPropertyInteraction({
      locationId: args.locationId,
      contactId: candidate.contactId,
      conversationId: candidate.conversationId,
      propertyId: candidate.campaign.propertyId,
      propertyReference: snapshot.reference || null,
      propertyUrl: snapshot.sourceUrl || null,
      eventType: "sent",
      sentiment: "neutral",
      signalStrength: "observed",
      sourceType: "campaign",
      sourceId: candidate.id,
      occurredAt: sentAt,
      evidence: { campaignId: candidate.campaignId },
    });
  } catch (error) {
    console.warn("[property-match-campaign] Failed to record sent-property interaction:", error);
  }
  await refreshCampaignCounts(candidate.campaignId);
  return { success: true as const };
}
