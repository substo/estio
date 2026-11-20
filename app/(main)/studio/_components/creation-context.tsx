"use client";

import Link from "next/link";
import type { LinkedDraft } from "@/lib/studio/creation-policy";
import type { CreationRun } from "@/lib/studio/creation-text-policy";

export function CreationNextContext({ recordId, drafts, includeReferences, onReferences, draftId, onDraft, purpose, onPurpose }: {
  recordId: string; drafts: LinkedDraft[]; includeReferences: boolean; onReferences: (value: boolean) => void;
  draftId: string; onDraft: (value: string) => void; purpose: "compare" | "revise"; onPurpose: (value: "compare" | "revise") => void;
}) {
  const selected = drafts.find(draft => draft.id === draftId);
  return <details className="rounded-lg border px-3 text-sm">
    <summary className="min-h-11 cursor-pointer py-3 font-medium">Context for next run</summary>
    <div className="space-y-3 pb-3">
      <p>Uses the saved direction and brief, accepted earlier stages, available Business profile fields and a pinned template. Your feedback applies to this run.</p>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={includeReferences} onChange={event => onReferences(event.target.checked)} />Include linked reference evidence</label>
      <label className="block space-y-1 font-medium">Historic draft
        <select className="block min-h-11 w-full rounded-md border bg-background px-2 font-normal" value={draftId} onChange={event => onDraft(event.target.value)}>
          <option value="">Exclude all historic drafts</option>
          {drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.title} · v{draft.version}</option>)}
        </select>
      </label>
      {selected && <label className="block space-y-1 font-medium">Use the selected draft to
        <select className="block min-h-11 w-full rounded-md border bg-background px-2 font-normal" value={purpose} onChange={event => onPurpose(event.target.value as "compare" | "revise")}>
          <option value="compare">Compare with this work</option><option value="revise">Revise its writing</option>
        </select>
        <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/studio/content/${selected.id}`}>Open selected draft record</Link>
      </label>}
      <p className="text-muted-foreground">Saved notes stay with their records. Linked drafts enter context only when you choose one here.</p>
      <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/studio/records/${recordId}/links`}>Manage or unlink records</Link>
    </div>
  </details>;
}

export function CreationRunContext({ run }: { run: CreationRun }) {
  const snapshot = run.snapshot;
  if (!snapshot) return null;
  const subject = snapshot.ideas[0];
  return <details className="min-w-0 rounded-lg border px-3 text-sm">
    <summary className="min-h-11 cursor-pointer py-3 font-medium">Inputs used by this run</summary>
    <div className="space-y-3 pb-3">
      <p className="text-muted-foreground">Saved input for {subject.title} · content version {subject.version}. Next-run changes are separate.</p>
      <dl className="space-y-2 break-words">
        <dt className="font-medium">Author direction and instructions</dt>
        <dd className="whitespace-pre-wrap">{[snapshot.direction.publisher, snapshot.direction.viewer, snapshot.direction.goal, snapshot.direction.angle,
          snapshot.brief, snapshot.operation.feedback].filter(Boolean).join("\n") || "No additional instructions."}</dd>
        <dt className="font-medium">Business profile{snapshot.profile ? ` · v${snapshot.profile.version}` : ""}</dt>
        <dd>{snapshot.profile && Object.keys(snapshot.profile.context).length ? <ul className="space-y-1">
          {Object.entries(snapshot.profile.context).map(([label, value]) => <li key={label}>{label} · {String(value)}{snapshot.profile?.truncatedFields?.includes(label) ? " (truncated)" : ""}{snapshot.profile?.unconfirmedFields?.includes(label) ? " (unconfirmed)" : ""}</li>)}
        </ul> : "No profile fields supplied."}</dd>
        <dt className="font-medium">Historic draft</dt>
        <dd>{snapshot.priorDraft ? <><Link href={`/studio/content/${snapshot.priorDraft.id}`} className="text-primary underline">{snapshot.priorDraft.title}</Link> · v{snapshot.priorDraft.version} · {snapshot.priorDraft.purpose}{snapshot.priorDraft.truncated ? " · truncated excerpt" : ""}</> : "Historic drafts excluded."}</dd>
        <dt className="font-medium">Source passages and findings</dt>
        <dd>{snapshot.evidence.length} supplied · open Generation evidence for the saved quotes and citation markers.</dd>
      </dl>
      {snapshot.inputLimits?.length ? <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        {snapshot.inputLimits.map(limit => <li key={limit}>{limit}</li>)}
      </ul> : null}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-medium">Exact input data sent to the provider</summary>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
    </div>
  </details>;
}
