import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAiPropertyFeedback } from "./feedback-ai";

test("AI feedback normalizer maps high-confidence international classifications", () => {
  assert.deepEqual(normalizeAiPropertyFeedback({ reason: "price_rejection", confidence: 0.96 }), {
    status: "classified",
    confidence: 0.96,
    feedback: { eventType: "rejected", sentiment: "negative", reason: "price_rejection" },
  });
  assert.deepEqual(normalizeAiPropertyFeedback({ reason: "viewing_request", confidence: 0.93 }), {
    status: "classified",
    confidence: 0.93,
    feedback: { eventType: "viewing_requested", sentiment: "positive", reason: "viewing_request" },
  });
});

test("AI feedback normalizer rejects ambiguity and low confidence", () => {
  assert.equal(normalizeAiPropertyFeedback({ reason: "liked", confidence: 0.7 }).feedback, null);
  assert.equal(normalizeAiPropertyFeedback({ reason: "none", confidence: 0.99 }).feedback, null);
  assert.equal(normalizeAiPropertyFeedback({ reason: "invented", confidence: 0.99 }).feedback, null);
});
