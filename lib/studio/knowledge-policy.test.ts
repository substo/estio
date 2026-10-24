import assert from "node:assert/strict";
import test from "node:test";
import { availableKnowledgeReviewActions, knowledgeDetailPageQuery, knowledgeListQuery, knowledgePage, knowledgeReviewPageQuery, knowledgeStatus, knowledgeTopic, maySubmitKnowledgeReview, readKnowledgeReviewDraft } from "./knowledge-policy";

const workspace = "10000000-0000-4000-8000-000000000001";
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

test("knowledge list and detail queries always include workspace and bounded pages", () => {
  assert.deepEqual(knowledgeListQuery(workspace, "pending", topic, 2), {
    select: "id,source_id,topic_id,status,statement,kind:payload->>kind,suggested_topic:payload->>suggested_topic",
    workspace_id: `eq.${workspace}`, status: "eq.pending", topic_id: `eq.${topic}`, order: "id.asc", limit: "51", offset: "100",
  });
  assert.deepEqual(knowledgeDetailPageQuery(workspace, "insight_id", topic, 1, "id,payload"), {
    select: "id,payload", workspace_id: `eq.${workspace}`, insight_id: `eq.${topic}`, order: "id.asc", limit: "51", offset: "50",
  });
  assert.deepEqual(knowledgeReviewPageQuery(workspace, topic, 1), {
    select: "id,payload", workspace_id: `eq.${workspace}`, insight_id: `eq.${topic}`, order: "payload->>at.asc,id.asc", limit: "51", offset: "50",
  });
});

test("review policy blocks missing workspace access and impersonation", () => {
  assert.equal(maySubmitKnowledgeReview({ hasWorkspaceAccess: false, isImpersonating: false }), false);
  assert.equal(maySubmitKnowledgeReview({ hasWorkspaceAccess: true, isImpersonating: true }), false);
  assert.equal(maySubmitKnowledgeReview({ hasWorkspaceAccess: true, isImpersonating: false }), true);
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
