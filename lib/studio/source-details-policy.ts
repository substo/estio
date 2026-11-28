import { readSourceMeta, type SourceComment, type SourceMeta } from "./youtube-source-meta";

export const SOURCE_DETAILS_LIMIT = 250;
export const SOURCE_DETAILS_BATCH = 8;
export const SOURCE_DETAILS_OUTCOMES = ["reached_end", "limited", "unavailable", "interrupted"] as const;
export type SourceDetailsOutcome = typeof SOURCE_DETAILS_OUTCOMES[number];
export type SourceDetailsMetadata = Omit<SourceMeta, "comments" | "commentsError"> & { description: string; channelUrl: string | null };
export type SourceDetailsRow = SourceComment & { id: string; parentId: string | null; published: string | null };
export type SourceDetailsBatch = { meta?: SourceDetailsMetadata; rows?: SourceDetailsRow[]; outcome?: SourceDetailsOutcome; reason?: string; unresolved?: number };
export type SourceDetailsState = {
  status: "idle" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error: string | null;
  meta: SourceDetailsMetadata | null;
  rows: SourceDetailsRow[];
  fetchedComments: number;
  fetchedReplies: number;
  outcome: SourceDetailsOutcome | null;
  reason: string | null;
};

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const trim = (value: unknown, length: number) => typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, length) : "";
const id = (value: unknown) => typeof value === "string" && /^[\w:-]{1,200}$/.test(value) ? value : null;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function readSourceDetailsMeta(value: unknown): SourceDetailsMetadata | null {
  const input = object(value);
  const parsed = readSourceMeta(input);
  if (!input || !parsed) return null;
  const { comments: _comments, commentsError: _commentsError, ...meta } = parsed;
  const channelUrl = trim(input.channelUrl, 500);
  return {
    ...meta,
    description: trim(input.description, 5000),
    channelUrl: /^https:\/\/www\.youtube\.com\/(?:channel\/[\w-]+|@[\p{L}\p{N}_.%-]+)$/u.test(channelUrl) ? channelUrl : null,
  };
}

export function readSourceDetailsRows(value: unknown, limit = SOURCE_DETAILS_LIMIT): SourceDetailsRow[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const rows: SourceDetailsRow[] = [];
  for (const item of value) {
    const row = object(item);
    if (!row) return null;
    const rowId = id(row.id);
    const parentId = id(row.parentId);
    const text = trim(row.text, 600);
    if (!rowId || !text || (row.parentId != null && (!parentId || parentId === rowId))) return null;
    rows.push({
      id: rowId, parentId, text, author: trim(row.author, 80) || "Unknown", likes: count(row.likes), replies: count(row.replies),
      at: null, published: trim(row.published, 100) || null, pinned: row.pinned === true, byUploader: row.byUploader === true,
    });
  }
  return rows;
}

export function readSourceDetailsOutcome(value: unknown): SourceDetailsOutcome | null {
  return SOURCE_DETAILS_OUTCOMES.find(outcome => outcome === value) ?? null;
}

export function sourceDetailsCount(comments: number, replies: number) {
  return `${comments.toLocaleString("en-GB")} ${comments === 1 ? "comment" : "comments"} and ${replies.toLocaleString("en-GB")} ${replies === 1 ? "reply" : "replies"}`;
}
