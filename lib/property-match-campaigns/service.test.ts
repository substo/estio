import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAiReviewClaimWhere,
  buildPropertyMatchContactWhere,
  canCandidateDraftOrSend,
  canCandidateEnterHumanReview,
  normalizeAiMatchAssessment,
  propertySourceSnapshot,
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

test("completed or failed AI candidates can enter human review when verdict is sendable", () => {
  assert.equal(canCandidateEnterHumanReview({
    reviewerStatus: "pending",
    aiVerdict: "yes",
    aiReviewStatus: "done",
  }), true);
  assert.equal(canCandidateEnterHumanReview({
    reviewerStatus: "pending",
    aiVerdict: "maybe",
    aiReviewStatus: "failed",
  }), true);
  assert.equal(canCandidateEnterHumanReview({
    reviewerStatus: "pending",
    aiVerdict: "no",
    aiReviewStatus: "done",
  }), false);
});

test("property match contact filter only admits seeker-style contacts", () => {
  const where = buildPropertyMatchContactWhere("loc_1", "contact_10") as any;

  assert.deepEqual(where.OR, [
    { contactType: "Tenant" },
    { leadGoal: { in: ["To Buy", "To Rent"] } },
  ]);
  assert.deepEqual(where.NOT, [
    { contactType: { in: ["Owner", "Agent", "Partner", "Associate", "Maintenance"] } },
    { leadGoal: { in: ["To List", "To Sell", "Other"] } },
    { matchingEmailMatchedProperties: { startsWith: "No" } },
  ]);
  assert.deepEqual(where.id, { gt: "contact_10" });
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
  assert.deepEqual(where.OR, [
    { aiReviewStatus: "pending" },
    {
      aiReviewStatus: "processing",
      aiReviewLockedAt: { lt: staleLockedBefore },
    },
  ]);
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
