import assert from "node:assert/strict";
import { test } from "node:test";
import { ideaComparisonPrompt, ideaLabel, readIdeaCard } from "./idea-cards";
import { AGENT_MESSAGE_LIMIT } from "./agent-policy";

test("free-form concepts use their first line as a label and still fit in a comparison message", () => {
  const first = "Film the opening twice\n" + "x".repeat(1100);
  const second = "Title first\n" + "Y".repeat(1100);
  assert.equal(readIdeaCard(first), null);
  assert.equal(ideaLabel(first), "Film the opening twice");
  const message = ideaComparisonPrompt([first, second]);
  assert.match(message, /Idea 1\nFilm the opening twice/);
  assert.match(message, /Idea 2\nTitle first/);
  assert.ok(message.length <= AGENT_MESSAGE_LIMIT);
});
