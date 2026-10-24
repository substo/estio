import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { inspectLegacyKnowledge } from "./inspect-knowledge";
import { canonicalKnowledgeJson, type KnowledgeIssue, type KnowledgeJson } from "./legacy-knowledge";
import { hashSourceFile, sameIdentity, SourceSnapshotError } from "./source-snapshot";

/**
 * Knowledge media is frame images only. Evidence frames are the copies the
 * local app keeps in `knowledge-media/`; source-unit frames point into
 * `frames/<transcription id>/`. OCR is text already inside the imported unit
 * and sidecar payloads, and extracted audio is a temporary work file that no
 * imported row references, so neither has bytes to reconcile.
 */
const MAX_FRAME_BYTES = 50 * 1024 * 1024;
const MAX_REFERENCES = 250_000;
const MAX_BATCH_BYTES = 64 * 1024 ** 3;
const frameName = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}\.(jpe?g|png|webp)$/i;
const transcriptionSegment = /^[A-Za-z0-9_-]{1,128}$/;
const contentTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export interface KnowledgeMediaReference {
  refKind: "evidence" | "unit"; refId: string; frameFile: string; relativePath: string | null;
  contentType: string | null; byteSize: number | null; sha256: string | null;
  status: "hashed" | "missing" | "unsafe" | "oversized";
}
export interface KnowledgeMediaManifest {
  schema: "studio.legacy-knowledge-media.v1"; mode: "dry-run"; sourceDigest: string;
  knowledgeSourceDigest: string; librarySourceDigest: string; knowledgeValid: boolean;
  snapshotCheckedUnchanged: true; hostedReconciled: false; valid: boolean;
  references: KnowledgeMediaReference[];
  counts: { references: number; hashed: number; missing: number; unsafe: number; hashedBytes: number };
  issues: KnowledgeIssue[];
}

const statOrMissing = (file: string) => lstat(file, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
  throw error;
});

export async function inspectLegacyKnowledgeMedia(dataDirectory: string, hashFile = hashSourceFile): Promise<KnowledgeMediaManifest> {
  const dataDir = await realpath(dataDirectory);
  const rootBefore = await lstat(dataDir, { bigint: true });
  const knowledge = await inspectLegacyKnowledge(dataDir);
  const wanted: Array<Omit<KnowledgeMediaReference, "contentType" | "byteSize" | "sha256" | "status">> = [];
  for (const row of knowledge.evidence) {
    const frame = typeof row.frame_file === "string" ? row.frame_file : "";
    if (frame) wanted.push({ refKind: "evidence", refId: String(row.id).toLowerCase(), frameFile: frame,
      relativePath: frameName.test(frame) ? `knowledge-media/${frame}` : null });
  }
  for (const row of knowledge.sourceUnits) {
    const unit = (row.payload as { unit?: { frameFile?: unknown } } | undefined)?.unit;
    const frame = typeof unit?.frameFile === "string" ? unit.frameFile : "";
    const transcription = String(row.transcription_id ?? "");
    if (frame) wanted.push({ refKind: "unit", refId: String(row.id).toLowerCase(), frameFile: frame,
      relativePath: frameName.test(frame) && transcriptionSegment.test(transcription) ? `frames/${transcription}/${frame}` : null });
  }
  if (wanted.length > MAX_REFERENCES) throw new SourceSnapshotError("knowledge_media_reference_limit_exceeded");

  // Hash each distinct path once; several references may share one frame.
  const seen = new Map<string, { info: BigIntStats | null; status: KnowledgeMediaReference["status"]; sha256: string | null; byteSize: number | null }>();
  let hashedBytes = 0;
  for (const ref of wanted) {
    if (!ref.relativePath || seen.has(ref.relativePath)) continue;
    const absolute = path.join(dataDir, ref.relativePath);
    const info = await statOrMissing(absolute);
    let status: KnowledgeMediaReference["status"]; let sha256: string | null = null;
    if (!info) status = "missing";
    else if (!info.isFile() || info.isSymbolicLink() || await realpath(absolute) !== absolute) status = "unsafe";
    else if (info.size > BigInt(MAX_FRAME_BYTES)) status = "oversized";
    else {
      if ((hashedBytes += Number(info.size)) > MAX_BATCH_BYTES) throw new SourceSnapshotError("knowledge_media_batch_byte_limit_exceeded");
      const fingerprint = await hashFile(absolute, ref.relativePath, MAX_FRAME_BYTES);
      if (!sameIdentity(info, fingerprint.identity)) throw new SourceSnapshotError("source_changed_during_preview");
      status = "hashed"; sha256 = fingerprint.sha256;
    }
    seen.set(ref.relativePath, { info, status, sha256, byteSize: info?.isFile() ? Number(info.size) : null });
  }
  for (const [relative, captured] of seen) {
    const now = await statOrMissing(path.join(dataDir, relative));
    if (captured.info === null ? now !== null : now === null || !sameIdentity(captured.info, now)) throw new SourceSnapshotError("source_changed_during_preview");
  }
  if (!sameIdentity(rootBefore, await lstat(dataDir, { bigint: true }))) throw new SourceSnapshotError("source_changed_during_preview");

  const references: KnowledgeMediaReference[] = wanted.map(ref => {
    const found = ref.relativePath ? seen.get(ref.relativePath)! : null;
    const status = found?.status ?? "unsafe";
    return { ...ref, status, sha256: found?.sha256 ?? null, byteSize: status === "hashed" ? found!.byteSize : null,
      contentType: status === "hashed" ? contentTypes[ref.frameFile.split(".").pop()!.toLowerCase()] : null };
  }).sort((a, b) => a.refKind.localeCompare(b.refKind) || a.refId.localeCompare(b.refId));

  // A frame already absent locally cannot be recovered; it is reported but does
  // not block the rest. Unsafe or oversized files need review and block.
  const issues: KnowledgeIssue[] = [
    ...(knowledge.valid ? [] : [{ code: "knowledge_preview_invalid", path: "knowledge.sqlite", severity: "error" as const }]),
    ...references.filter(r => r.status !== "hashed").map(r => ({ code: `media_${r.status}`, path: `${r.refKind}:${r.refId}`, severity: r.status === "missing" ? "warning" as const : "error" as const })),
  ].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  return {
    schema: "studio.legacy-knowledge-media.v1", mode: "dry-run",
    sourceDigest: createHash("sha256").update(canonicalKnowledgeJson({ knowledgeSourceDigest: knowledge.sourceDigest, references: references as unknown as KnowledgeJson })).digest("hex"),
    knowledgeSourceDigest: knowledge.sourceDigest, librarySourceDigest: knowledge.librarySource.sourceDigest, knowledgeValid: knowledge.valid,
    snapshotCheckedUnchanged: true, hostedReconciled: false, valid: !issues.some(issue => issue.severity === "error"), references,
    counts: { references: references.length, hashed: references.filter(r => r.status === "hashed").length, missing: references.filter(r => r.status === "missing").length,
      unsafe: references.filter(r => r.status === "unsafe" || r.status === "oversized").length,
      hashedBytes: [...seen.values()].reduce((sum, f) => sum + (f.status === "hashed" ? f.byteSize! : 0), 0) },
    issues,
  };
}
