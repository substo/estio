"use client";

import { useActionState, useState } from "react";
import { CONTENT_LEVELS, CONTENT_STAGES } from "@/lib/studio/content-policy";
import { saveContentAction } from "../(tenant)/content/actions";

export function ContentRecordForm({ locationId, recordId, version, title = "", payload = {} }: {
  locationId: string; recordId: string; version: number; title?: string; payload?: Record<string, unknown>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    ["title", "summary", "notes", "script"].map((field) => [field, field === "title" ? title : typeof payload[field] === "string" ? payload[field] as string : ""]),
  ));
  const [stage, setStage] = useState(Object.hasOwn(payload, "stage") ? String(payload.stage ?? "") : "idea");
  const [level, setLevel] = useState(Object.hasOwn(payload, "level") ? String(payload.level ?? "") : "discover");
  const [pillar, setPillar] = useState(payload.pillar == null ? "" : String(payload.pillar));
  const [approved, setApproved] = useState(payload.approved === true);
  const [archived, setArchived] = useState(payload.archived === true);
  const [state, action, pending] = useActionState(saveContentAction.bind(null, locationId, recordId, version), {});
  const inputClass = "mt-1 w-full rounded-md border bg-background p-3 text-sm";
  return (
    <form action={action} className="space-y-5 rounded-xl border bg-card p-6">
      <label className="block text-sm font-medium">Title<input name="title" value={values.title} required maxLength={180} onChange={(event) => setValues({ ...values, title: event.target.value })} className={inputClass} /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-medium">Content stage<select name="stage" value={stage} onChange={(event) => setStage(event.target.value)} className={inputClass}>
          {!CONTENT_STAGES.includes(stage as typeof CONTENT_STAGES[number]) ? <option value={stage}>Unrecognized: {stage}</option> : null}
          {CONTENT_STAGES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
        </select></label>
        <label className="text-sm font-medium">Audience stage<select name="level" value={level} onChange={(event) => setLevel(event.target.value)} className={inputClass}>
          {!CONTENT_LEVELS.includes(level as typeof CONTENT_LEVELS[number]) ? <option value={level}>Unrecognized: {level}</option> : null}
          {CONTENT_LEVELS.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
        </select></label>
        <label className="text-sm font-medium">Content pillar<select name="pillar" value={pillar} onChange={(event) => setPillar(event.target.value)} className={inputClass}>
          <option value="">Not set</option>{!["", "1", "2", "3", "4"].includes(pillar) ? <option value={pillar}>Unrecognized: {pillar}</option> : null}
          {[1, 2, 3, 4].map((value) => <option key={value} value={value}>Pillar {value}</option>)}
        </select></label>
      </div>
      {[{ name: "summary", label: "Idea summary", rows: 3 }, { name: "script", label: "Script", rows: 16 }, { name: "notes", label: "Production notes", rows: 6 }].map(({ name, label, rows }) => (
        <label key={name} className="block text-sm font-medium">{label}<textarea name={name} rows={rows} value={values[name]} maxLength={name === "script" ? 100_000 : 20_000} onChange={(event) => setValues({ ...values, [name]: event.target.value })} className={inputClass} /></label>
      ))}
      <input type="hidden" name="approvedPresent" value="1" /><input type="hidden" name="archivedPresent" value="1" />
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input name="approved" type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />Reviewed and approved</label>
        <label className="flex items-center gap-2"><input name="archived" type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Archived</label>
      </div>
      <p className="text-xs text-muted-foreground">Saved source links and attachments stay linked when you edit this piece. Ready marks work for review.</p>
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <button disabled={pending} type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save content piece"}</button>
    </form>
  );
}
