import assert from "node:assert/strict";
import test from "node:test";
import { availableKnowledgeReviewActions, knowledgeListQuery, knowledgePage, knowledgeStatus, knowledgeTopic, maySubmitKnowledgeReview, readKnowledgeReviewDraft } from "./knowledge-policy";

const location = "10000000-0000-4000-8000-000000000001";
const topic = "20000000-0000-4000-8000-000000000002";

test("knowledge filters reject repeated and malformed query values", () => {
  assert.equal(knowledgeStatus(["pending", "all"]), "pending");
  assert.equal(knowledgeStatus("approved"), "approved");
  assert.equal(knowledgeTopic([topic, topic]), null);
  assert.equal(knowledgeTopic(topic.toUpperCase()), topic);
  assert.equal(knowledgePage(["2", "3"]), 0);
  assert.equal(knowledgePage("-1"), 0);
  assert.equal(knowledgePage("2"), 2);
});

test("knowledge list query always includes the Location and a bounded page", () => {
  const query = knowledgeListQuery(location, "pending", topic, 2);
  assert.deepEqual(query.values, [location, "pending", topic, 100]);
  assert.match(query.text, /where location_id = \$1 and status = \$2 and topic_id = \$3::uuid\s+order by id asc limit 51 offset \$4$/);
  assert.deepEqual(knowledgeListQuery(location, "all", null, 0).values, [location, 0]);
});

test("review policy blocks missing Location access and impersonation", () => {
  assert.equal(maySubmitKnowledgeReview({ hasLocationAccess: false, isImpersonating: false }), false);
  assert.equal(maySubmitKnowledgeReview({ hasLocationAccess: true, isImpersonating: true }), false);
  assert.equal(maySubmitKnowledgeReview({ hasLocationAccess: true, isImpersonating: false }), true);
  assert.deepEqual(availableKnowledgeReviewActions("pending"), ["approve", "reject"]);
  assert.deepEqual(availableKnowledgeReviewActions("approved"), ["reopen"]);
  assert.deepEqual(availableKnowledgeReviewActions("rejected"), ["reopen"]);
});

test("review draft validates the action and keeps the exact optional note", () => {
  const form = new FormData();
  form.set("action", "approve");
  form.set("reason", "  Keep this wording.  \n");
  assert.deepEqual(readKnowledgeReviewDraft(form), { action: "approve", reason: "  Keep this wording.  \n" });
  form.set("reason", "x".repeat(2001));
  assert.throws(() => readKnowledgeReviewDraft(form), /2,000/);
  form.set("reason", "");
  form.set("action", "delete");
  assert.throws(() => readKnowledgeReviewDraft(form), /Choose/);
});
