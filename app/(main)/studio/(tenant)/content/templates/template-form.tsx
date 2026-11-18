"use client";

import { useActionState, useRef, useState } from "react";
import { MAX_SCRIPT_TEMPLATE_BEATS, type ScriptTemplateDraft } from "@/lib/studio/script-template-policy";

type TemplateAction = (state: { error?: string }, form: FormData) => Promise<{ error?: string }>;
const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const buttonClass = "rounded-md border px-3 py-2 text-sm disabled:opacity-50";

export function ScriptTemplateForm({ initial, action }: { initial?: ScriptTemplateDraft; action: TemplateAction }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [beats, setBeats] = useState(() =>
    (initial?.beats ?? [{ name: "", guidance: "" }]).map((beat, key) => ({ ...beat, key })));
  const nextKey = useRef(beats.length);
  const [state, submit, pending] = useActionState(action, {});

  function moveBeat(from: number, to: number) {
    setBeats(current => {
      const reordered = [...current];
      const [beat] = reordered.splice(from, 1);
      reordered.splice(to, 0, beat);
      return reordered;
    });
  }

  return <form action={submit} className="space-y-5">
    <label className="block space-y-1 text-sm font-medium">
      <span>Name</span>
      <input name="name" className={inputClass} maxLength={120} required value={name} onChange={event => setName(event.target.value)} />
    </label>
    <label className="block space-y-1 text-sm font-medium">
      <span>Purpose</span>
      <textarea name="purpose" className={inputClass} maxLength={500} rows={2} required value={purpose} onChange={event => setPurpose(event.target.value)} />
    </label>
    <div className="space-y-3">
      <h2 className="font-medium">Beats in script order</h2>
      {beats.map((beat, index) => <fieldset key={beat.key} className="min-w-0 space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Beat {index + 1}</legend>
        <label className="block space-y-1 text-sm"><span>Beat name</span>
          <input name="beatName" className={inputClass} maxLength={80} required value={beat.name}
            onChange={event => setBeats(current => current.map(item => item.key === beat.key ? { ...item, name: event.target.value } : item))} />
        </label>
        <label className="block space-y-1 text-sm"><span>Guidance</span>
          <textarea name="beatGuidance" className={inputClass} maxLength={500} rows={2} required value={beat.guidance}
            onChange={event => setBeats(current => current.map(item => item.key === beat.key ? { ...item, guidance: event.target.value } : item))} />
        </label>
        {beats.length > 1 ? <div className="flex flex-wrap gap-2">
          <button type="button" aria-label={`Move beat ${index + 1} up`} disabled={index === 0} className={buttonClass} onClick={() => moveBeat(index, index - 1)}>Move up</button>
          <button type="button" aria-label={`Move beat ${index + 1} down`} disabled={index === beats.length - 1} className={buttonClass} onClick={() => moveBeat(index, index + 1)}>Move down</button>
          <button type="button" aria-label={`Remove beat ${index + 1}`} className={buttonClass} onClick={() => setBeats(current => current.filter(item => item.key !== beat.key))}>Remove</button>
        </div> : null}
      </fieldset>)}
      <button type="button" disabled={beats.length >= MAX_SCRIPT_TEMPLATE_BEATS} className={buttonClass}
        onClick={() => {
          const key = nextKey.current++;
          setBeats(current => [...current, { key, name: "", guidance: "" }]);
        }}>Add beat</button>
    </div>
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
      {pending ? "Saving…" : "Save draft"}
    </button>
  </form>;
}

export function ApproveScriptTemplateForm({ action, version }: { action: () => Promise<{ error?: string }>; version: number }) {
  const [state, submit, pending] = useActionState(action, {});
  return <form action={submit} className="space-y-2">
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Approving…" : `Approve version ${version}`}</button>
  </form>;
}
