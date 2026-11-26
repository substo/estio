"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreItemAction } from "../bin-actions";

export function BinRestoreButton({ locationId, kind, id, name }: { locationId: string; kind: "content" | "upload"; id: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return <span className="inline-flex flex-col items-end">
    <button type="button" disabled={pending} aria-label={`Restore ${name}`} onClick={() => start(async () => { const r = await restoreItemAction(locationId, kind, id); if (!r.ok) setError(r.error); else router.refresh(); })}
      className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">{pending ? "Restoring…" : "Restore"}</button>
    {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
  </span>;
}
