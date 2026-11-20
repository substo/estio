import assert from "node:assert/strict";
import test from "node:test";
import { readVideoTemplateCommand, readVideoTemplateResult, reusableVideoTemplate, VIDEO_TEMPLATE_PROMPT, type VideoTemplateSnapshot } from "./video-template-policy";
import { requestKnowledgeExtraction } from "./worker/knowledge-extract";
import { AI_WORKFLOW_CONTRACT_VERSION } from "../ai/workflow-capabilities";

const id = "ac000000-0000-4000-8000-000000000001";
const snapshot: VideoTemplateSnapshot = {
  source: { id, version: 1, title: "Example", url: null }, mode: "script_template", inputId: "transcript",
  startUnit: 0, unitCount: 2, focus: "", fingerprint: "fixture",
  coverage: { totalUnits: 3, selectedUnits: 2, totalCharacters: 24, speechUnits: 2, selectedSpeech: 1, ocrUnits: 1, selectedOcr: 1 },
  units: [
    { id: "speech:1:0", unitIndex: 0, text: "Here's what changed.", startChar: null, endChar: null, startSeconds: 3, endSeconds: 9, evidenceType: "speech" },
    { id: "ocr:1:0", unitIndex: 1, text: "Before and after", startChar: null, endChar: null, startSeconds: 8, endSeconds: 15, evidenceType: "ocr" },
  ],
};
const result = { name: "Results first", purpose: "Give the viewer a reason to watch.", limitations: ["Sampled evidence."],
  beats: [{ name: "Show the outcome", guidance: "Open with a real result.", rationale: "The source names and labels the change.",
    citations: [{ unitId: snapshot.units[0].id, quote: "what changed" }, { unitId: snapshot.units[1].id, quote: "Before and after" }] }] };

test("video template admission needs a version and explicit consent for the chosen route", () => {
  const command = { sourceId: id, requestId: id, expectedVersion: 1, provider: "subscription", confirmSubscription: true };
  assert.equal(readVideoTemplateCommand(command).confirmPaid, false);
  for (const patch of [{ provider: undefined }, { provider: "openai" }, { confirmSubscription: false }, { expectedVersion: 0 }, { sourceId: "http://example.test" }]) {
    assert.throws(() => readVideoTemplateCommand({ ...command, ...patch }));
  }
});

test("reusable writing guidance excludes the cited rationale and raw source evidence", () => {
  assert.deepEqual(readVideoTemplateResult(result, snapshot), result);
  assert.deepEqual(reusableVideoTemplate(result), { name: result.name, purpose: result.purpose,
    beats: [{ name: "Show the outcome", guidance: "Open with a real result." }] });
  assert.deepEqual(readVideoTemplateResult({ ...result, beats: [] }, snapshot).beats, []);
  for (const citations of [[], [{ unitId: "foreign", quote: "what changed" }], [{ unitId: snapshot.units[0].id, quote: "Before and after" }]]) {
    assert.throws(() => readVideoTemplateResult({ ...result, beats: [{ ...result.beats[0], citations }] }, snapshot));
  }
  assert.throws(() => readVideoTemplateResult({ ...result, inventedField: "extra" }, snapshot));
  assert.throws(() => readVideoTemplateResult({ ...result, beats: [], limitations: [] }, snapshot));
});

test("hosted transport sends the video template prompt and schema without tools or media", async () => {
  const output = await requestKnowledgeExtraction(snapshot, "synthetic", new AbortController().signal, async (_url, request) => {
    const body = JSON.parse(String(request?.body));
    assert.match(body.instructions, new RegExp(AI_WORKFLOW_CONTRACT_VERSION));
    assert.match(body.instructions, /speech supports what was said/i);
    assert.match(body.instructions, /Location Admin/);
    assert.match(body.instructions, /coverage is sampled/);
    assert.deepEqual(JSON.parse(body.input), snapshot);
    assert.deepEqual(body.tools, []);
    assert.deepEqual(body.text.format.schema.required, ["name", "purpose", "beats", "limitations"]);
    return Response.json({ id: VIDEO_TEMPLATE_PROMPT, status: "completed", model: "gpt-6-luna", service_tier: "default",
      usage: { input_tokens: 100, output_tokens: 150, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] });
  });
  assert.deepEqual(output.result, result);
  assert.equal(output.costMicros, 85);
});
