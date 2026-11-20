import assert from "node:assert/strict";
import test from "node:test";
import { CREATION_STAGES, confirmDirection, proposeDirection, readCreationCommand, replaceSelection } from "./creation-policy";
import { creationTextSpec, scriptBriefSpecFor } from "./worker/script-brief";
import { requestStructuredText } from "./worker/openai-text";
import type { CreationSnapshot } from "./creation-text-policy";

const id = "41a54015-28a7-47b0-92d2-0fbe831d322e";
const source = { id: "291af992-3d9a-4178-b730-8b33fb04c596", version: 4,
  title: "MrBeast on improving videos", concept: "Audience psychology, promise-first opening and payoff.", basis: "Saved transcript" };

test("blank and source-based starts ask for direction before any generation", () => {
  assert.deepEqual(CREATION_STAGES, ["Concept", "Angle", "Title", "Hook", "Payoff", "Script", "Shoot plan"]);
  const blank = proposeDirection("", "Substo", null, "custom");
  assert.throws(() => confirmDirection("custom", blank, ""), /publisher/);
  const input = proposeDirection("", "Substo", source, "promote");
  const confirmed = confirmDirection("promote", input, "");
  assert.equal(confirmed.publisher, "Substo");
  assert.match(confirmed.viewer, /First-time creators/);
  assert.match(confirmed.angle, /two openings/);
  assert.doesNotMatch(JSON.stringify(confirmed), /quote|CRM|plumb|service business/i);
  assert.throws(() => confirmDirection("customer", proposeDirection("", "Substo", source, "customer"), ""), /publisher/);
});

test("rich brief remains verbatim with no industry inferred and user rationale is server-owned", () => {
  const brief = "A 75-second video from Substo for first-time creators. Compare two openings for their own video and briefly demonstrate Studio. End with a specific practice exercise.";
  const command = readCreationCommand({ recordId: id, version: 0, action: "create", sourceId: source.id, sourceVersion: 4, templateId: null,
    brief, direction: { ...proposeDirection(brief, "Substo", source, "brief"), choice: "brief", rationale: "Invented" } });
  assert.equal(command.action, "create");
  if (command.action !== "create") return;
  assert.equal(command.brief, brief);
  assert.equal(command.direction.goal, brief);
  assert.equal(command.direction.publisher, "");
  assert.match(command.direction.rationale, /confirmed/);
});

test("an exact replacement changes just the selected UTF-16 range and ambiguity fails closed", () => {
  const text = "🎬 Make good videos. Show a good opening.";
  const start = text.lastIndexOf("good");
  const selection = { start, end: start + 4, text: "good" };
  assert.equal(replaceSelection(text, selection, "strong"), "🎬 Make good videos. Show a strong opening.");
  assert.equal(replaceSelection(text, { start, end: start + 4, text: "good" }, ""), "🎬 Make good videos. Show a  opening.");
  assert.throws(() => replaceSelection(text, { ...selection, start: 0 }, "strong"), /Select the exact words/);
  const rewrite = { recordId: id, version: 2, action: "generate", kind: "rewrite", stage: "Hook",
    feedback: "", instruction: "Shorten", provider: "openai", requestId: id, selection };
  assert.throws(() => readCreationCommand(rewrite), /Authorize/);
  assert.throws(() => readCreationCommand({ ...rewrite, confirmPaid: true, feedback: "Switch the target audience to plumbers." }), /Confirm the new video direction/);
});

test("staged rewrite captures only the authorized structured prompt and rejects invented evidence", async () => {
  const operation = { kind: "rewrite", stage: "Hook", feedback: "Use plain wording.", instruction: "Simplify",
    selection: { start: 8, end: 21, text: "retain viewers" }, before: "We will ", after: " today" } as const;
  const snapshot: CreationSnapshot = { mode: "staged_creation", operation, sourceConcept: source, focus: "", ideas: [], brief: "Teach creators to improve their videos",
    accepted: { Title: "How to improve your first video" }, direction: confirmDirection("promote", proposeDirection("", "Substo", source, "promote"), ""),
    evidence: [{ id: "citation", sourceId: source.id, version: 1, title: source.title, statement: null, quote: "Keep your promise.", type: "speech", start: null }],
    profile: { version: 3, context: { tone: "Plain", audience: "Service owners" } }, template: { id, name: "Promise first", version: 2, purpose: "Earn attention", beats: [] } };
  const result = { options: [], text: "keep people watching", rationale: "Uses direct wording.", evidenceIds: [], verification: [] };
  let captured: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_input, init) => {
    captured = JSON.parse(String(init?.body));
    return Response.json({ id: "mock", status: "completed", model: creationTextSpec.model, service_tier: "default",
      usage: { input_tokens: 180, output_tokens: 80, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] });
  };
  assert.equal(scriptBriefSpecFor(snapshot).promptVersion, "studio.creation.v1");
  assert.equal(scriptBriefSpecFor({}).promptVersion, "studio.script-brief.v2");
  const response = await requestStructuredText(creationTextSpec, snapshot, "fixture", new AbortController().signal, fetcher);
  assert.equal(response.result.text, "keep people watching");
  assert.ok(response.costMicros > 0);
  assert.deepEqual(JSON.parse(String(captured.input)), snapshot);
  assert.match(String(captured.instructions), /publisher, intended viewer/);
  assert.match(String(captured.instructions), /only the replacement/);
  assert.deepEqual(captured.tools, []);
  assert.throws(() => creationTextSpec.validate({ ...result, evidenceIds: ["invented"] }, snapshot), /Invalid/);
});
