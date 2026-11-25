import assert from "node:assert/strict";
import { test } from "node:test";
import { audienceObservationEdit, audienceSuggestionEdit, readAudienceBrief } from "./audience-brief";

test("an audience edit uses the chosen section and only its supporting excerpt", () => {
  const brief = readAudienceBrief(JSON.stringify({
    format: "studio-audience-brief.v1", coverage: { analyzed: 2 },
    evidence: [
      { id: "c00001", video: "one", file: "one.json", row: 1, text: "Just show both openings before explaining." },
      { id: "c00002", video: "two", file: "two.json", row: 1, text: "Unrelated comment." },
    ],
    signals: [
      { kind: "objection", action: "verify", beat: "hook", signal: "Too much setup", suggestion: "Open with both takes.", evidence: ["c00001"] },
    ],
  }));
  const edit = audienceSuggestionEdit(brief.signals[0]);
  assert.equal(edit.label, "Revise the opening");
  assert.match(edit.message, /only the spoken opening/);
  assert.match(edit.message, /independent confirmation/);
  assert.match(edit.message, /Just show both openings/);
  assert.doesNotMatch(edit.message, /Unrelated comment|one\.json/);
  assert.match(audienceObservationEdit({ id: "a1", kind: "phrase", origin: "faq", text: "Show both takes" }), /natural place to use the audience's wording/);
});
