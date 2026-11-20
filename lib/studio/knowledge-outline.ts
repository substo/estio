import { StudioCommandError } from "./command-error";
import type { KnowledgeExtractionResult, KnowledgeExtractionSnapshot } from "./knowledge-extraction-policy";
import { hasStudioTextConsent, readStudioTextProvider } from "./text-provider";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => { throw new StudioCommandError(message); };

function readId(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value)) return invalid("Reload before continuing.");
  return value.toLowerCase();
}

export function readKnowledgeOutlineCommand(body: Record<string, unknown>) {
  const requestId = readId(body.requestId);
  if (body.action === "enqueueOutline") {
    const sourceId = readId(body.sourceId);
    const provider = readStudioTextProvider(body.provider);
    const { mode, inputId } = body;
    if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1
      || (mode !== "record_text" && mode !== "source_units" && mode !== "upload_transcript")
      || typeof inputId !== "string" || !inputId || inputId.length > 200
      || (mode === "record_text" && !["transcript", "notes", "script"].includes(inputId))
      || (mode === "upload_transcript" && !uuid.test(inputId))
      || !hasStudioTextConsent(provider, body)) {
      return invalid("Choose saved evidence and authorize its processing.");
    }
    return { action: "enqueueOutline" as const, requestId, sourceId, expectedVersion: Number(body.expectedVersion),
      mode, inputId, curationVersion: 1, provider, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription" };
  }
  const outlineId = readId(body.outlineId);
  if (body.action === "retryBatch") {
    const reviewId = readId(body.reviewId);
    const provider = readStudioTextProvider(body.provider);
    if (provider === "location_order" || !hasStudioTextConsent(provider, body)) return invalid("Authorize processing of this batch.");
    return { action: "retryBatch" as const, requestId, outlineId, reviewId, provider, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription" };
  }
  if (body.action === "triage") {
    const { nodeKey, state } = body;
    if (typeof nodeKey !== "string" || !/^finding:[a-f0-9-]{36}:[0-9]$/.test(nodeKey) ||
      (state !== "kept" && state !== "hidden" && state !== "clear")) return invalid("Choose a takeaway to review.");
    return { action: "triage" as const, requestId, outlineId, nodeKey, state };
  }
  if (body.action === "annotate") {
    const { nodeKey, note, title, summary, expectedVersion } = body;
    if (typeof nodeKey !== "string" || !nodeKey || new TextEncoder().encode(nodeKey).byteLength > 6000
      || typeof note !== "string" || note.length > 2000 || typeof title !== "string" || title.length > 120
      || typeof summary !== "string" || summary.length > 1200
      || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0) {
      return invalid("Check the note and summary lengths.");
    }
    return { action: "annotate" as const, requestId, outlineId, expectedVersion: Number(expectedVersion), nodeKey,
      note: note.trim(), title: title.trim(), summary: summary.trim() };
  }
  if (body.action !== "approve" || body.confirmApproval !== true) return invalid("Confirm which takeaways to approve.");
  const { selections } = readFindingReferences(body);
  return { action: "approve" as const, requestId, outlineId, selections, confirmApproval: true };
}

export type FindingSelection = { outlineId: string; selections: Array<{ reviewId: string; index: number }> };

export function readFindingReferences(value: unknown): FindingSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Select takeaways from this review.");
  const body = value as Record<string, unknown>;
  const outlineId = readId(body.outlineId);
  if (!Array.isArray(body.selections) || body.selections.length < 1 || body.selections.length > 50) {
    return invalid("Select between 1 and 50 cited findings.");
  }
  const selections = body.selections.map(item => {
    if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index > 9) return invalid("Select valid takeaways.");
    return { reviewId: readId(item.reviewId), index: Number(item.index) };
  }).sort((a, b) => a.reviewId.localeCompare(b.reviewId) || a.index - b.index);
  if (new Set(selections.map(s => `${s.reviewId}:${s.index}`)).size !== selections.length) return invalid("Select each takeaway once.");
  return { outlineId, selections };
}

export interface OutlineAnnotation {
  note: string;
  title: string;
  summary: string;
  version: number;
}
export interface AppliedTakeaway {
  index: number;
  insightId: string;
  status: string;
  reused: boolean;
}
export interface OutlineBatch {
  reviewId: string;
  jobId?: string;
  snapshot: KnowledgeExtractionSnapshot;
  result: KnowledgeExtractionResult | null;
  model: string;
  status: string;
  error: string | null;
  stale: boolean | null;
  applied: AppliedTakeaway[];
}
export interface KnowledgeOutline {
  id: string;
  createdAt: string;
  sourceId: string;
  stale: boolean;
  provider: "location_order" | "openai" | "subscription";
  batches: OutlineBatch[];
  annotations: Record<string, OutlineAnnotation>;
  triage?: Record<string, "kept" | "hidden">;
}

export type EvidenceUnit = KnowledgeExtractionSnapshot["units"][number];
interface OutlineCitation {
  quote: string;
  index: number;
  type: EvidenceUnit["evidenceType"];
  start: number | null;
  end: number | null;
  startChar: number | null;
}
export interface OutlineTakeaway {
  key: string;
  selection: { reviewId: string; index: number };
  statement: string;
  curation?: import("./knowledge-extraction-policy").FindingCuration;
  unverified: boolean;
  references: Array<{ reviewId: string; index: number }>;
  alternateStatements?: string[];
  citations: OutlineCitation[];
  applied?: AppliedTakeaway;
}
export interface OutlineTopic {
  key: string;
  title: string;
  branches: OutlineTopic[];
  takeaways: OutlineTakeaway[];
  summary: string;
}
const findingKey = (reviewId: string, index: number) => `finding:${reviewId}:${index}`;
const normalizeTopic = (part: string) => part.trim().replace(/\s+/gu, " ").toLowerCase();

/** The display merges matching assertions while retaining each immutable finding reference. */
function pointIdentity(finding: KnowledgeExtractionResult["findings"][number]) {
  const editorial = finding.curation;
  // Keep reported claims, examples and numeric qualifiers distinct unless the text itself is identical.
  if (editorial?.basis === "advice" && editorial.equivalentPoint && !/\d/.test(finding.statement)) {
    return JSON.stringify(["equivalent", finding.kind, normalizeTopic(editorial.use), editorial.equivalentPoint, /\b(?:no|not|never|avoid|without)\b/i.test(finding.statement)]);
  }
  return JSON.stringify(["exact", finding.kind, finding.statement]);
}

export function buildKnowledgeOutline(batches: OutlineBatch[]) {
  const topics: OutlineTopic[] = [];
  const units: EvidenceUnit[] = [];
  const takeaways = new Map<string, OutlineTakeaway>();
  const exact = new Map<string, OutlineTakeaway>();
  let covered = 0;
  for (const batch of batches) {
    const batchUnits = new Map(batch.snapshot.units.map(unit => [unit.id, unit]));
    units.push(...batch.snapshot.units);
    if (!batch.result) continue;
    covered += batch.snapshot.units.length;
    batch.result.findings.forEach((finding, index) => {
      const unit = batchUnits.get(finding.unitId);
      if (!unit || !finding.topicPath?.length || !finding.quote.trim() || !unit.text.includes(finding.quote)) return;
      const citation = { quote: finding.quote, index: unit.unitIndex, type: unit.evidenceType,
        start: unit.startSeconds, end: unit.endSeconds, startChar: unit.startChar };
      const identity = pointIdentity(finding);
      const exactKey = JSON.stringify([finding.kind, finding.statement]);
      const reference = { reviewId: batch.reviewId, index };
      const applied = batch.applied.find(item => item.index === index);
      const existing = exact.get(exactKey) ?? takeaways.get(identity);
      if (existing) {
        if (!existing.citations.some(c => c.index === citation.index && c.quote === citation.quote)) existing.citations.push(citation);
        existing.applied ??= applied;
        existing.unverified ||= finding.kind === "claim" || finding.curation?.basis === "speaker_claim";
        if (finding.curation?.featured && !existing.curation?.featured) existing.curation = finding.curation;
        existing.references.push(reference);
        if (existing.statement !== finding.statement && !existing.alternateStatements?.includes(finding.statement)) {
          (existing.alternateStatements ??= []).push(finding.statement);
        }
        exact.set(exactKey, existing);
        return;
      }
      let branches = topics;
      const path: string[] = [];
      let leaf: OutlineTopic | undefined;
      for (const part of finding.topicPath) {
        leaf = branches.find(topic => normalizeTopic(topic.title) === normalizeTopic(part));
        path.push(part);
        if (!leaf) {
          leaf = { key: `topic:${JSON.stringify(path)}`, title: part, branches: [], takeaways: [], summary: finding.statement };
          branches.push(leaf);
        }
        branches = leaf.branches;
      }
      const takeaway: OutlineTakeaway = { key: findingKey(batch.reviewId, index), selection: { reviewId: batch.reviewId, index },
        statement: finding.statement, curation: finding.curation, unverified: finding.kind === "claim" || finding.curation?.basis === "speaker_claim",
        references: [reference], citations: [citation], applied };
      takeaways.set(identity, takeaway);
      exact.set(exactKey, takeaway);
      leaf?.takeaways.push(takeaway);
    });
  }
  const allTakeaways = [...takeaways.values()];
  const featured = new Map<string, { title: string; items: OutlineTakeaway[] }>();
  for (const item of allTakeaways) {
    if (!item.curation?.featured) continue;
    const title = item.curation.use;
    const key = normalizeTopic(title);
    const group = featured.get(key) ?? { title, items: [] };
    group.items.push(item);
    featured.set(key, group);
  }
  return { topics, units, covered, allTakeaways, featured: [...featured.values()], duplicates: batches.reduce((sum, batch) => sum + (batch.result?.findings.length ?? 0), 0) - takeaways.size };
}

export function evidenceTime(start: number | null, end: number | null) {
  if (start === null) return null;
  const format = (seconds: number) => {
    const t = Math.floor(seconds);
    const minutes = Math.floor(t / 60);
    const secondsPart = String(t % 60).padStart(2, "0");
    return minutes < 60 ? `${minutes}:${secondsPart}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${secondsPart}`;
  };
  return end !== null && Math.floor(end) > Math.floor(start) ? `${format(start)}–${format(end)}` : format(start);
}
