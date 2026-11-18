import test from "node:test";
import assert from "node:assert/strict";
import { scriptNextAction } from "./reference-workflow";
const idea = { archived: false, payload: { stage: "idea" } };
test("a URL-only link cannot suggest generating a script", () => {
  assert.equal(scriptNextAction(idea, []).kind, "links");
  assert.equal(scriptNextAction(idea, [{ hasScriptEvidence: false }]).kind, "links");
  assert.equal(scriptNextAction(idea, [{ hasScriptEvidence: true }]).kind, "generate");
});
test("the three-link bound counts all outgoing records, even those without text", () => {
  assert.equal(scriptNextAction(idea, Array.from({ length: 4 }, () => ({ hasScriptEvidence: true }))).kind, "links");
  assert.equal(scriptNextAction(idea, Array.from({ length: 3 }, () => ({ hasScriptEvidence: true }))).kind, "generate");
});
test("saved scripts guide human filming handoff without setting approval", () => {
  const record = { archived: false, payload: { stage: "script", script: "Hello", approved: false } };
  assert.equal(scriptNextAction(record, []).kind, "handoff");
  assert.equal(record.payload.approved, false);
  assert.equal(scriptNextAction({ ...record, archived: true }, []).kind, "archived");
  assert.equal(scriptNextAction({ archived: false, payload: { stage: "research", script: " " } }, []).kind, "manual");
});
