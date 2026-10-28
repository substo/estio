"use client";
import { useActionState, useState } from "react";
import { schedulePresets } from "@/lib/studio/schedule-policy";
import type { StudioSchedule } from "@/lib/studio/schedules";
import { saveScheduleAction } from "./actions";

export function ScheduleForm({ locationId, id, schedule }: { locationId: string; id: string; schedule?: StudioSchedule }) {
  const [state, action, pending] = useActionState(saveScheduleAction.bind(null, locationId, id, schedule?.version ?? 0), {});
  const [preset, setPreset] = useState(schedule?.preset_id ?? "idea-review");
  const [focus, setFocus] = useState(schedule?.focus ?? "");
  const [interval, setInterval] = useState(String(schedule?.interval_hours ?? 24));
  const [time, setTime] = useState(schedule?.daily_time ?? "09:00");
  const inputClass = "mt-1 w-full rounded-md border bg-background p-2";
  return <form action={action} className="space-y-4 rounded-xl border bg-card p-5" aria-label={schedule ? "Edit schedule draft" : "New schedule draft"}>
    <h2 className="text-lg font-medium">{schedule ? "Edit schedule draft" : "New schedule draft"}</h2>
    <label className="block text-sm">Workflow<select name="presetId" value={preset} onChange={event => setPreset(event.target.value as typeof preset)} className={inputClass}>
      {Object.entries(schedulePresets).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label className="block text-sm">Focus (optional)<input name="query" maxLength={160} value={focus} onChange={event => setFocus(event.target.value)} className={inputClass} /></label>
    <label className="block text-sm">Cadence<select name="intervalHours" value={interval} onChange={event => setInterval(event.target.value)} className={inputClass}>
      <option value="24">Daily at the chosen time</option><option value="168">Every seven days after a run</option>
    </select></label>
    <label className="block text-sm">Daily time · Asia/Nicosia<input name="dailyTime" type="time" required value={time} onChange={event => setTime(event.target.value)} className={inputClass} /></label>
    <p className="text-xs text-muted-foreground">Daily time applies to daily cadence. Seven-day cadence measures elapsed time after a run. These are drafts; saving does not activate a schedule.</p>
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    <button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save draft"}</button>
  </form>;
}
