"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { MacStatus } from "@/lib/studio/workspace/mac-status";

const dot = { ok: "bg-emerald-500", warn: "bg-amber-500", off: "bg-muted-foreground" } as const;
/** Names exactly what the Mac is missing and offers a Recheck that re-reads the device report. */
export function MacChip({ status }: { status: MacStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <details className="relative">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        <span aria-hidden className={`h-2 w-2 rounded-full ${dot[status.tone]}`} /><span>{status.label}</span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-72 space-y-2 rounded-lg border bg-background p-3 text-sm shadow-md">
        <p>{status.detail}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending} onClick={() => start(() => router.refresh())} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-60">{pending ? "Checking…" : "Recheck"}</button>
          {status.href ? <Link href={status.href} className="text-primary hover:underline">Open Devices</Link> : null}
        </div>
      </div>
    </details>
  );
}
