"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { libraryPresentation, safeLibraryPresentationImage } from "@/lib/studio/library-presentation";
import type { LibraryCardRecord } from "./library-cards";

const STORAGE_KEY = "studio-library-enrichment-v1";
const LIMIT = 200;
const attempts = new Map<string, string>();
type AttemptStorage = Pick<Storage, "getItem" | "setItem">;
export function enrichmentCandidates(records: LibraryCardRecord[]) {
  return records.filter(record => {
    const p = record.payload || {};
    const evidence = p.importEvidence as { fetchedAt?: unknown; enrichmentStatus?: unknown } | undefined;
    if (evidence?.fetchedAt || evidence?.enrichmentStatus === "complete" || evidence?.enrichmentStatus === "missing_description") return false;
    const item = libraryPresentation(record);
    // Do not count the deterministic YouTube fallback as fetched metadata.
    const actualThumbnail = safeLibraryPresentationImage(p.thumbnailUrl || p.thumbnail_url || p.thumbnail || p.imageUrl || p.image_url || p.avatarUrl || p.avatar_url);
    return !!item.url && (!actualThumbnail || !p.platform || !p.format || !item.creator || !(p.description || p.sourceDescription || p.source_description));
  });
}
export function enrichmentAttempt(locationId: string, recordId: string, storage: AttemptStorage | undefined, uuid: () => string): string | null {
  const identity = `${locationId}:${recordId}`;
  if (attempts.has(identity)) return null;
  let saved: [string, string][] = [];
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(parsed)) saved = parsed.filter((item): item is [string, string] => Array.isArray(item) && item.length === 2 && item.every(value => typeof value === "string")).slice(-LIMIT);
  } catch { /* Privacy settings must not break the Library. */ }
  if (saved.some(([key]) => key === identity)) return null;
  const key = uuid();
  attempts.set(identity, key);
  while (attempts.size > LIMIT) attempts.delete(attempts.keys().next().value!);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify([...saved, [identity, key]].slice(-LIMIT))); } catch { /* In-memory suppression remains available. */ }
  return key;
}

export async function runLibraryEnrichment({ records, locationId, signal, claim, fetcher, progress }: {
  records: LibraryCardRecord[]; locationId: string; signal: AbortSignal;
  claim: (recordId: string) => string | null;
  fetcher: typeof fetch; progress: (completed: number, saved: number) => void;
}) {
  let completed = 0, saved = 0;
  for (const record of enrichmentCandidates(records)) {
    if (signal.aborted || completed >= 5) break;
    const idempotencyKey = claim(record.id);
    if (!idempotencyKey) continue;
    const input = libraryPresentation(record).url!;
    // One bounded retry uses the same key when the response was lost or transient.
    for (let retry = 0; retry < 2 && !signal.aborted; retry++) {
      try {
        const response = await fetcher("/api/studio/library/import", { method: "POST", signal, headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ input, idempotencyKey }) });
        if (response.status >= 500 && retry === 0) continue;
        const result = await response.json();
        if (response.ok && result.recordId && !result.error) saved++;
        break;
      } catch { if (signal.aborted || retry === 1) break; }
    }
    completed++;
    if (!signal.aborted) progress(completed, saved);
  }
  return { completed, saved };
}

export function LibraryAutoEnrich({ locationId, records }: { locationId: string; records: LibraryCardRecord[] }) {
  const router = useRouter();
  const started = useRef(false);
  const initialRecords = useRef(records);
  const [progress, setProgress] = useState<{ completed: number; saved: number; done: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Defer claiming until React's development effect replay has finished.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted || started.current) return;
      started.current = true;
      let storage: Storage | undefined;
      try { storage = window.sessionStorage; } catch { /* Storage can be blocked. */ }
      if (enrichmentCandidates(initialRecords.current).length) setProgress({ completed: 0, saved: 0, done: false });
      const result = await runLibraryEnrichment({ records: initialRecords.current, locationId, signal: controller.signal,
        claim: id => enrichmentAttempt(locationId, id, storage, () => crypto.randomUUID()), fetcher: fetch,
        progress: (completed, saved) => setProgress({ completed, saved, done: false }) });
      if (controller.signal.aborted) return;
      setProgress(result.completed ? { ...result, done: true } : null);
      if (result.saved) router.refresh();
    });
    return () => controller.abort();
  }, [locationId, router]);
  if (!progress || progress.done) return null;
  return <p role="status" className="text-xs text-muted-foreground">{`Updating saved source details… ${progress.completed} checked`}</p>;
}
