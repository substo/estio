import { StudioCommandError } from "./command-error";
import type { KnowledgeExtractionResult, KnowledgeExtractionSnapshot } from "./knowledge-extraction-policy";
import { readStudioTextProvider } from "./text-provider";

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
      || (provider === "subscription" ? body.confirmSubscription !== true : body.confirmPaid !== true)) {
      return invalid("Choose saved evidence and authorize its processing.");
    }
    return { action: "enqueueOutline" as const, requestId, sourceId, expectedVersion: Number(body.expectedVersion),
      mode, inputId, provider, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription" };
  }
  const outlineId = readId(body.outlineId);
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
  if (body.action !== "approve" || body.confirmApproval !== true || !Array.isArray(body.selections)
    || body.selections.length < 1 || body.selections.length > 50) return invalid("Select up to 50 takeaways to approve.");
  const selections = body.selections.map(item => {
    if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index > 9) return invalid("Select valid takeaways.");
    return { reviewId: readId(item.reviewId), index: Number(item.index) };
  }).sort((a, b) => a.reviewId.localeCompare(b.reviewId) || a.index - b.index);
  if (new Set(selections.map(s => `${s.reviewId}:${s.index}`)).size !== selections.length) return invalid("Select each takeaway once.");
  return { action: "approve" as const, requestId, outlineId, selections, confirmApproval: true };
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
  provider: "openai" | "subscription";
  batches: OutlineBatch[];
  annotations: Record<string, OutlineAnnotation>;
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

/** Merge exact statements only; alternate verifiable citations remain available in the review. */
export function buildKnowledgeOutline(batches: OutlineBatch[]) {
  const topics: OutlineTopic[] = [];
  const units: EvidenceUnit[] = [];
  const takeaways = new Map<string, OutlineTakeaway>();
  let covered = 0;
  for (const batch of batches) {
    const batchUnits = new Map(batch.snapshot.units.map(unit => [unit.id, unit]));
    units.push(...batch.snapshot.units);
    if (!batch.result) continue;
    covered += batch.snapshot.units.length;
    batch.result.findings.forEach((finding, index) => {
      const unit = batchUnits.get(finding.unitId);
      if (!unit || !finding.topicPath?.length) return;
      const citation = { quote: finding.quote, index: unit.unitIndex, type: unit.evidenceType,
        start: unit.startSeconds, end: unit.endSeconds, startChar: unit.startChar };
      const identity = JSON.stringify([finding.kind, finding.statement]);
      const applied = batch.applied.find(item => item.index === index);
      const existing = takeaways.get(identity);
      if (existing) {
        if (!existing.citations.some(c => c.index === citation.index && c.quote === citation.quote)) existing.citations.push(citation);
        existing.applied ??= applied;
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
        statement: finding.statement, citations: [citation], applied };
      takeaways.set(identity, takeaway);
      leaf?.takeaways.push(takeaway);
    });
  }
  return { topics, units, covered, duplicates: batches.reduce((sum, batch) => sum + (batch.result?.findings.length ?? 0), 0) - takeaways.size };
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
