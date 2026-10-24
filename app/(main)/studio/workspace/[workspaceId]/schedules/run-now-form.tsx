"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
export function ScheduleRunNowForm({ workspaceId, scheduleId, version, stateVersion, isScript, ideas }: {
  workspaceId: string; scheduleId: string; version: number; stateVersion: number; isScript: boolean;
  ideas: Array<{ id: string; title: string; version: number }>;
}) {
  const router = useRouter();
  const command = useStudioCommand(`/studio/workspace/${workspaceId}/schedules/api`);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"run_now" | "enable">("run_now");
  const [confirmed, setConfirmed] = useState(false);
  const max = isScript ? 1 : 5;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await command.run({ action: mode, scheduleId, version, stateVersion, requestId: crypto.randomUUID(),
      ideas: ideas.filter(i => selected.includes(i.id)).map(i => ({ id: i.id, version: Number(i.version) })), confirmPaid: confirmed, confirmRecurringPaid: confirmed });
    if (result?.ok) {
      if (mode === "enable") { router.refresh(); setConfirmed(false); return; }
      router.push(`/studio/workspace/${workspaceId}/content/${result.data.workflow === "script_brief" ? "script-briefs" : "idea-reviews"}/${result.data.reviewId}`);
      router.refresh();
    }
  }
  return <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5 text-sm">
    <h2 className="text-xl font-medium">Run this saved workflow</h2>
    <fieldset disabled={command.pending || command.retry} className="space-y-4">
      <legend>Select {isScript ? "one current idea" : "one to five current ideas"}</legend>
      <label className="block">Execution<select className="ml-2 rounded border bg-background p-2" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setConfirmed(false); }}>
        <option value="run_now">Run once now</option><option value="enable">Enable recurring paid runs</option>
      </select></label>
      <div className="max-h-72 space-y-2 overflow-y-auto">{ideas.map(idea => <label key={idea.id} className="flex items-start gap-2">
        <input type="checkbox" checked={selected.includes(idea.id)} disabled={!selected.includes(idea.id) && selected.length >= max}
          onChange={event => setSelected(current => event.target.checked ? [...current, idea.id] : current.filter(id => id !== idea.id))} />{idea.title}
      </label>)}</div>
      <p className="text-muted-foreground">Showing up to 100 recently updated unarchived ideas. This run uses the saved schedule focus, selected idea notes and excerpts from up to three linked records per idea. Script briefs require saved supporting research text. Results remain proposals for human review.</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />
        <span>{mode === "enable" ? "I authorize recurring paid runs at this saved cadence, using these pinned inputs and the workspace OpenAI key and budget, until paused. Each provider call reserves $0.01, then settles metered usage." : "I authorize this paid run using the workspace OpenAI key and budget. Before a provider call, it reserves $0.01 and then settles metered usage."} Uncertain outcomes retain their hold for manager review.</span></label>
      <p>{mode === "enable" ? "Recurring runs retain these exact inputs. Editing the definition or inputs requires reauthorization. Missed occurrences run at most once; active work skips an occurrence. Revocation and unresolved charges stop recurrence. Pausing stops future paid attempts, but cannot undo a call already in flight." : "Running now does not enable recurrence. One active run per schedule is allowed; resolve uncertain charges through the existing job before starting another."}</p>
    </fieldset>
    <button disabled={command.pending || (!command.retry && (!selected.length || !confirmed))} className="rounded-md border px-3 py-2 disabled:opacity-50">{command.pending ? "Queuing…" : command.retry ? "Retry same request" : mode === "enable" ? "Enable recurring runs" : "Run now"}</button>
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
  </form>;
}
export function RefreshScheduleHistory() {
  const router = useRouter();
  return <button className="rounded-md border px-3 py-2 text-sm" onClick={() => router.refresh()}>Refresh status</button>;
}

export function SchedulePauseForm({ workspaceId, scheduleId, version, stateVersion }: {
  workspaceId: string; scheduleId: string; version: number; stateVersion: number;
}) {
  const router = useRouter();
  const command = useStudioCommand(`/studio/workspace/${workspaceId}/schedules/api`);
  return <form onSubmit={async event => { event.preventDefault(); const result = await command.run({ action: "pause", scheduleId, version, stateVersion, requestId: crypto.randomUUID() }); if (result?.ok) router.refresh(); }} className="space-y-2">
    <button disabled={command.pending} className="rounded-md border px-3 py-2 text-sm">{command.pending ? "Pausing…" : command.retry ? "Retry same pause" : "Pause recurring runs"}</button>
    {command.error ? <p role="alert">{command.error}</p> : null}
  </form>;
}
