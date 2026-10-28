"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
export function ScheduleRunNowForm({ locationId, scheduleId, version, stateVersion, isScript, ideas, active }: {
  locationId: string; scheduleId: string; version: number; stateVersion: number; isScript: boolean;
  ideas: Array<{ id: string; title: string; version: number }>; active: boolean;
}) {
  const router = useRouter();
  const command = useStudioCommand(`/studio/schedules/api`);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"run_now" | "enable">("run_now");
  const [confirmed, setConfirmed] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const max = isScript ? 1 : 5;
  async function submit(next: "run_now" | "enable") {
    setMode(next);
    const result = await command.run({ action: next, scheduleId, version, stateVersion, requestId: crypto.randomUUID(),
      ideas: ideas.filter(i => selected.includes(i.id)).map(i => ({ id: i.id, version: Number(i.version) })), confirmPaid: confirmed, confirmRecurringPaid: recurring });
    if (result?.ok) {
      if (next === "enable") { router.refresh(); setRecurring(false); return; }
      router.push(`/studio/content/${result.data.workflow === "script_brief" ? "script-briefs" : "idea-reviews"}/${result.data.reviewId}`);
      router.refresh();
    }
  }
  const ready = selected.length > 0 && !command.pending;
  return <form onSubmit={event => event.preventDefault()} className="space-y-4 rounded-xl border bg-card p-5 text-sm">
    <h2 className="text-xl font-medium">Run now</h2>
    <fieldset disabled={command.pending || command.retry} className="space-y-4">
      <legend>Select {isScript ? "one current idea" : "one to five current ideas"}</legend>
      <div className="max-h-72 space-y-2 overflow-y-auto">{ideas.map(idea => <label key={idea.id} className="flex items-start gap-2">
        <input type="checkbox" checked={selected.includes(idea.id)} disabled={!selected.includes(idea.id) && selected.length >= max}
          onChange={event => setSelected(current => event.target.checked ? [...current, idea.id] : current.filter(id => id !== idea.id))} />{idea.title}
      </label>)}</div>
      {!ideas.length ? <p className="text-muted-foreground">No current ideas yet. Add an idea in Content first.</p> : null}
      <p className="text-muted-foreground">Showing up to 100 recently updated unarchived ideas. A run uses the saved schedule focus, selected idea notes and excerpts from up to three linked records per idea. Script briefs require saved supporting research text. Results remain proposals for human review.</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>I authorize this paid run using the Business OpenAI key and budget. Before a provider call, it reserves $0.01 and then settles metered usage. Uncertain outcomes retain their hold for manager review.</span></label>
    </fieldset>
    <p>Running now does not turn the schedule on. One active run per schedule is allowed; resolve uncertain charges through the existing job before starting another.</p>
    <button type="button" onClick={() => submit("run_now")} disabled={command.retry ? command.pending || mode !== "run_now" : !ready || !confirmed} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{command.pending && mode === "run_now" ? "Queuing…" : command.retry && mode === "run_now" ? "Retry same request" : "Run now"}</button>
    {!active ? <div className="space-y-3 border-t pt-4">
      <h3 className="font-medium">Turn on</h3>
      <label className="flex items-start gap-2"><input type="checkbox" checked={recurring} disabled={command.pending || command.retry} onChange={event => setRecurring(event.target.checked)} />
        <span>I authorize recurring paid runs at this saved frequency, using the selected ideas and the Business OpenAI key and budget, until turned off. Each provider call reserves $0.01, then settles metered usage.</span></label>
      <p className="text-muted-foreground">Recurring runs keep these exact inputs. Editing the draft or inputs turns the schedule off. Missed times run at most once; an active run skips a time. Turning off stops future paid attempts, but cannot undo a call already in flight.</p>
      <button type="button" onClick={() => submit("enable")} disabled={command.retry ? command.pending || mode !== "enable" : !ready || !recurring} className="rounded-md border px-3 py-2 disabled:opacity-50">{command.pending && mode === "enable" ? "Turning on…" : command.retry && mode === "enable" ? "Retry same request" : "Turn on"}</button>
    </div> : null}
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
  </form>;
}
export function RefreshScheduleHistory() {
  const router = useRouter();
  return <button className="rounded-md border px-3 py-2 text-sm" onClick={() => router.refresh()}>Refresh status</button>;
}

export function SchedulePauseForm({ locationId, scheduleId, version, stateVersion }: {
  locationId: string; scheduleId: string; version: number; stateVersion: number;
}) {
  const router = useRouter();
  const command = useStudioCommand(`/studio/schedules/api`);
  return <form onSubmit={async event => { event.preventDefault(); const result = await command.run({ action: "pause", scheduleId, version, stateVersion, requestId: crypto.randomUUID() }); if (result?.ok) router.refresh(); }} className="space-y-2">
    <button disabled={command.pending} className="rounded-md border px-3 py-2 text-sm">{command.pending ? "Turning off…" : command.retry ? "Retry turning off" : "Turn off"}</button>
    {command.error ? <p role="alert">{command.error}</p> : null}
  </form>;
}
