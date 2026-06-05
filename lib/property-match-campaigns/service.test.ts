import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAiMatchAssessment } from "./service";

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
