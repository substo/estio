import test from "node:test";
import assert from "node:assert/strict";
import {
  attachPropertyMatchAiRunEvidence,
  applyInteractionSimilarityToStructuredMatch,
  buildPropertyMatchDecisionContext,
  buildAiReviewClaimWhere,
  buildPriorPropertyShareSearchTerms,
  buildPropertyMatchContactWhere,
  canCandidateDraftOrSend,
  canCandidateEnterHumanReview,
  findPriorPropertyShareEvidence,
  isPropertyMatchCampaignStopped,
  normalizeAiMatchAssessment,
  propertyMatchCandidateQueue,
  propertyMatchCampaignStatusAfterCounts,
  propertySourceSnapshot,
  summarizePropertyMatchCandidateQueues,
  sortPropertyMatchSearchRows,
} from "./service";
import { buildPropertyMatchProfileBackfillWhere } from "./profile-service";

const SOURCE_TEST_MARKET = {
  locationId: "source-test",
  locationName: "Test office",
  countryCode: "CY",
  countryName: "Cyprus",
  locale: "en-CY",
  currencyCode: "EUR",
  supportedLanguages: ["en"],
  source: { configured: true, inventoryFallback: false },
  serviceAreas: [
    { id: "paphos", label: "Paphos", aliases: [], parentId: null, kind: "district" as const },
    { id: "peyia", label: "Peyia", aliases: ["Peia"], parentId: "paphos", kind: "locality" as const },
    { id: "kato-paphos", label: "Kato Paphos", aliases: [], parentId: "paphos", kind: "locality" as const },
  ],
};

test("AI match normalizer conservatively rejects low-confidence recommendations", () => {
  const result = normalizeAiMatchAssessment({
    verdict: "yes",
    confidence: 0.42,
    matchSummary: "Looks possible",
    reasoning: "Weak signal only",
    evidence: [{ field: "summary", quote: "maybe", supports: "yes" }],
  }, {
    structured: {
      needsAi: true,
      matches: ["location matches"],
    },
  });

  assert.equal(result.verdict, "no");
  assert.equal(result.confidence, 0.42);
  assert.equal(result.evidence.structured.needsAi, false);
});

test("AI match normalizer preserves high-confidence yes", () => {
  const result = normalizeAiMatchAssessment({
    verdict: "yes",
    confidence: 0.86,
    matchSummary: "Good fit",
    reasoning: "Requirements line up",
  });

  assert.equal(result.verdict, "yes");
  assert.equal(result.confidence, 0.86);
});

test("AI run evidence preserves candidate evidence and records requested and used model", () => {
  const evidence = attachPropertyMatchAiRunEvidence({
    structured: { verdict: "yes" },
    warnings: ["Requirement is sparse."],
  }, {
    modelRequested: "gemini-2.5-pro",
    modelUsed: "gemini-2.5-pro-20260601",
    provider: "google",
    scoredAt: "2026-07-09T10:00:00.000Z",
  });

  assert.deepEqual(evidence.structured, { verdict: "yes" });
  assert.deepEqual(evidence.warnings, ["Requirement is sparse."]);
  assert.deepEqual(evidence.aiRun, {
    modelRequested: "gemini-2.5-pro",
    modelUsed: "gemini-2.5-pro-20260601",
    provider: "google",
    scoredAt: "2026-07-09T10:00:00.000Z",
  });
});

test("AI match normalizer rejects yes when evidence lacks concrete anchors", () => {
  const result = normalizeAiMatchAssessment({
    verdict: "yes",
    confidence: 0.9,
    matchSummary: "Broad requirements fit everything",
    reasoning: "No mismatches.",
  }, {
    structured: {
      verdict: "maybe",
      needsAi: true,
      qualificationEvidence: {
        anchorCount: 1,
        anchors: ["sale/rent intent matches"],
        sparseLead: true,
        broadOnly: true,
        minimumAnchorsForYes: 2,
        reason: "Only broad or missing requirements are available.",
      },
    },
  });

  assert.equal(result.verdict, "no");
  assert.match(result.reasoning, /lacks enough concrete positive evidence/i);
  assert.equal(result.evidence.structured.needsAi, false);
});

test("AI judgment can override heuristic mismatches when contact evidence supports it", () => {
  const result = normalizeAiMatchAssessment({
    verdict: "yes",
    confidence: 0.95,
    reasoning: "Looks good",
  }, {
    structured: {
      verdict: "no",
      hardMismatches: ["recent lead intent points to a different district/city"],
      needsAi: true,
    },
  });

  assert.equal(result.verdict, "yes");
  assert.equal(result.evidence.structured.needsAi, false);
});

test("AI match normalizer can override stale structured requirement blockers", () => {
  const result = normalizeAiMatchAssessment({
    verdict: "yes",
    confidence: 0.9,
    reasoning: "Recent conversation confirms this is now a fit.",
  }, {
    warnings: ["Requirement fields are stale or have never been assessed; campaign AI must verify against conversation context."],
    structured: {
      verdict: "no",
      hardMismatches: ["stored location does not match"],
      needsAi: true,
    },
  });

  assert.equal(result.verdict, "yes");
  assert.equal(result.evidence.structured.needsAi, false);
});

test("AI match normalizer cannot override inferred non-lead disqualifiers", () => {
  const result = normalizeAiMatchAssessment({
    verdict: "yes",
    confidence: 0.95,
    reasoning: "Looks like a fit",
  }, {
    structured: {
      verdict: "no",
      disqualifiers: ["contact appears to be Agent, not a buyer or renter lead"],
      dimensions: [{
        key: "lead_eligibility",
        label: "Lead Eligibility",
        status: "no",
      }],
      needsAi: true,
    },
  });

  assert.equal(result.verdict, "no");
  assert.equal(result.evidence.structured.needsAi, false);
});

test("AI match normalizer clamps invalid confidence and invalid verdict", () => {
  const result = normalizeAiMatchAssessment({
    verdict: "definitely",
    confidence: 12,
  });

  assert.equal(result.verdict, "maybe");
  assert.equal(result.confidence, 1);
});

test("AI match normalizer accepts the simplified recommend boolean", () => {
  const result = normalizeAiMatchAssessment({
    recommend: true,
    confidence: 0.9,
    summary: "Location and budget fit.",
  });

  assert.equal(result.verdict, "yes");
  assert.equal(result.matchSummary, "Location and budget fit.");
});

test("decision context presents requirements, interests, sent history, and property as two summaries", () => {
  const context = buildPropertyMatchDecisionContext({
    propertySnapshot: {
      reference: "DT4001",
      type: "Villa",
      price: 420000,
      bedrooms: 3,
      propertyLocation: "Peyia",
    },
    campaignProfile: {
      requirementSummary: "Villa in Peyia, 3 bedrooms, up to EUR 450,000.",
      interactions: {
        sentPropertyReferences: ["DT3990"],
        positiveExamples: [{
          property: { reference: "DT3980", type: "Villa", bedrooms: 3, propertyLocation: "Peyia" },
        }],
        negativeExamples: [],
      },
    },
    recentMessages: [
      { direction: "outbound", body: "How about this one?" },
      { direction: "inbound", body: "Peyia is still my preferred area." },
    ],
  });

  assert.match(context.contactSummary, /Current requirements: Villa in Peyia/i);
  assert.match(context.contactSummary, /Interested\/positive history: DT3980/i);
  assert.match(context.contactSummary, /Previously sent: DT3990/i);
  assert.match(context.contactSummary, /Peyia is still my preferred area/i);
  assert.doesNotMatch(context.contactSummary, /How about this one/);
  assert.match(context.propertySummary, /DT4001/);
});

test("pending AI candidates cannot enter review or draft flow", () => {
  const candidate = {
    reviewerStatus: "pending",
    aiVerdict: "maybe",
    aiReviewStatus: "pending",
  };

  assert.equal(canCandidateEnterHumanReview(candidate), false);
  assert.equal(canCandidateDraftOrSend(candidate), false);
});

test("stopped property match campaigns preserve canceled status during count refresh decisions", () => {
  assert.equal(isPropertyMatchCampaignStopped({ status: "canceled", collectionStatus: "pending" }), true);
  assert.equal(isPropertyMatchCampaignStopped({ status: "processing", collectionStatus: "canceled" }), true);
  assert.equal(isPropertyMatchCampaignStopped({ status: "processing", collectionStatus: "pending" }), false);

  const stoppedByStatus = propertyMatchCampaignStatusAfterCounts({
    currentStatus: "canceled",
    collectionStatus: "done",
    pendingAiCount: 0,
  });
  assert.equal(stoppedByStatus.status, "canceled");
  assert.equal(stoppedByStatus.processingFinishedAt, null);

  const stoppedByCollection = propertyMatchCampaignStatusAfterCounts({
    currentStatus: "processing",
    collectionStatus: "canceled",
    pendingAiCount: 3,
  });
  assert.equal(stoppedByCollection.status, "canceled");
  assert.equal(stoppedByCollection.processingFinishedAt, null);
});

test("property match campaign count decisions still move active campaigns forward", () => {
  const reviewReady = propertyMatchCampaignStatusAfterCounts({
    currentStatus: "processing",
    collectionStatus: "done",
    pendingAiCount: 0,
  });
  assert.equal(reviewReady.status, "review");
  assert.ok(reviewReady.processingFinishedAt instanceof Date);

  const stillProcessing = propertyMatchCampaignStatusAfterCounts({
    currentStatus: "processing",
    collectionStatus: "pending",
    pendingAiCount: 0,
  });
  assert.equal(stillProcessing.status, "processing");
  assert.equal(stillProcessing.processingFinishedAt, null);
});

test("only successfully completed AI candidates can enter human review", () => {
  assert.equal(canCandidateEnterHumanReview({
    reviewerStatus: "pending",
    aiVerdict: "yes",
    aiReviewStatus: "done",
    contact: { profileVerificationStatus: "verified_lead" },
  }), true);
  assert.equal(canCandidateEnterHumanReview({
    reviewerStatus: "pending",
    aiVerdict: "maybe",
    aiReviewStatus: "failed",
    contact: { profileVerificationStatus: "verified_lead" },
  }), false);
  assert.equal(canCandidateEnterHumanReview({
    reviewerStatus: "pending",
    aiVerdict: "no",
    aiReviewStatus: "done",
    contact: { profileVerificationStatus: "verified_lead" },
  }), false);
});

test("lead-like candidates can use a completed property decision without a separate verification gate", () => {
  const candidate = {
    reviewerStatus: "pending",
    aiVerdict: "yes",
    aiReviewStatus: "done",
    contact: { profileVerificationStatus: null },
  };

  assert.equal(canCandidateEnterHumanReview(candidate), true);
  assert.equal(canCandidateDraftOrSend(candidate), true);
});

test("property match contact filter removes only known ineligible identities", () => {
  const cursor = JSON.stringify({ createdAt: "2026-07-09T12:00:00.000Z", id: "contact_10" });
  const where = buildPropertyMatchContactWhere("loc_1", cursor) as any;

  assert.deepEqual(where.contactType, {
    notIn: ["Owner", "Agent", "Partner", "Associate", "Maintenance", "WhatsAppGroup"],
  });
  assert.deepEqual(where.NOT, [
    { matchingEmailMatchedProperties: { startsWith: "No" } },
  ]);
  assert.deepEqual(where.AND, [
    {
      OR: [
        { profileVerificationStatus: null },
        { profileVerificationStatus: { notIn: ["likely_owner", "likely_agent", "not_a_lead"] } },
      ],
    },
  ]);
  assert.deepEqual(where.conversations, { some: { locationId: "loc_1", deletedAt: null } });
  assert.deepEqual(where.OR, [
    { createdAt: { lt: new Date("2026-07-09T12:00:00.000Z") } },
    { createdAt: new Date("2026-07-09T12:00:00.000Z"), id: { lt: "contact_10" } },
  ]);
});

test("property match profile backfill selects only missing or old profile versions", () => {
  const staleBuiltBefore = new Date("2026-07-18T10:00:00.000Z");
  assert.deepEqual(buildPropertyMatchProfileBackfillWhere("loc_1", staleBuiltBefore), {
    locationId: "loc_1",
    OR: [
      { propertyMatchProfile: { is: null } },
      { propertyMatchProfile: { is: { schemaVersion: { lt: 2 } } } },
      { propertyMatchProfile: { is: { lastBuiltAt: { lt: staleBuiltBefore } } } },
    ],
  });
});

test("positive interaction similarity enriches evidence without automatically forcing yes", () => {
  const result = applyInteractionSimilarityToStructuredMatch({
    verdict: "maybe",
    score: 2,
    needsAi: true,
    matches: ["property type matches"],
    mismatches: [],
    unknowns: ["budget is unclear"],
    dimensions: [],
    hardMismatches: [],
    disqualifiers: [],
    qualificationEvidence: {
      anchorCount: 1,
      anchors: ["property type matches"],
      concreteFitAnchorCount: 1,
      concreteFitAnchors: ["property type matches"],
      groundingFitAnchorCount: 0,
      groundingFitAnchors: [],
      sparseLead: true,
      broadOnly: false,
      minimumAnchorsForYes: 2,
      minimumConcreteFitAnchorsForYes: 2,
      reason: "Not enough evidence.",
    },
  }, {
    positiveMatches: [{
      reference: "DT5000",
      eventType: "liked",
      reason: "interested",
      occurredAt: "2026-07-18T10:00:00.000Z",
      similarity: 0.9,
      matchedFields: ["location", "price", "type"],
      differingFields: [],
    }],
    negativeCautions: [],
    hasPositiveGrounding: true,
    requiresReview: false,
    summary: "Similar to one positively received property.",
  });

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
  assert.equal(result.qualificationEvidence?.sparseLead, false);
  assert.ok(result.matches.some((match) => match.includes("DT5000")));
  assert.equal(result.score, 4);
});

test("negative property similarity downgrades an automatic yes to review", () => {
  const result = applyInteractionSimilarityToStructuredMatch({
    verdict: "yes",
    score: 7,
    needsAi: false,
    matches: ["location matches", "budget matches"],
    mismatches: [],
    unknowns: [],
    dimensions: [],
    hardMismatches: [],
    disqualifiers: [],
  }, {
    positiveMatches: [],
    negativeCautions: [{
      reference: "DT4999",
      eventType: "rejected",
      reason: "price_rejection",
      occurredAt: "2026-07-17T10:00:00.000Z",
      similarity: 0.85,
      matchedFields: ["location", "price", "type"],
      differingFields: [],
    }],
    hasPositiveGrounding: false,
    requiresReview: true,
    summary: "Similar to one rejected property.",
  });

  assert.equal(result.verdict, "maybe");
  assert.equal(result.needsAi, true);
  assert.ok(result.unknowns.some((unknown) => unknown.includes("DT4999")));
});

test("AI review claim filter reclaims stale processing locks", () => {
  const staleLockedBefore = new Date("2026-06-05T12:00:00.000Z");
  const where = buildAiReviewClaimWhere({
    campaignId: "camp_1",
    locationId: "loc_1",
    staleLockedBefore,
    ids: ["cand_1", "cand_2"],
  }) as any;

  assert.deepEqual(where.id, { in: ["cand_1", "cand_2"] });
  assert.equal(where.reviewerStatus, "pending");
  assert.equal(where.contact, undefined);
  assert.deepEqual(where.OR, [
    { aiReviewStatus: "pending" },
    {
      aiReviewStatus: "processing",
      aiReviewLockedAt: { lt: staleLockedBefore },
    },
  ]);
});

test("property match queue classifier separates campaign work outcomes", () => {
  const rows = [
    { reviewerStatus: "pending", aiVerdict: "yes", aiReviewStatus: "done", contact: { profileVerificationStatus: "verified_lead" } },
    { reviewerStatus: "approved", aiVerdict: "yes", aiReviewStatus: "done" },
    { reviewerStatus: "sent", aiVerdict: "yes", aiReviewStatus: "done" },
    { reviewerStatus: "skipped", aiVerdict: "maybe", aiReviewStatus: "done" },
    { reviewerStatus: "rejected", aiVerdict: "maybe", aiReviewStatus: "done" },
    { reviewerStatus: "pending", aiVerdict: "no", aiReviewStatus: "done" },
    { reviewerStatus: "pending", aiVerdict: "no", aiReviewStatus: "done", evidence: { priorShare: { alreadyShared: true } } },
    { reviewerStatus: "pending", aiVerdict: "maybe", aiReviewStatus: "processing" },
  ];

  assert.equal(propertyMatchCandidateQueue(rows[0]), "review");
  assert.equal(propertyMatchCandidateQueue(rows[6]), "already_shared");
  assert.equal(propertyMatchCandidateQueue(rows[7]), "processing");
  assert.deepEqual(summarizePropertyMatchCandidateQueues(rows), {
    allCount: 8,
    pendingAiCount: 1,
    queuedAiCount: 0,
    processingAiCount: 1,
    reviewCount: 1,
    approvedCount: 1,
    sentCount: 1,
    skippedCount: 1,
    rejectedCount: 1,
    needsProfileVerificationCount: 0,
    notMatchCount: 1,
    alreadySharedCount: 1,
  });
});

test("property match queue sends completed lead-like recommendations to review", () => {
  const candidate = {
    reviewerStatus: "pending",
    aiVerdict: "yes",
    aiReviewStatus: "done",
    contact: { profileVerificationStatus: null },
  };

  assert.equal(propertyMatchCandidateQueue(candidate), "review");
});

test("failed AI reviews do not enter the human recommendation queue", () => {
  assert.equal(propertyMatchCandidateQueue({
    reviewerStatus: "pending",
    aiVerdict: "maybe",
    aiReviewStatus: "failed",
    contact: { profileVerificationStatus: "verified_lead" },
  }), "not_match");
});

test("property match queue separates profile verification blockers from not matches", () => {
  const candidate = {
    reviewerStatus: "pending",
    aiVerdict: "no",
    aiReviewStatus: "done",
    matchSummary: "Needs profile verification before campaign matching.",
    reasoning: "Contact profile is not globally verified as a buyer/renter lead; skipped campaign AI review.",
  };

  assert.equal(propertyMatchCandidateQueue(candidate), "needs_profile_verification");
});

test("property campaign search ranks exact references before noisy title matches", () => {
  const rows = sortPropertyMatchSearchRows("DT4930", [
    { id: "title", title: "Other DT4930 style apartment", reference: "XX1000", updatedAt: "2026-06-05T12:00:00Z" },
    { id: "exact", title: "Studio in Peia", reference: "DT4930", updatedAt: "2026-01-01T12:00:00Z" },
    { id: "partial", title: "Another property", reference: "DT4930A", updatedAt: "2026-06-05T12:00:00Z" },
  ] as any[]);

  assert.deepEqual(rows.map((row: any) => row.id), ["exact", "partial", "title"]);
});

test("property source snapshot extracts usable facts from URL and pasted text", () => {
  const snapshot = propertySourceSnapshot({
    url: "https://agency.example/properties/dt4930",
    title: "Studio apartment in Peia",
    sourceText: "Ref. DT4930\nFor sale\nStudio apartment\nLocation: Peia\nPrice: €125,000",
  });

  assert.equal(snapshot.reference, "DT4930");
  assert.equal(snapshot.goal, "Sale");
  assert.equal(snapshot.type, "Studio");
  assert.equal(snapshot.bedrooms, 0);
  assert.equal(snapshot.price, 125000);
  assert.equal(snapshot.propertyLocation, "Peia");
  assert.equal(snapshot.sourceUrl, "https://agency.example/properties/dt4930");
});

test("property source snapshot extracts known Cyprus location from title text", () => {
  const snapshot = propertySourceSnapshot({
    url: "https://agency.example/properties/dt5098",
    title: "Peyia, Paphos Traditional House For Sale | DT5098",
    sourceText: "Available for sale is a two-storey, three-bedroom house with a swimming pool.",
    marketContext: SOURCE_TEST_MARKET,
  });

  assert.equal(snapshot.reference, "DT5098");
  assert.equal(snapshot.propertyLocation, "Peyia");
});

test("property source snapshot ignores similar listings and covered-area labels", () => {
  const snapshot = propertySourceSnapshot({
    url: "https://agency.example/properties/dt5115",
    title: "Kato Paphos, Paphos Apartment For Sale | DT5115",
    description: "Apartment in a gated community close to amenities.",
    sourceText: `€200,000
For Sale
Kato Paphos
Paphos
Apartment
Resale
2 Bedrooms
1 Bathrooms
87m² Covered
Covered living area: 73m²
Swimming Pool

SIMILAR NEARBY

Studio
Paphos, Kato Paphos
€195,000
32m² Covered`,
    marketContext: SOURCE_TEST_MARKET,
  });

  assert.equal(snapshot.reference, "DT5115");
  assert.equal(snapshot.goal, "Sale");
  assert.equal(snapshot.type, "Apartment");
  assert.equal(snapshot.bedrooms, 2);
  assert.equal(snapshot.propertyLocation, "Kato Paphos");
  assert.equal(snapshot.price, 200000);
});

test("prior property share terms include exact reference and URL variants", () => {
  const terms = buildPriorPropertyShareSearchTerms({
    reference: "DT4930",
    sourceUrl: "https://agency.example/properties/dt4930/",
  });

  assert.deepEqual(terms.referenceTerms, ["DT4930"]);
  assert.deepEqual(terms.urlTerms, [
    "https://agency.example/properties/dt4930",
    "agency.example/properties/dt4930",
  ]);
});

test("prior property share evidence detects reference or URL in previous messages", () => {
  const byReference = findPriorPropertyShareEvidence({
    snapshot: { reference: "DT4930", sourceUrl: "https://agency.example/properties/dt4930" },
    messages: [
      { id: "m1", body: "Sent DT4930 yesterday, let me know.", direction: "outbound", createdAt: "2026-06-05T10:00:00.000Z" },
    ],
  });
  assert.equal(byReference?.alreadyShared, true);
  assert.deepEqual(byReference?.matchedBy, ["reference"]);

  const byUrl = findPriorPropertyShareEvidence({
    snapshot: { reference: "DT4930", sourceUrl: "https://agency.example/properties/dt4930" },
    messages: [
      { id: "m2", body: "Here is the listing: agency.example/properties/dt4930", direction: "outbound", createdAt: "2026-06-05T10:00:00.000Z" },
    ],
  });
  assert.equal(byUrl?.alreadyShared, true);
  assert.deepEqual(byUrl?.matchedBy, ["url", "reference"]);
});

test("prior property share evidence avoids partial reference matches", () => {
  const evidence = findPriorPropertyShareEvidence({
    snapshot: { reference: "DT4930" },
    messages: [
      { id: "m1", body: "DT4930A is a different reference.", direction: "outbound" },
    ],
  });

  assert.equal(evidence, null);
});
