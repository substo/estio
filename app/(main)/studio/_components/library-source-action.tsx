"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
export function LibrarySourceAction({ locationId, url, sourceId, sourceVersion, label, variant }: { locationId: string; url: string; sourceId?: string; sourceVersion?: number; label?: string; variant?: "default" | "outline" }) {
  const key = useRef<string | null>(null); const [pending, setPending] = useState(false); const [message, setMessage] = useState(''); const router = useRouter();
  return <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant={variant ?? "outline"} disabled={pending} onClick={async () => {
    setPending(true); setMessage(''); key.current ||= crypto.randomUUID();
    try { const response = await fetch('/api/studio/library/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Tenant': locationId }, body: JSON.stringify({input:url, idempotencyKey:key.current, sourceId, sourceVersion}) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Try again.');
      key.current = null;
      setMessage(result.summaryError || (sourceId ? 'Channel saved in Studio. Monitoring remains unchanged.' : 'Summary requested from saved evidence.')); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect. Retry.'); } finally { setPending(false); }
  }}>{pending ? 'Saving…' : sourceId ? 'Watch channel in Studio' : label ?? 'Summarize'}</Button>{message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}</div>;
}
