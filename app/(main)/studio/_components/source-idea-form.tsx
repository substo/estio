"use client";
import { useActionState } from "react";
import { createSourceIdeaAction } from "../(tenant)/content/actions";

export function SourceIdeaForm({ locationId, sourceId, ideaId }: { locationId: string; sourceId: string; ideaId: string }) {
  const [state, action, pending] = useActionState(createSourceIdeaAction.bind(null, locationId, sourceId, ideaId, undefined), {});
  return <form action={action} className="mt-3 space-y-3 text-sm">
    <p className="text-muted-foreground">Develop an original concept for your business. This source will be linked as research; no text or approvals are copied.</p>
    <label className="block font-medium">Idea title<input name="title" required maxLength={180} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
    <label className="block font-medium">Concept and audience promise<textarea name="summary" required maxLength={20_000} rows={3} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
    {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
    <button disabled={pending} className="rounded-md border px-3 py-2 disabled:opacity-50">{pending ? "Creating…" : "Create idea with this source"}</button>
  </form>;
}
