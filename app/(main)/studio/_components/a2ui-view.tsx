"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { a2uiActionMessage, type A2uiComponent } from "@/lib/studio/a2ui";

const chip = "h-auto min-h-9 whitespace-normal py-1.5 text-left text-xs";
/** Renders the validated A2UI catalog with the existing UI kit. Every action becomes one ordinary chat message. */
export function A2uiView({ components, disabled, onSend }: { components: A2uiComponent[]; disabled: boolean; onSend: (message: string) => void }) {
  return <div className="space-y-3" data-a2ui>{components.map((c, i) => <Piece key={i} c={c} disabled={disabled} onSend={onSend} />)}</div>;
}

function Piece({ c, disabled, onSend }: { c: A2uiComponent; disabled: boolean; onSend: (message: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const heading = (t: string | null) => t ? <p className="text-xs font-medium">{t}</p> : null;
  if (c.type === "choices") return <div className="space-y-1.5">{heading(c.prompt)}<div className="flex flex-wrap gap-2">{c.options.map(o => <Button key={o} type="button" variant="outline" className={chip} disabled={disabled} onClick={() => onSend(a2uiActionMessage("choice", o))}>{o}</Button>)}</div></div>;
  if (c.type === "confirm") return <div className="space-y-2 rounded-md border p-3"><p>{c.title}</p><div className="flex gap-2">
    <Button type="button" className="min-h-9 text-xs" disabled={disabled} onClick={() => onSend(a2uiActionMessage("confirm", `approved — ${c.title}`))}>{c.approve}</Button>
    <Button type="button" variant="outline" className="min-h-9 text-xs" disabled={disabled} onClick={() => onSend(a2uiActionMessage("confirm", `declined — ${c.title}`))}>{c.decline}</Button></div></div>;
  if (c.type === "checklist") return <div className="space-y-2 rounded-md border p-3">{heading(c.title)}
    {c.items.map(item => <label key={item} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={picked.includes(item)} disabled={disabled} onChange={e => setPicked(p => e.target.checked ? [...p, item] : p.filter(x => x !== item))} />{item}</label>)}
    <Button type="button" variant="outline" className="min-h-9 text-xs" disabled={disabled || !picked.length} onClick={() => onSend(a2uiActionMessage("checklist", picked))}>{c.submit}</Button></div>;
  if (c.type === "cards") return <div className="space-y-2">{heading(c.title)}{c.items.map(item => <div key={item.title} className="space-y-1 rounded-md border p-3"><p className="font-medium">{item.title}</p>{item.body ? <p className="text-xs text-muted-foreground">{item.body}</p> : null}
    {item.action ? <Button type="button" variant="outline" className="min-h-9 text-xs" disabled={disabled} onClick={() => onSend(a2uiActionMessage("card", `${item.action} — ${item.title}`))}>{item.action}</Button> : null}</div>)}</div>;
  return <form className="space-y-2 rounded-md border p-3" onSubmit={e => { e.preventDefault(); const filled = Object.fromEntries(c.fields.filter(f => values[f.name]?.trim()).map(f => [f.label, values[f.name].trim()])); if (Object.keys(filled).length) onSend(a2uiActionMessage("form", filled)); }}>{heading(c.title)}
    {c.fields.map(f => <label key={f.name} className="block space-y-1 text-xs">{f.label}
      {f.options.length ? <select className="block w-full rounded-md border bg-background p-2 text-sm" disabled={disabled} value={values[f.name] ?? ""} onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}><option value="">Choose…</option>{f.options.map(o => <option key={o}>{o}</option>)}</select>
        : <input className="block w-full rounded-md border bg-background p-2 text-sm" maxLength={300} disabled={disabled} value={values[f.name] ?? ""} onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))} />}</label>)}
    <Button type="submit" variant="outline" className="min-h-9 text-xs" disabled={disabled}>{c.submit}</Button></form>;
}
