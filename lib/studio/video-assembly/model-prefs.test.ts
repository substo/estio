import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_PREFS, agentModel, decodePick, encodePick, modelChoices, ranModelsLine, readModelPrefs, readModelPrefsFromForm, revisionModel, revisionRanLine, routeLabel, touchesGraphics } from "./model-prefs";

test("everything defaults to the Mac's own model, and unknown values fall back to it", () => {
  assert.deepEqual(readModelPrefs(undefined), DEFAULT_MODEL_PREFS);
  assert.deepEqual(readModelPrefs({ jobs: { edit: { provider: "openai", model: "gpt-9" }, motion: { provider: "claude", model: "bad model!" } }, keepDesigner: "yes" }), DEFAULT_MODEL_PREFS);
});

test("the agent kinds only accept Claude; text kinds accept Claude or Codex", () => {
  const prefs = readModelPrefs({ jobs: { motion: { provider: "codex", model: "gpt-5.5" }, edit: { provider: "claude", model: "claude-sonnet-5-5" }, plan: { provider: "codex", model: "gpt-5.5" } }, keepDesigner: true });
  assert.deepEqual(prefs.jobs.motion, { provider: "default" });
  assert.deepEqual(prefs.jobs.edit, { provider: "claude", model: "claude-sonnet-5-5" });
  assert.deepEqual(prefs.jobs.plan, { provider: "codex", model: "gpt-5.5" });
  assert.equal(prefs.keepDesigner, true);
  assert.ok(modelChoices("motion").every(m => m.provider === "claude"));
  assert.ok(modelChoices("text").some(m => m.provider === "codex"));
});

test("form values round trip, and a paid-looking or malformed value is the default", () => {
  assert.equal(encodePick({ provider: "claude", model: "claude-sonnet-5-5" }), "claude:claude-sonnet-5-5");
  assert.deepEqual(decodePick("edit", "claude:claude-sonnet-5-5"), { provider: "claude", model: "claude-sonnet-5-5" });
  assert.deepEqual(decodePick("edit", "openai:gpt-5"), { provider: "default" });
  assert.deepEqual(decodePick("motion", "codex:gpt-5.5"), { provider: "default" });
  const form = new FormData(); form.set("model_motion", "claude:claude-opus-5-5"); form.set("model_edit", "claude:sonnet"); form.set("keepDesigner", "on");
  const prefs = readModelPrefsFromForm(form);
  assert.equal(agentModel(prefs.jobs.motion), "claude-opus-5-5");
  assert.equal(agentModel(prefs.jobs.edit), "sonnet");
  assert.equal(agentModel(prefs.jobs.plan), undefined);
  assert.equal(prefs.keepDesigner, true);
});

test("the route is always the creator's Mac subscription", () => {
  assert.match(routeLabel({ provider: "default" }), /^Mac subscription · Claude · Mac default model$/);
  assert.match(routeLabel({ provider: "claude", model: "claude-sonnet-5-5" }), /Mac subscription · Claude · Claude Sonnet 5\.5/);
  assert.match(routeLabel({ provider: "codex", model: "gpt-5.5" }), /Mac subscription · Codex · GPT-5\.5/);
});

test("a revision of a graphic goes back to its designer when asked, other changes use the editing model", () => {
  const prefs = readModelPrefs({ jobs: { motion: { provider: "claude", model: "claude-opus-5-5" }, edit: { provider: "claude", model: "claude-sonnet-5-5" } }, keepDesigner: true });
  assert.deepEqual(revisionModel(prefs, "Make the title bigger", "claude-haiku-5-5"), { model: "claude-haiku-5-5", kind: "motion", reason: "designer" });
  assert.deepEqual(revisionModel(prefs, "Make the title bigger", undefined), { model: "claude-opus-5-5", kind: "motion", reason: "preference" });
  assert.deepEqual(revisionModel(prefs, "Cut the pause at 0:12", "claude-haiku-5-5"), { model: "claude-sonnet-5-5", kind: "edit", reason: "preference" });
  assert.deepEqual(revisionModel({ ...prefs, keepDesigner: false }, "Add a counter chart", "claude-haiku-5-5"), { model: "claude-opus-5-5", kind: "motion", reason: "preference" });
  assert.deepEqual(revisionModel(DEFAULT_MODEL_PREFS, "Add a lower third"), { model: undefined, kind: "motion", reason: "default" });
  assert.equal(revisionModel(prefs, "Add a lower third", "not a model!").reason, "preference");
  assert.ok(touchesGraphics("animate the callout") && !touchesGraphics("trim the end"));
});

test("the result line says what actually ran", () => {
  assert.match(ranModelsLine({ edit: "claude-sonnet-5-5", motion: "claude-sonnet-5-5" }), /editing and motion graphics: claude-sonnet-5-5/);
  assert.match(ranModelsLine({ edit: "claude-sonnet-5-5", motion: "claude-opus-5-5" }), /editing: claude-sonnet-5-5; motion graphics: claude-opus-5-5/);
  assert.match(ranModelsLine({}), /the Mac's default model/);
  assert.match(revisionRanLine("motion", "claude-haiku-5-5", "designer"), /Kept the model that designed these graphics/);
});
