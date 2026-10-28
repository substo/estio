"use client";
import { useActionState } from "react";
import type { RecordLinkAction } from "@/lib/studio/record-link-policy";
import { changeRecordLinkAction } from "./actions";
export function RecordLinkButton({ locationId, sourceId, targetId, version, operation, title }: {
  locationId: string; sourceId: string; targetId: string; version: number; operation: RecordLinkAction; title: string;
}) {
  const [state, action, pending] = useActionState(changeRecordLinkAction.bind(null, locationId, sourceId, targetId, version, operation), {});
  return <form action={action} className="space-y-2">
    <button type="submit" disabled={pending} aria-label={`${operation === "add" ? "Link" : "Unlink"} ${title}`}
      className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">{pending ? "Saving…" : operation === "add" ? "Link record" : "Unlink"}</button>
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    {state.success ? <p role="status" className="text-sm text-muted-foreground">Link updated.</p> : null}
  </form>;
}
