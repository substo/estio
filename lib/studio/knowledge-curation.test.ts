import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeOutline, type OutlineBatch } from "./knowledge-outline";
import { readKnowledgeCuratedBatchResult, type KnowledgeExtractionSnapshot } from "./knowledge-extraction-policy";
import { readSourceAssistCommand } from "./source-assist-policy";
import { knowledgeExtractionSpecFor, requestKnowledgeExtraction } from "./worker/knowledge-extract";

const id = "ac000000-0000-4000-8000-000000000041";
const nextId = "ac000000-0000-4000-8000-000000000042";
const snapshot: KnowledgeExtractionSnapshot = {
  source: { id, title: "Sample interview", version: 1, url: null }, mode: "outline", curationVersion: 1, inputId: id,
  startUnit: 0, unitCount: 1, focus: "", fingerprint: "fixture", coverage: { totalUnits: 2, selectedUnits: 1, totalCharacters: null },
  units: [{ id: "u1", text: "Begin with a familiar mistake, then explain how to avoid it.", unitIndex: 0,
    startChar: null, endChar: null, startSeconds: 763, endSeconds: 767, evidenceType: "speech" }],
};
const advice = { kind: "method" as const, unitId: "u1", quote: "Begin with a familiar mistake", statement: "Open with a familiar mistake.",
  suggestedTopic: "Opening", topicPath: ["Opening"], curation: { featured: true, use: "Write the opening", equivalentPoint: "open-with-mistake", basis: "advice" as const } };
const next = { ...advice, statement: "Lead with a mistake your viewers recognize.", quote: "Put a recognizable error first." };
const nextSnap = { ...snapshot, units: [{ ...snapshot.units[0], unitIndex: 1, text: "Put a recognizable error first.", startSeconds: 810 }] };
const batch = (snapshot: KnowledgeExtractionSnapshot, reviewId: string, findings: OutlineBatch["result"]) =>
  ({ reviewId, snapshot, result: findings, model: "fixture", status: "succeeded", error: null, stale: false, applied: [] });

test("curation merges equivalent advice while retaining immutable references and exact citations", () => {
  const claim = { ...advice, kind: "claim" as const, statement: "The source claims a conversion lift.", curation: { ...advice.curation, basis: "speaker_claim" as const, featured: false } };
  const output = buildKnowledgeOutline([batch(snapshot, id, { findings: [advice, claim] }), batch(nextSnap, nextId, { findings: [next] })]);
  assert.equal(output.covered, 2);
  assert.equal(output.duplicates, 1);
  assert.deepEqual(output.featured.map(group => group.title), ["Write the opening"]);
  assert.equal(output.featured[0].items[0].references.length, 2);
  assert.equal(output.featured[0].items[0].citations.length, 2);
  assert.deepEqual(output.featured[0].items[0].alternateStatements, [next.statement]);
  assert.equal(output.allTakeaways[1].unverified, true);
});

test("empty, old and malformed results are handled without invented curation or citations", () => {
  assert.deepEqual(readKnowledgeCuratedBatchResult({ findings: [] }, snapshot), { findings: [] });
  assert.throws(() => readKnowledgeCuratedBatchResult({ findings: [{ ...advice, quote: "invented" }] }, snapshot));
  assert.throws(() => readKnowledgeCuratedBatchResult({ findings: [{ ...advice, curation: { ...advice.curation, use: " " } }] }, snapshot));
  assert.equal(knowledgeExtractionSpecFor({ ...snapshot, curationVersion: undefined }).promptVersion, "studio.knowledge-extract.v2");
  const legacy = buildKnowledgeOutline([batch({ ...snapshot, curationVersion: undefined }, id, { findings: [{ ...advice, curation: undefined }] })]);
  assert.equal(legacy.allTakeaways.length, 1);
  assert.equal(legacy.featured.length, 0);
});

test("the hosted adapter passes source-driven curation instructions and validates the provider reply", async () => {
  const result = await requestKnowledgeExtraction(snapshot, "fixture", new AbortController().signal, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.instructions, /as many or as few/);
    assert.match(body.instructions, /no target or minimum/);
    assert.ok(body.text.format.schema.properties.findings.items.required.includes("curation"));
    assert.deepEqual(body.tools, []);
    assert.equal(body.max_output_tokens, 6000);
    assert.deepEqual(JSON.parse(body.input), snapshot);
    return Response.json({ id: "fixture", status: "completed", model: "gpt-6-luna", service_tier: "default",
      usage: { input_tokens: 100, output_tokens: 80, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ findings: [advice] }) }] }] });
  });
  assert.deepEqual(result.result, { findings: [advice] });
});

test("selected idea uses the assistant's pinned proposal-only spec and the reaction is optional", () => {
  const input = { sourceId: id, expectedVersion: 1, requestId: nextId, provider: "subscription", confirmSubscription: true,
    intent: "propose_idea", message: "", selection: { outlineId: id, selections: [{ reviewId: nextId, index: 0 }] } };
  assert.deepEqual(readSourceAssistCommand(input).selection, input.selection);
  assert.throws(() => readSourceAssistCommand({ ...input, intent: "rewrite_note" }));
  assert.throws(() => readSourceAssistCommand({ ...input, confirmSubscription: false }));
  const spec = knowledgeExtractionSpecFor({ mode: "source_assist", selectedOutline: id });
  assert.match(spec.instructions, /original video idea/);
  assert.match(spec.instructions, /do not repackage/i);
  assert.equal(spec.promptVersion, "studio.source-assist.selected-idea.v1");
});
