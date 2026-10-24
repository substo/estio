import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalKnowledgeJson, normalizeLegacyKnowledge } from "./legacy-knowledge";

const source = "11111111-1111-4111-8111-111111111111";
const topic = "22222222-2222-4222-8222-222222222222";
const insight = "33333333-3333-4333-8333-333333333333";
const fixture = () => ({ version: 1, topics: [{ id: topic, name: "Strategy", name_key: "strategy", summary: "", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" }], sources: [{ id: source, title: "Video", url: "https://example.test/v", platform: "youtube", observed_at: "2026-01-01T00:00:00Z", transcription_id: "tx-1", total_units: 1, covered_units: 1 }], insights: [{ id: insight, source_id: source, topic_id: topic, suggested_topic: "Strategy", kind: "claim", statement: "  Exact statement.\nKeep spacing.  ", status: "approved", created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T01:00:00Z" }], evidence: [{ id: "44444444-4444-4444-8444-444444444444", insight_id: insight, source_id: source, quote: "verbatim citation", start_sec: 2.5, end_sec: 4, frame_file: "frame-01.jpg", source_url: "https://example.test/v", observed_at: "2026-01-03T00:00:00Z" }], reviews: [{ id: "55555555-5555-4555-8555-555555555555", insight_id: insight, action: "approve", previous_status: "pending", new_status: "approved", at: "2026-01-03T00:00:00Z" }], sourceUnits: [{ recordId: source, payload: { transcriptionId: "tx-1", units: [{ text: "transcript", start: 2.5, end: 4, frameFile: "frame-01.jpg" }] as Array<{ text: string; start: number; end: number; frameFile?: string }> } }] });
const normalize = (value: unknown) => normalizeLegacyKnowledge(value, { recordIds: [source] });

test("preserves exact statements, citations, review, coverage and opaque sidecar provenance", () => {
  const original = fixture();
  const result = normalize(original);
  assert.equal(result.valid, true);
  assert.equal(result.sourceCanonicalJson, canonicalKnowledgeJson(original));
  assert.equal(result.sourceDigest, createHash("sha256").update(result.sourceCanonicalJson, "utf8").digest("hex"));
  assert.equal(result.insights[0].statement, "  Exact statement.\nKeep spacing.  ");
  assert.deepEqual(result.sources[0], original.sources[0]);
  assert.deepEqual(result.evidence[0], original.evidence[0]);
  assert.deepEqual(result.reviews[0], original.reviews[0]);
  assert.deepEqual(result.sourceUnitSidecars[0].payload, original.sourceUnits[0]);
  assert.equal(result.sourceUnitSidecars[0].source_id, source);
  assert.deepEqual(result.sourceUnits[0].payload, { unit: original.sourceUnits[0].payload.units[0] });
  assert.equal(result.sourceUnits[0].sidecar_id, result.sourceUnitSidecars[0].id);
  assert.equal(result.sourceUnits[0].source_id, source);
  assert.equal(result.sourceUnits[0].unit_index, 0);
  assert.deepEqual(result.counts, { topics: 1, sources: 1, insights: 1, evidence: 1, reviews: 1, sourceUnitSidecars: 1, sourceUnits: 1, pending: 0, approved: 1, rejected: 0, uncoveredUnits: 0 });
  assert.deepEqual(original, fixture(), "normalizer does not mutate exported rows");
  assert.deepEqual(result, normalize(JSON.parse(JSON.stringify(original))));
});

test("reports dangling and mismatched references without silently losing rows", () => {
  const input = fixture();
  input.evidence.push({ ...input.evidence[0], id: "66666666-6666-4666-8666-666666666666", source_id: "77777777-7777-4777-8777-777777777777" });
  input.reviews.push({ ...input.reviews[0], id: "88888888-8888-4888-8888-888888888888", insight_id: "99999999-9999-4999-8999-999999999999" });
  const result = normalize(input);
  assert.equal(result.valid, false);
  assert.equal(result.evidence.length, 2);
  assert.equal(result.reviews.length, 2);
  assert.ok(result.issues.some((issue) => issue.code === "missing_source"));
  assert.ok(result.issues.some((issue) => issue.code === "missing_insight"));
});

test("unsupported row and coverage shapes remain visible and invalidate the manifest", () => {
  const input = fixture();
  // These casts deliberately simulate malformed, untyped legacy input.
  input.sources[0].covered_units = "8" as unknown as number;
  input.evidence.push(null as unknown as typeof input.evidence[number]);
  const result = normalize(input);
  assert.equal(result.valid, false);
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(result.evidence[1], { _unparsed_legacy_value: null });
  assert.ok(result.issues.some((issue) => issue.code === "invalid_coverage"));
  assert.ok(result.issues.some((issue) => issue.code === "unsupported_row"));
});

test("invalid top-level exports produce a diagnostic manifest", () => {
  const result = normalizeLegacyKnowledge({ version: 2 });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_store_v1");
});

test("library reconciliation context is mandatory for sources and flags missing records", () => {
  const input = fixture();
  assert.equal(normalizeLegacyKnowledge(input).valid, false);
  assert.ok(normalize(input).valid);
  const result = normalizeLegacyKnowledge(input, { recordIds: [] });
  assert.ok(result.issues.some((issue) => issue.code === "missing_library_record"));
});

test("malformed topic, evidence, review and sidecar fields invalidate but remain inspectable", () => {
  const input = fixture();
  input.topics[0].name_key = "";
  input.evidence[0].end_sec = -1;
  input.reviews[0].new_status = "pending";
  input.sourceUnits[0].payload.units[0].start = "2.5" as unknown as number;
  const result = normalize(input);
  assert.equal(result.valid, false);
  assert.equal(result.sourceUnits.length, 1);
  for (const code of ["invalid_evidence_time", "invalid_review_transition", "unsupported_unit_shape"]) assert.ok(result.issues.some((issue) => issue.code === code), code);
});

test("sidecar envelope and unit payload retention grows linearly with unit count", () => {
  const input = fixture();
  const units = Array.from({ length: 500 }, (_, index) => ({ text: `unit-${index}`, start: index, end: index + 0.5 }));
  input.sourceUnits[0].payload.units = units;
  input.sources[0].total_units = units.length;
  input.sources[0].covered_units = units.length;
  const result = normalize(input);
  assert.equal(result.valid, true);
  assert.equal(result.sourceUnitSidecars.length, 1);
  assert.equal(result.sourceUnits.length, units.length);
  const unitPayloadBytes = JSON.stringify(result.sourceUnits).length;
  assert.ok(unitPayloadBytes < units.length * 300, `unit rows should not repeat the full sidecar (bytes=${unitPayloadBytes})`);
  assert.deepEqual(result.sourceUnitSidecars[0].payload, input.sourceUnits[0]);
  const smaller = fixture();
  smaller.sourceUnits[0].payload.units = units.slice(0, 250);
  smaller.sources[0].total_units = 250;
  smaller.sources[0].covered_units = 250;
  const smallerBytes = JSON.stringify(normalize(smaller).sourceUnits).length;
  assert.ok(unitPayloadBytes < smallerBytes * 2.2, `doubling units should approximately double row payload (small=${smallerBytes}, large=${unitPayloadBytes})`);
});

test("duplicate sidecar identities and malformed timestamps and unit ranges invalidate without dropping data", () => {
  const input = fixture();
  input.sourceUnits.push(structuredClone(input.sourceUnits[0]));
  input.sources[0].observed_at = "not a timestamp";
  input.topics[0].created_at = "yesterday-ish";
  input.insights[0].updated_at = "bad";
  input.evidence[0].observed_at = "bad";
  input.reviews[0].at = "bad";
  input.sourceUnits[0].payload.units[0].end = 1;
  const result = normalize(input);
  assert.equal(result.valid, false);
  assert.equal(result.sourceUnitSidecars.length, 2);
  assert.equal(result.sourceUnits.length, 2);
  for (const code of ["duplicate_sidecar", "invalid_timestamp", "invalid_unit_range"]) assert.ok(result.issues.some((issue) => issue.code === code), code);
});

test("unsupported sidecar envelopes remain once in the diagnostic manifest", () => {
  const input = fixture();
  input.sourceUnits[0].payload = { unexpected: ["raw", "sidecar"] } as unknown as typeof input.sourceUnits[number]["payload"];
  const result = normalize(input);
  assert.equal(result.valid, false);
  assert.equal(result.sourceUnitSidecars.length, 1);
  assert.deepEqual(result.sourceUnitSidecars[0].payload, input.sourceUnits[0]);
  assert.equal(result.counts.sourceUnitSidecars, 1);
  assert.ok(result.issues.some((issue) => issue.code === "unsupported_sidecar_shape"));
});

test("sidecar coverage and transcription readiness is enforced by the normalizer", () => {
  const missing = fixture();
  missing.sourceUnits = [];
  assert.ok(normalize(missing).issues.some((issue) => issue.code === "missing_source_unit_sidecar"));
  const wrongCount = fixture();
  wrongCount.sources[0].total_units = 2;
  assert.ok(normalize(wrongCount).issues.some((issue) => issue.code === "source_unit_count_mismatch"));
  const wrongTranscription = fixture();
  wrongTranscription.sources[0].transcription_id = "different";
  assert.ok(normalize(wrongTranscription).issues.some((issue) => issue.code === "source_unit_transcription_mismatch"));
});
