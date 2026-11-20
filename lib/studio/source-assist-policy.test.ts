import { test } from "node:test";
import assert from "node:assert/strict";
import { readSourceAssistCommand, readSourceAssistResult, sourceAssistInstructions, sourceAssistSchema } from "./source-assist-policy";
import { requestStructuredText } from "./worker/openai-text";
import { knowledgeExtractionSpecFor } from "./worker/knowledge-extract";
import { aiWorkflowInstructions } from "../ai/workflow-capabilities";
const id = "ac000000-0000-4000-8000-000000000001";
const base = { sourceId: id, requestId: id, expectedVersion: 2, intent: "discuss", message: "What works here?" };
const snap = (inputId: string) => ({ source: { id, version: 2, title: "T", url: null }, mode: "source_assist", inputId, startUnit: 0, unitCount: 1, focus: "x", fingerprint: "f", notes: "",
  coverage: { totalUnits: 1, selectedUnits: 1, totalCharacters: 10, speechUnits: 1, selectedSpeech: 1, ocrUnits: 0, selectedOcr: 0 },
  units: [{ id: "u1", text: "Open with the result.", evidenceType: "speech", startSeconds: 3, endSeconds: 6, unitIndex: 0 }] }) as never;
const ok = { reply: "r", note: null, ideaTitle: null, ideaConcept: null, relatedQuery: null, citations: [{ unitId: "u1", quote: "Open with the result." }], limitations: [] };

test("command needs an explicit route, the matching consent, a bounded message and a known intent", () => {
  assert.equal(readSourceAssistCommand({ ...base, provider: "subscription", confirmSubscription: true }).confirmPaid, false);
  assert.equal(readSourceAssistCommand({ ...base, provider: "openai", confirmPaid: true }).confirmSubscription, false);
  assert.throws(() => readSourceAssistCommand({ ...base }), /route/);
  assert.throws(() => readSourceAssistCommand({ ...base, provider: "subscription", confirmPaid: true }), /authorize/);
  assert.throws(() => readSourceAssistCommand({ ...base, provider: "openai", confirmSubscription: true }), /authorize/);
  assert.throws(() => readSourceAssistCommand({ ...base, provider: "subscription", confirmSubscription: true, intent: "browse" }));
  assert.throws(() => readSourceAssistCommand({ ...base, provider: "subscription", confirmSubscription: true, message: "x".repeat(2001) }));
  assert.throws(() => readSourceAssistCommand({ ...base, provider: "subscription", confirmSubscription: true, sourceId: "../etc" }));
});
test("result must match the requested action, exact citations and strict shape", () => {
  assert.deepEqual(readSourceAssistResult(ok, snap("discuss")).citations.length, 1);
  assert.throws(() => readSourceAssistResult({ ...ok, note: "n" }, snap("discuss")));
  assert.throws(() => readSourceAssistResult(ok, snap("rewrite_note")));
  assert.ok(readSourceAssistResult({ ...ok, note: "Clean note" }, snap("rewrite_note")).note);
  assert.throws(() => readSourceAssistResult({ ...ok, ideaTitle: "t" }, snap("propose_idea")));
  assert.ok(readSourceAssistResult({ ...ok, ideaTitle: "T", ideaConcept: "C" }, snap("propose_idea")).ideaConcept);
  assert.throws(() => readSourceAssistResult({ ...ok, citations: [{ unitId: "u1", quote: "invented" }] }, snap("discuss")));
  assert.throws(() => readSourceAssistResult({ ...ok, citations: [] }, snap("discuss")));
  assert.ok(readSourceAssistResult({ ...ok, citations: [], limitations: ["No evidence on this"] }, snap("discuss")));
  assert.throws(() => readSourceAssistResult({ ...ok, extra: 1 }, snap("discuss")));
});
test("instructions and runtime contract forbid tools and treat the snapshot as untrusted", () => {
  assert.match(sourceAssistInstructions, /untrusted data/);
  assert.match(sourceAssistInstructions, /cannot browse/);
  assert.match(aiWorkflowInstructions("source_assist"), /ONE saved source/);
  assert.deepEqual(sourceAssistSchema.required, ["reply", "note", "ideaTitle", "ideaConcept", "relatedQuery", "citations", "limitations"]);
});
test("paid route sends one strict, tool-free request with prompt capture and validates the reply", async () => {
  const spec = knowledgeExtractionSpecFor(snap("discuss"));
  let body: Record<string, any> = {};
  const fetcher = (async (_url: string, init: { body: string }) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "resp_1", status: "completed", model: spec.model, service_tier: "default",
      usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(ok) }] }] }));
  }) as unknown as typeof fetch;
  const result = await requestStructuredText(spec as never, snap("discuss") as never, "k", new AbortController().signal, fetcher);
  assert.deepEqual(body.tools, []);
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.match(body.instructions, /ONE saved source/);
  assert.match(body.instructions, /Answer from the supplied evidence units only/);
  assert.equal((result.result as { reply: string }).reply, "r");
});
