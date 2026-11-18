import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeOutline, evidenceTime, readKnowledgeOutlineCommand, type EvidenceUnit, type OutlineBatch } from "./knowledge-outline";
import { readKnowledgeOutlineBatchResult, type KnowledgeExtractionSnapshot } from "./knowledge-extraction-policy";
import { requestKnowledgeExtraction } from "./worker/knowledge-extract";

const id = "ac000000-0000-4000-8000-000000000021";
const lastId = "ac000000-0000-4000-8000-000000000022";
const base = { action: "enqueueOutline", requestId: id, sourceId: id, expectedVersion: 1, mode: "record_text", inputId: "transcript", provider: "subscription", confirmSubscription: true };
const first: EvidenceUnit = { id: "speech:1", unitIndex: 0, evidenceType: "speech", text: "Verbatim speech.", startChar: null, endChar: null, startSeconds: 128.4, endSeconds: 130.2 };
const ocr = { id: "ocr:1", unitIndex: 1, evidenceType: "ocr" as const, text: "On-screen checklist", startChar: null, endChar: null, startSeconds: 130.2, endSeconds: null, context: "Speech that cannot be cited as OCR." };
const late: EvidenceUnit = { ...first, id: "speech:2", unitIndex: 2, text: "Late transcript evidence.", startSeconds: 3590.3, endSeconds: 3600 };
const makeSnapshot = (units: EvidenceUnit[]): KnowledgeExtractionSnapshot => ({
  source: { id, title: "Chosen video", version: 1, url: null }, mode: "outline", inputId: id, evidenceMode: "record_text", evidenceInputId: "transcript",
  startUnit: units[0].unitIndex, unitCount: units.length, fingerprint: "versioned", focus: "",
  coverage: { totalUnits: 3, selectedUnits: units.length, totalCharacters: null }, units,
});
const finding = { kind: "method" as const, unitId: first.id, statement: "Practice in small steps.", suggestedTopic: "Production",
  quote: "Verbatim speech", topicPath: ["Production", "Recording", "Practice", "Examples"] };
const lastFinding = { ...finding, unitId: late.id, quote: "Late transcript evidence" };
const screenFinding = { ...finding, unitId: ocr.id, statement: "The checklist is on screen.", quote: "On-screen checklist", topicPath: ["production", "Preparation"] };

test("explicit funding, bound inputs and separate approval are enforced on the outline command", () => {
  assert.equal(readKnowledgeOutlineCommand(base).action, "enqueueOutline");
  for (const patch of [{ mode: "outline" }, { inputId: "description" }, { sourceId: "foreign" }, { expectedVersion: 0 },
    { provider: "openai", confirmPaid: false }, { confirmSubscription: false, confirmPaid: true }]) {
    assert.throws(() => readKnowledgeOutlineCommand({ ...base, ...patch }));
  }
  const approval = { action: "approve", requestId: id, outlineId: id, confirmApproval: true,
    selections: [{ reviewId: id, index: 1 }, { reviewId: id, index: 0 }] };
  const parsed = readKnowledgeOutlineCommand(approval);
  assert.equal(parsed.action, "approve");
  if (parsed.action === "approve") assert.deepEqual(parsed.selections.map(s => s.index), [0, 1]);
  assert.throws(() => readKnowledgeOutlineCommand({ ...approval, confirmApproval: false }));
  assert.throws(() => readKnowledgeOutlineCommand({ ...approval, selections: Array(2).fill(approval.selections[0]) }));
});

test("combine variable-depth topic paths without losing late evidence or OCR labels", () => {
  const firstBatch: OutlineBatch = { reviewId: id, snapshot: makeSnapshot([first, ocr]), result: { findings: [finding, screenFinding] },
    model: "fixture", status: "succeeded", error: null, stale: false, applied: [] };
  const lastBatch: OutlineBatch = { ...firstBatch, reviewId: lastId, snapshot: makeSnapshot([late]), result: { findings: [lastFinding] } };
  const combined = buildKnowledgeOutline([firstBatch, lastBatch]);
  assert.equal(combined.units.length, 3);
  assert.equal(combined.covered, 3);
  assert.equal(combined.duplicates, 1);
  assert.equal(combined.topics.length, 1);
  const topic = combined.topics[0];
  const nested = topic.branches[0].branches[0].branches[0];
  assert.equal(nested.title, "Examples");
  assert.deepEqual(nested.takeaways[0].citations.map(citation => citation.start), [128.4, 3590.3]);
  assert.equal(topic.branches[1].takeaways[0].citations[0].type, "ocr");
  const partial = buildKnowledgeOutline([firstBatch, { ...lastBatch, result: null, status: "failed" }]);
  assert.equal(partial.covered, 2);
  assert.equal(partial.units.length, 3);
  assert.equal(evidenceTime(3590.3, 3600), "59:50–1:00:00");
  assert.equal(evidenceTime(0, null), "0:00");
  assert.equal(evidenceTime(null, null), null);
});

test("the v2 model contract validates path depth and quotes against the original speech or OCR only", () => {
  const snapshot = makeSnapshot([first, ocr]);
  const result = { findings: [finding, screenFinding] };
  assert.deepEqual(readKnowledgeOutlineBatchResult(result, snapshot), result);
  for (const patch of [{ topicPath: [] }, { topicPath: Array(13).fill("Topic") }, { topicPath: ["Tab\t"] },
    { quote: ocr.context }, { unitId: late.id }]) {
    assert.throws(() => readKnowledgeOutlineBatchResult({ findings: [{ ...screenFinding, ...patch }] }, snapshot));
  }
});

test("hosted structured adapter sends v2 evidence and schema through the existing metered route", async () => {
  const result = { findings: [screenFinding] };
  const snapshot = makeSnapshot([first, ocr]);
  const output = await requestKnowledgeExtraction(snapshot, "fixture-key", new AbortController().signal, async (_uri, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.instructions, /nearby speech for interpretation only/);
    assert.deepEqual(body.tools, []);
    assert.deepEqual(JSON.parse(body.input).units[1], ocr);
    assert.ok(body.text.format.schema.properties.findings.items.required.includes("topicPath"));
    return Response.json({ id: "fixture-response", status: "completed", model: "gpt-6-luna", service_tier: "default",
      usage: { input_tokens: 200, output_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] });
  });
  assert.equal(output.costMicros, 70);
  assert.deepEqual(output.result, result);
});
