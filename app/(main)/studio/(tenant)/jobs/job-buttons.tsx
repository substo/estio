"use client";
import { useActionState } from "react";
import { jobAction, workerCheckAction } from "./actions";

export function JobActionButton({ workspaceId, jobId, action }: { workspaceId: string; jobId: string; action: "retry" | "cancel" }) {
  const [state, run, pending] = useActionState(jobAction.bind(null, workspaceId, jobId, action), {});
  return <form action={run} className="inline">
    <button disabled={pending} className="text-sm text-primary hover:underline disabled:opacity-50">{action === "retry" ? "Retry" : "Cancel"}</button>
    {state.error ? <span role="alert" className="ml-2 text-sm text-destructive">{state.error}</span> : null}
  </form>;
}

export function WorkerCheckButton({ workspaceId }: { workspaceId: string }) {
  const [state, run, pending] = useActionState(workerCheckAction.bind(null, workspaceId), {});
  return <form action={run} className="space-y-2">
    <button disabled={pending} className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50">{pending ? "Queuing…" : "Run worker check"}</button>
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : state.saved ? <p role="status" className="text-sm text-muted-foreground">{state.saved}</p> : null}
  </form>;
}
