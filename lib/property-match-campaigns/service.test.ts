import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("AI match normalizer downgrades low-confidence yes to maybe", () => {
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

  assert.equal(result.verdict, "maybe");
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

test("AI match normalizer downgrades yes when structured evidence lacks concrete anchors", () => {
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

  assert.equal(result.verdict, "maybe");
  assert.match(result.reasoning, /lacks enough concrete positive evidence/i);
  assert.equal(result.evidence.structured.needsAi, false);
});

test("AI match normalizer cannot override structured blockers", () => {
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

  assert.equal(result.verdict, "no");
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

test("completed or failed AI candidates can enter human review when verdict is sendable", () => {
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
  }), true);
  assert.equal(canCandidateEnterHumanReview({
    reviewerStatus: "pending",
    aiVerdict: "no",
    aiReviewStatus: "done",
    contact: { profileVerificationStatus: "verified_lead" },
  }), false);
});

test("unverified legacy candidates cannot enter review or draft flow", () => {
  const candidate = {
    reviewerStatus: "pending",
    aiVerdict: "yes",
    aiReviewStatus: "done",
    contact: { profileVerificationStatus: null },
  };

  assert.equal(canCandidateEnterHumanReview(candidate), false);
  assert.equal(canCandidateDraftOrSend(candidate), false);
});

test("property match contact filter leaves identity to profile verification", () => {
  const where = buildPropertyMatchContactWhere("loc_1", "contact_10") as any;

  assert.deepEqual(where.NOT, [
    { matchingEmailMatchedProperties: { startsWith: "No" } },
  ]);
  assert.deepEqual(where.conversations, { some: { locationId: "loc_1", deletedAt: null } });
  assert.deepEqual(where.id, { gt: "contact_10" });
  assert.equal("OR" in where, false);
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
  assert.deepEqual(where.contact, { profileVerificationStatus: "verified_lead" });
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
    reviewCount: 1,
    approvedCount: 1,
    sentCount: 1,
    skippedCount: 1,
    rejectedCount: 1,
    notMatchCount: 1,
    alreadySharedCount: 1,
  });
});

test("property match queue blocks unverified legacy yes candidates from review", () => {
  const candidate = {
    reviewerStatus: "pending",
    aiVerdict: "yes",
    aiReviewStatus: "done",
    contact: { profileVerificationStatus: null },
  };

  assert.equal(propertyMatchCandidateQueue(candidate), "not_match");
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
