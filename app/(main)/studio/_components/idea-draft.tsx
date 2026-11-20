"use client";
import { useActionState, useId } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createSourceIdeaAction } from "../(tenant)/content/actions";
import type { IdeaProposal } from "./source-workspace";

export function IdeaDraft({ locationId, sourceId, ideaId, initial, onCancel }: { locationId: string; sourceId: string; ideaId: string; initial: IdeaProposal; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createSourceIdeaAction.bind(null, locationId, sourceId, ideaId, initial.draftReviewId), {});
  const titleId = useId();
  return <form action={action} className="space-y-3 rounded-lg border bg-card p-4 text-sm">
    <p className="font-medium">Proposed idea: review before it is created</p>
    <p className="text-xs text-muted-foreground">{initial.ai ? "Proposed by the assistant from this source. Edit freely." : "Assembled from your own words, not generated."} This source is linked as research.</p>
    {initial.evidence?.length ? <ul className="space-y-1 border-l-2 pl-3 text-xs">{initial.evidence.map(e => <li key={e.href}><Link href={e.href} className="text-primary underline">{e.label}</Link> · “{e.quote}”</li>)}</ul> : null}
    {initial.limitations?.length ? <div className="space-y-1 text-sm">
      <p className="font-medium">Verify before filming</p>
      <ul className="list-disc pl-5 text-muted-foreground">{initial.limitations.map(item => <li key={item}>{item}</li>)}</ul>
    </div> : null}
    <label className="block text-xs font-medium" htmlFor={titleId}>Idea title</label>
    <input id={titleId} data-idea-draft-title name="title" required maxLength={180} defaultValue={initial.title} className="block w-full rounded-md border bg-background p-2 text-sm" />
    <label className="block text-xs font-medium">Concept and audience promise<textarea name="summary" required maxLength={20_000} rows={6} defaultValue={initial.summary} className="mt-1 block w-full rounded-md border bg-background p-2 text-sm" /></label>
    {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create linked idea"}</Button><Button type="button" variant="ghost" onClick={onCancel}>Discard</Button></div>
  </form>;
}
