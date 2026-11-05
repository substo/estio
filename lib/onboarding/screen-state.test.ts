import assert from "node:assert/strict";
import test from "node:test";
import { activeTopic, currentTopic } from "./screen-state";
import type { TopicView } from "./view";

const t = (id: string, status: TopicView["status"]) => ({ id, title: id, question: "?", status, fields: [], researching: false }) as unknown as TopicView;

test("the conversation confirms research first, then asks about the first empty topic", () => {
  assert.equal(currentTopic([t("business", "confirmed"), t("contact", "empty"), t("online", "suggested")])?.id, "online");
  assert.equal(currentTopic([t("business", "confirmed"), t("contact", "empty"), t("offer", "empty")])?.id, "contact");
  assert.equal(currentTopic([t("business", "confirmed"), t("look", "skipped")]), null);
});

test("the timeline follows the owner's choice, else the conversation", () => {
  const topics = [t("business", "confirmed"), t("contact", "empty")];
  assert.equal(activeTopic(topics, "business"), "business");
  assert.equal(activeTopic(topics, null), "contact");
  assert.equal(activeTopic(topics, "gone"), "contact");
  assert.equal(activeTopic([t("business", "confirmed")], null), "business");
});
