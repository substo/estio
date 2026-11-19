"use client";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { createSourceIdeaAction } from "../(tenant)/content/actions";
import type { IdeaProposal } from "./source-workspace";

export function IdeaDraft({ locationId, sourceId, ideaId, initial, onCancel }: { locationId: string; sourceId: string; ideaId: string; initial: IdeaProposal; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createSourceIdeaAction.bind(null, locationId, sourceId, ideaId), {});
  const titleId = useId();
  return <form action={action} className="space-y-3 rounded-lg border bg-card p-4 text-sm">
    <p className="font-medium">Proposed idea: review before it is created</p>
    <p className="text-xs text-muted-foreground">{initial.ai ? "Proposed by the assistant from this source. Edit freely." : "Assembled from your own words, not generated."} This source is linked as research; nothing is copied or approved.</p>
    <label className="block text-xs font-medium" htmlFor={titleId}>Idea title</label>
    <input id={titleId} name="title" required maxLength={180} defaultValue={initial.title} className="block w-full rounded-md border bg-background p-2 text-sm" />
    <label className="block text-xs font-medium">Concept and audience promise<textarea name="summary" required maxLength={20_000} rows={6} defaultValue={initial.summary} className="mt-1 block w-full rounded-md border bg-background p-2 text-sm" /></label>
    {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create linked idea"}</Button><Button type="button" variant="ghost" onClick={onCancel}>Discard</Button></div>
  </form>;
}
