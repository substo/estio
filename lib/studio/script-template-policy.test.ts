import assert from "node:assert/strict";
import test from "node:test";
import { initialScriptTemplateSelection, proofFirstScriptTemplate, readScriptTemplateDraft, readScriptTemplateSelection } from "./script-template-policy";

const template = { ...proofFirstScriptTemplate, id: "1bf77afc-8249-41a4-941f-1f6af55b34c1", version: 1 };
const other = { ...template, id: "7330558b-191b-4690-9359-2e202f220df0", version: 2 };

test("only unassigned content without a script defaults to its sole approved template", () => {
  assert.equal(initialScriptTemplateSelection({ script: "", options: [template] }), template.id);
  assert.equal(initialScriptTemplateSelection({ script: "", options: [] }), "unchanged");
  assert.equal(initialScriptTemplateSelection({ script: "", options: [template, other] }), "unchanged");
  assert.equal(initialScriptTemplateSelection({ script: "Existing script", options: [template] }), "unchanged");
  assert.equal(initialScriptTemplateSelection({ script: "", options: [template], selectionSaved: true }), "");
  assert.equal(initialScriptTemplateSelection({ script: "", options: [template, other], pinnedId: template.id }), template.id);
});

test("form parsing distinguishes unchanged, explicit opt-out and a version selection", () => {
  const form = new FormData();
  assert.equal(readScriptTemplateSelection(form), undefined);
  form.set("scriptTemplateVersion", "unchanged");
  assert.equal(readScriptTemplateSelection(form), undefined);
  form.set("scriptTemplateVersion", "");
  assert.equal(readScriptTemplateSelection(form), null);
  form.set("scriptTemplateVersion", template.id);
  assert.equal(readScriptTemplateSelection(form), template.id);
  form.set("scriptTemplateVersion", "wrong");
  assert.throws(() => readScriptTemplateSelection(form), /valid script template/);
});

test("template drafts retain beat order and reject missing guidance", () => {
  const form = new FormData();
  form.set("name", " Proof first ");
  form.set("purpose", "Show the outcome");
  form.append("beatName", "Proof");
  form.append("beatGuidance", "Show the result");
  form.append("beatName", "Demo");
  assert.throws(() => readScriptTemplateDraft(form), /between 1 and 12/);
  form.append("beatGuidance", "Show the steps");
  assert.deepEqual(readScriptTemplateDraft(form), {
    name: "Proof first",
    purpose: "Show the outcome",
    beats: [{ name: "Proof", guidance: "Show the result" }, { name: "Demo", guidance: "Show the steps" }],
  });
});
