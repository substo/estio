"use client";

import { useActionState, useState } from "react";
import { saveLibraryAction } from "../(tenant)/library/actions";

export function LibraryRecordForm({ locationId, recordId, version, kind = "reference", title = "", payload = {} }: {
  locationId: string; recordId: string; version: number;
  kind?: "reference" | "channel"; title?: string; payload?: Record<string, unknown>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    ["title", "url", "summary", "notes", "transcript", "platform"].map((field) => [field, field === "title" ? title : typeof payload[field] === "string" ? payload[field] as string : ""]),
  ));
  const [recordKind, setRecordKind] = useState(kind);
  const [approved, setApproved] = useState(payload.approved === true);
  const [archived, setArchived] = useState(payload.archived === true);
  const [state, action, pending] = useActionState(saveLibraryAction.bind(null, locationId, recordId, version), {});
  const inputClass = "mt-1 w-full rounded-md border bg-background p-3 text-sm";
  return (
    <form action={action} className="space-y-5 rounded-xl border bg-card p-6">
      <label className="block text-sm font-medium">Type
        <select name="kind" value={recordKind} onChange={(event) => setRecordKind(event.target.value as typeof kind)} disabled={version > 0} className={inputClass}>
          <option value="reference">Library source</option><option value="channel">Channel</option>
        </select>
        {version > 0 ? <input type="hidden" name="kind" value={recordKind} /> : null}
      </label>
      {[{ name: "title", label: "Title", max: 180 }, { name: "url", label: "Source URL", max: 20_000 }, { name: "platform", label: "Platform", max: 200 }].map(({ name, label, max }) => (
        <label key={name} className="block text-sm font-medium">{label}
          <input name={name} value={values[name]} required={name === "title"} maxLength={max} onChange={(event) => setValues({ ...values, [name]: event.target.value })} className={inputClass} />
        </label>
      ))}
      {[{ name: "summary", label: "Summary", rows: 3 }, { name: "notes", label: "Research notes", rows: 6 }, { name: "transcript", label: "Verbatim transcript", rows: 10 }].map(({ name, label, rows }) => (
        <label key={name} className="block text-sm font-medium">{label}
          <textarea name={name} rows={rows} value={values[name]} maxLength={name === "transcript" ? 100_000 : 20_000} onChange={(event) => setValues({ ...values, [name]: event.target.value })} className={inputClass} />
        </label>
      ))}
      <input type="hidden" name="approvedPresent" value="1" /><input type="hidden" name="archivedPresent" value="1" />
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input name="approved" type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />Reviewed and approved</label>
        <label className="flex items-center gap-2"><input name="archived" type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Archived</label>
      </div>
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <button disabled={pending} type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save record"}</button>
    </form>
  );
}
