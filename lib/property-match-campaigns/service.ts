import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { calculateRunCost } from "@/lib/ai/pricing";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { deriveComposerInitialChannel } from "@/lib/conversations/channel-summary";
import {
  evaluateStructuredPropertyMatch,
  type MatchVerdict,
  type PropertyMatchInput,
  type ContactRequirementInput,
} from "@/lib/property-match-campaigns/matching";

type AnyRecord = Record<string, any>;
export type PropertyMatchCampaignQueue =
  | "review"
  | "approved"
  | "sent"
  | "skipped"
  | "rejected"
  | "not_match"
  | "already_shared"
  | "all";

const CAMPAIGN_STATUSES = new Set(["draft", "processing", "review", "completed", "canceled", "failed"]);
const REVIEWER_STATUSES = new Set(["pending", "approved", "rejected", "sent", "skipped"]);
const LOW_CONFIDENCE_YES_THRESHOLD = 0.65;
const AI_REVIEW_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const CONTACT_COLLECTION_BATCH_SIZE = 200;
const CAMPAIGN_STOPPED_STATUS = "canceled";
const CAMPAIGN_STOPPED_ERROR = "Processing stopped by user.";
const SEEKER_LEAD_GOALS = ["To Buy", "To Rent"];
const NON_SEEKER_LEAD_GOALS = ["To List", "To Sell", "Other"];
const EXCLUDED_CONTACT_TYPES = ["Owner", "Agent", "Partner", "Associate", "Maintenance"];
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

export function propertyMatchCandidateQueue(candidate: {
  aiVerdict?: unknown;
  aiReviewStatus?: unknown;
  reviewerStatus?: unknown;
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
  if (aiReviewStatus === "pending" || aiReviewStatus === "processing") return "processing";
  if (reviewerStatus === "pending" && aiVerdict === "no") return "not_match";
  if (reviewerStatus === "pending" && (aiVerdict === "yes" || aiVerdict === "maybe")) return "review";
  return "not_match";
}

export function summarizePropertyMatchCandidateQueues(rows: Array<{
  aiVerdict?: unknown;
  aiReviewStatus?: unknown;
  reviewerStatus?: unknown;
  evidence?: unknown;
  matchSummary?: unknown;
  reasoning?: unknown;
}>) {
  const counts = {
    allCount: rows.length,
    pendingAiCount: 0,
    reviewCount: 0,
    approvedCount: 0,
    sentCount: 0,
    skippedCount: 0,
    rejectedCount: 0,
    notMatchCount: 0,
    alreadySharedCount: 0,
  };

  for (const row of rows) {
    const queue = propertyMatchCandidateQueue(row);
    if (queue === "processing") counts.pendingAiCount += 1;
    else if (queue === "review") counts.reviewCount += 1;
    else if (queue === "approved") counts.approvedCount += 1;
    else if (queue === "sent") counts.sentCount += 1;
    else if (queue === "skipped") counts.skippedCount += 1;
    else if (queue === "rejected") counts.rejectedCount += 1;
    else if (queue === "not_match") counts.notMatchCount += 1;
    else if (queue === "already_shared") counts.alreadySharedCount += 1;
  }

  return counts;
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
  const requestedVerdict = normalizeVerdict(raw.verdict);
  const verdict = requestedVerdict === "yes" && confidence < LOW_CONFIDENCE_YES_THRESHOLD
    ? "maybe"
    : requestedVerdict;

  return {
    verdict,
    confidence,
    reasoning: normalizeText(raw.reasoning, 3000) || (
      verdict === "maybe" && requestedVerdict === "yes"
        ? "AI confidence was too low for a definite yes; kept for human review."
        : "AI reviewed the ambiguous requirements."
    ),
    matchSummary: normalizeText(raw.matchSummary, 1200) || "AI reviewed the lead against this property.",
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

function extractLocationFromSource(text: string): string | null {
  const match = text.match(/\b(?:location|area|city)\s*[:#-]\s*([^\n,;|]{2,80})/i);
  return normalizeText(match?.[1], 120);
}

export function propertySourceSnapshot(args: {
  url?: string | null;
  sourceText?: string | null;
  title?: string | null;
  description?: string | null;
  linkedProperty?: AnyRecord | null;
}) {
  const sourceText = normalizeText(args.sourceText, 12000);
  const combined = [
    args.title ? `Title: ${args.title}` : null,
    args.description ? `Description: ${args.description}` : null,
    sourceText,
    args.url ? `Source URL: ${args.url}` : null,
  ].filter(Boolean).join("\n");
  const linked = args.linkedProperty ? propertySnapshot(args.linkedProperty) : {};
  const reference = linked.reference || extractReferenceFromSource(combined);
  const title = normalizeText(args.title, 240)
    || linked.title
    || (reference ? `Property ${reference}` : "Website property campaign");

  return {
    ...linked,
    id: linked.id || null,
    title,
    reference,
    goal: linked.goal || extractGoalFromSource(combined),
    type: linked.type || extractTypeFromSource(combined),
    price: linked.price ?? extractPriceFromSource(combined),
    currency: linked.currency || "EUR",
    bedrooms: linked.bedrooms ?? extractBedroomsFromSource(combined),
    city: linked.city || null,
    propertyLocation: linked.propertyLocation || extractLocationFromSource(combined),
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
    city: property.city,
    propertyLocation: property.propertyLocation,
    propertyArea: property.propertyArea,
    condition: property.condition,
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
  };
}

function evidenceForStructuredMatch(result: ReturnType<typeof evaluateStructuredPropertyMatch>) {
  return {
    structured: {
      matches: result.matches,
      mismatches: result.mismatches,
      unknowns: result.unknowns,
      needsAi: result.needsAi,
    },
  };
}

export function isAiReviewTerminal(status: unknown) {
  return status === "done" || status === "failed";
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
}) {
  return candidate.reviewerStatus === "pending"
    && (candidate.aiVerdict === "yes" || candidate.aiVerdict === "maybe")
    && isAiReviewTerminal(candidate.aiReviewStatus);
}

export function canCandidateDraftOrSend(candidate: {
  aiVerdict?: unknown;
  aiReviewStatus?: unknown;
}) {
  return (candidate.aiVerdict === "yes" || candidate.aiVerdict === "maybe")
    && isAiReviewTerminal(candidate.aiReviewStatus);
}

export function buildPropertyMatchContactWhere(locationId: string, cursor?: string | null) {
  return {
    locationId,
    ...(cursor ? { id: { gt: cursor } } : {}),
    OR: [
      { contactType: "Tenant" },
      { leadGoal: { in: SEEKER_LEAD_GOALS } },
    ],
    NOT: [
      { contactType: { in: EXCLUDED_CONTACT_TYPES } },
      { leadGoal: { in: NON_SEEKER_LEAD_GOALS } },
      { matchingEmailMatchedProperties: { startsWith: "No" } },
    ],
    conversations: { some: { locationId, deletedAt: null } },
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

function formatRequirementFacts(contact: AnyRecord): string {
  const requirement = contactRequirementInput(contact);
  return [
    contact.name ? `Contact: ${contact.name}` : null,
    requirement.requirementStatus ? `Status: ${requirement.requirementStatus}` : null,
    requirement.requirementDistrict ? `District: ${requirement.requirementDistrict}` : null,
    requirement.requirementBedrooms ? `Bedrooms: ${requirement.requirementBedrooms}` : null,
    requirement.requirementMinPrice ? `Min price: ${requirement.requirementMinPrice}` : null,
    requirement.requirementMaxPrice ? `Max price: ${requirement.requirementMaxPrice}` : null,
    requirement.requirementCondition ? `Condition: ${requirement.requirementCondition}` : null,
    requirement.requirementPropertyTypes?.length ? `Types: ${requirement.requirementPropertyTypes.join(", ")}` : null,
    requirement.requirementPropertyLocations?.length ? `Locations: ${requirement.requirementPropertyLocations.join(", ")}` : null,
    requirement.requirementOtherDetails ? `Other details: ${requirement.requirementOtherDetails}` : null,
    requirement.requirementSummary ? `Requirement summary: ${requirement.requirementSummary}` : null,
  ].filter(Boolean).join("\n");
}

async function refreshCampaignCounts(campaignId: string) {
  const campaign = await db.propertyMatchCampaign.findUnique({
    where: { id: campaignId },
    select: { status: true, collectionStatus: true },
  });
  const rows = await db.propertyMatchCandidate.findMany({
    where: { campaignId },
    select: { aiVerdict: true, aiReviewStatus: true, reviewerStatus: true },
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
}) {
  const property = await db.property.findFirst({
    where: { id: args.propertyId, locationId: args.locationId },
  });
  if (!property) return { success: false as const, error: "Property not found." };

  const snapshot = propertySnapshot(property as any);
  const campaign = await db.propertyMatchCampaign.create({
    data: {
      locationId: args.locationId,
      propertyId: property.id,
      createdByUserId: args.actorUserId || null,
      title: `${property.title} match campaign`,
      status: "processing",
      priorityNote: normalizeText(args.priorityNote, 2000),
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
}) {
  const sourceText = [
    normalizeText(args.extractedText, 8000),
    normalizeText(args.propertyText, 8000),
  ].filter(Boolean).join("\n\n");
  const snapshotWithoutLink = propertySourceSnapshot({
    url: args.propertyUrl,
    sourceText,
    title: args.extractedTitle,
    description: args.extractedDescription,
  });
  const reference = normalizeText(snapshotWithoutLink.reference, 120);
  const linkedProperty = reference
    ? await db.property.findFirst({
      where: {
        locationId: args.locationId,
        reference: { equals: reference, mode: "insensitive" },
      },
    })
    : null;
  const snapshot = propertySourceSnapshot({
    url: args.propertyUrl,
    sourceText,
    title: args.extractedTitle,
    description: args.extractedDescription,
    linkedProperty: linkedProperty as any,
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
      propertySnapshot: snapshot,
      collectionStatus: "pending",
      processingStartedAt: new Date(),
    },
  });

  await refreshCampaignCounts(campaign.id);
  return { success: true as const, campaignId: campaign.id, linkedPropertyId: linkedProperty?.id || null };
}

async function collectPropertyMatchCandidatesBatch(args: {
  locationId: string;
  campaign: AnyRecord;
  limit?: number;
  workerId: string;
}) {
  if (args.campaign.collectionStatus === "done") {
    return { collected: 0, done: true };
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
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      contactType: true,
      leadGoal: true,
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
      conversations: {
        where: { locationId: args.locationId, deletedAt: null },
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: {
          id: true,
          lastMessageType: true,
        },
      },
    },
    orderBy: { id: "asc" },
    take: limit,
  });

  const propertySnapshotForCampaign = args.campaign.propertySnapshot || {};
  const propertyInput = propertyMatchInput(propertySnapshotForCampaign);
  const baseCandidateData = contacts.flatMap((contact: any) => {
    const conversation = contact.conversations[0];
    if (!conversation?.id) return [];
    const structured = evaluateStructuredPropertyMatch(propertyInput, contactRequirementInput(contact));
    const preferredChannel = deriveComposerInitialChannel(conversation as any);
    return [{
      locationId: args.locationId,
      campaignId: args.campaign.id,
      contactId: contact.id,
      conversationId: conversation.id,
      structuredVerdict: structured.verdict,
      aiVerdict: structured.verdict,
      aiReviewStatus: structured.needsAi ? "pending" : "done",
      reviewerStatus: "pending",
      score: structured.score,
      confidence: structured.needsAi ? 0.5 : structured.verdict === "yes" ? 0.9 : 0.85,
      evidence: evidenceForStructuredMatch(structured),
      reasoning: structured.mismatches.length
        ? structured.mismatches.join("; ")
        : structured.matches.join("; ") || "Needs requirement review.",
      matchSummary: structured.verdict === "yes"
        ? "Structured requirements match."
        : structured.verdict === "no"
          ? "Hard structured mismatch."
          : "Structured fit is incomplete or has unstructured requirements.",
      preferredChannel,
    }];
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

  const lastCursor = contacts[contacts.length - 1]?.id || args.campaign.collectionCursor || null;
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
    return { collected: candidateData.length, done: true, stopped: true };
  }

  return { collected: candidateData.length, done };
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
  actorUserId?: string | null;
}) {
  const apiKey = await resolveLocationGoogleAiApiKey(args.locationId);
  if (!apiKey) {
    return {
      verdict: "maybe" as MatchVerdict,
      confidence: 0.45,
      reasoning: "No AI API key configured; kept for human review.",
      evidence: {
        ...(args.candidate.evidence || {}),
        structured: {
          ...(args.candidate.evidence?.structured || {}),
          needsAi: false,
        },
      },
      matchSummary: "Needs manual review.",
      usage: null,
    };
  }

  const modelName = normalizeText(args.model, 120) || GEMINI_FLASH_STABLE_FALLBACK;
  const prompt = `You review whether a real-estate lead should receive a new listing.

Return JSON only:
{
  "verdict": "yes"|"maybe"|"no",
  "confidence": number,
  "matchSummary": string,
  "reasoning": string,
  "evidence": [{"field": string, "quote": string, "supports": "yes"|"maybe"|"no"}]
}

Rules:
- Use structured requirements as hard filters. Do not override a hard mismatch.
- Use unstructured requirements and summary to decide yes vs maybe.
- Choose yes only when sending is clearly reasonable.
- Choose maybe when there is a plausible fit but missing, stale, or ambiguous information.
- Choose no when the listing conflicts with current requirements.
- Never recommend sending to owners/agents/non-seeker contacts.`;

  const recentMessages = await db.message.findMany({
    where: { conversationId: args.candidate.conversationId || "" },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, direction: true, body: true, createdAt: true },
  });
  const messageText = recentMessages.reverse().map((message) => {
    const speaker = message.direction === "inbound" ? "Client" : "Agent";
    return `[${message.id}] ${speaker}: ${normalizeText(message.body, 500) || ""}`;
  }).join("\n");

  const userContent = `Property:
${formatPropertyFacts(args.campaign.propertySnapshot || {})}

Contact requirements:
${formatRequirementFacts(args.candidate.contact || {})}

Structured match:
${JSON.stringify(args.candidate.evidence?.structured || {}, null, 2)}

Recent messages:
${messageText || "No recent messages."}`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });
  const result = await model.generateContent([prompt, userContent]);
  const parsed = extractJsonObject(result.response.text());
  const normalized = normalizeAiMatchAssessment(parsed, args.candidate.evidence || {});
  const usage = (result.response.usageMetadata || {}) as any;
  const promptTokens = Number(usage.promptTokenCount || 0);
  const completionTokens = Number(usage.candidatesTokenCount || 0);
  const totalTokens = Number(usage.totalTokenCount || promptTokens + completionTokens);
  const estimatedCostUsd = calculateRunCost(modelName, promptTokens, completionTokens);

  await securelyRecordAiUsage({
    locationId: args.locationId,
    userId: args.actorUserId || null,
    resourceType: "contact",
    resourceId: args.candidate.contactId,
    featureArea: "property_match_campaigns",
    action: "score_candidate",
    provider: "google_gemini",
    model: modelName,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    metadata: {
      campaignId: args.campaign.id,
      candidateId: args.candidate.id,
      totalTokens,
      estimatedCostUsd,
      verdict: normalized.verdict,
    },
  });

  return normalized;
}

export async function processPropertyMatchCampaignBatch(args: {
  locationId: string;
  campaignId: string;
  actorUserId?: string | null;
  limit?: number;
}) {
  const campaign = await db.propertyMatchCampaign.findFirst({
    where: { id: args.campaignId, locationId: args.locationId },
  });
  if (!campaign) return { success: false as const, error: "Campaign not found." };
  if (!CAMPAIGN_STATUSES.has(campaign.status)) return { success: false as const, error: "Invalid campaign status." };

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

  const collection = await collectPropertyMatchCandidatesBatch({
    locationId: args.locationId,
    campaign: campaignForProcessing,
    workerId,
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

  const staleLockedBefore = new Date(Date.now() - AI_REVIEW_LOCK_TIMEOUT_MS);
  const claimable = await db.propertyMatchCandidate.findMany({
    where: buildAiReviewClaimWhere({
      campaignId: campaign.id,
      locationId: args.locationId,
      staleLockedBefore,
    }),
    orderBy: { createdAt: "asc" },
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
      orderBy: { createdAt: "asc" },
    })
    : [];

  let processed = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (await isPropertyMatchCampaignStopRequested({
      locationId: args.locationId,
      campaignId: args.campaignId,
    })) {
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
    try {
      const ai = await scoreCandidateWithAi({
        locationId: args.locationId,
        campaign: refreshedCampaign,
        candidate,
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
          aiReviewLockedAt: null,
          aiReviewLockedBy: null,
          lastError: null,
        },
      });
      if (updatedCandidate.count === 0) {
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
          stopped: stopped.status === CAMPAIGN_STOPPED_STATUS,
          status: stopped.status,
        };
      }
      processed += 1;
    } catch (error: any) {
      failed += 1;
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
          aiReviewLockedAt: null,
          aiReviewLockedBy: null,
          lastError: error?.message || "AI review failed.",
        },
      });
    }
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

export async function listPropertyMatchCampaigns(args: {
  locationId: string;
  limit?: number;
}) {
  const campaigns = await db.propertyMatchCampaign.findMany({
    where: { locationId: args.locationId },
    include: {
      property: { select: { id: true, title: true, reference: true, price: true, city: true, propertyLocation: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(50, Number(args.limit || 20))),
  });
  return withPropertyMatchQueueCounts(args.locationId, campaigns as any[]);
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
      evidence: true,
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
          requirementStatus: true,
          requirementBedrooms: true,
          requirementMaxPrice: true,
          requirementPropertyTypes: true,
          requirementPropertyLocations: true,
          requirementSummary: true,
        },
      },
      conversation: { select: { id: true, ghlConversationId: true } },
    },
    orderBy: [
      { aiVerdict: "asc" },
      { confidence: "desc" },
      { createdAt: "asc" },
    ],
    take: 100,
  });

  const [campaignWithCounts] = await withPropertyMatchQueueCounts(args.locationId, [campaign as any]);
  return { campaign: campaignWithCounts || campaign, candidates };
}

function propertyMatchCandidateWhereForQueue(queue: PropertyMatchCampaignQueue) {
  if (queue === "all") return {};
  if (queue === "review") return { reviewerStatus: "pending", aiVerdict: { in: ["yes", "maybe"] }, aiReviewStatus: { in: ["done", "failed"] } };
  if (queue === "approved") return { reviewerStatus: "approved" };
  if (queue === "sent") return { reviewerStatus: "sent" };
  if (queue === "skipped") return { reviewerStatus: "skipped" };
  if (queue === "rejected") return { reviewerStatus: "rejected" };
  if (queue === "already_shared") {
    return {
      OR: [
        { matchSummary: { contains: "Already shared", mode: "insensitive" } },
        { reasoning: { contains: "already been shared", mode: "insensitive" } },
      ],
    };
  }
  return {
    reviewerStatus: "pending",
    aiVerdict: "no",
    NOT: {
      OR: [
        { matchSummary: { contains: "Already shared", mode: "insensitive" } },
        { reasoning: { contains: "already been shared", mode: "insensitive" } },
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
}) {
  const reviewerStatus = String(args.reviewerStatus || "").trim();
  if (!REVIEWER_STATUSES.has(reviewerStatus)) {
    return { success: false as const, error: "Invalid review status." };
  }
  const candidate = await db.propertyMatchCandidate.findFirst({
    where: { id: args.candidateId, locationId: args.locationId },
    select: { id: true, campaignId: true, reviewerStatus: true, aiVerdict: true, aiReviewStatus: true },
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
  await refreshCampaignCounts(candidate.campaignId);
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
    select: { id: true, aiVerdict: true, aiReviewStatus: true },
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

export async function markPropertyMatchCandidateSent(args: {
  locationId: string;
  candidateId: string;
}) {
  const candidate = await db.propertyMatchCandidate.findFirst({
    where: { id: args.candidateId, locationId: args.locationId },
    select: { id: true, campaignId: true },
  });
  if (!candidate) return { success: false as const, error: "Candidate not found." };
  await db.propertyMatchCandidate.update({
    where: { id: candidate.id },
    data: {
      reviewerStatus: "sent",
      sentAt: new Date(),
      lastError: null,
    },
  });
  await refreshCampaignCounts(candidate.campaignId);
  return { success: true as const };
}
