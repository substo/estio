"use client";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appendSourceNote, SOURCE_NOTES_LIMIT } from "@/lib/studio/source-assistant-policy";
import { diffLines } from "@/lib/studio/text-diff";
import { replaceSourceNotesAction } from "../(tenant)/library/note-actions";
import { InfoTip } from "./info-tip";
import { useSourceWorkspace } from "./source-workspace";

const tone = { same: "", add: "bg-emerald-50 text-emerald-900", remove: "bg-red-50 text-red-900 line-through" } as const;
const mark = { same: " ", add: "+", remove: "−" } as const;

/** My notes on the left. The assistant's proposal appears here as a change to review; nothing is written until Apply. */
export function NotesPanel({ locationId, sourceId, version, notes, archived }: { locationId: string; sourceId: string; version: number; notes: string; archived: boolean }) {
  const router = useRouter();
  const { noteProposal, setNoteProposal } = useSourceWorkspace();
  const proposed = noteProposal ? appendSourceNote(notes, noteProposal) : null;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const field = useId();
  useEffect(() => { if (proposed?.ok) { setDraft(proposed.value); setError(""); setSaved(false); } }, [noteProposal]); // eslint-disable-line react-hooks/exhaustive-deps
  const editing = draft !== null;
  const reviewing = Boolean(noteProposal);

  async function apply() {
    if (draft === null) return;
    setSaving(true); setError("");
    const result = await replaceSourceNotesAction(locationId, sourceId, draft, version).catch(() => ({ ok: false as const, error: "Could not reach Studio. Your edit is still here; try again." }));
    setSaving(false);
    if (!result.ok) { setError(result.error); return; }
    setNoteProposal(null); setDraft(null); setSaved(true); router.refresh();
  }
  function cancel() { setNoteProposal(null); setDraft(null); setError(""); }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">My notes</h2><InfoTip label="About notes">Your own notes on this source. Ask the assistant in Notes mode to tidy or add to them: the change shows here and nothing is saved until you press Apply.</InfoTip>
      {!editing && !archived ? <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => { setDraft(notes); setSaved(false); }}><Pencil aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Edit</Button> : null}</div>
    {noteProposal && proposed && !proposed.ok ? <p role="alert" className="text-sm text-destructive">{proposed.error}</p> : null}
    {editing ? <div className="space-y-3">
      {reviewing && draft !== null ? <div aria-label="Proposed change" className="overflow-hidden rounded-lg border font-mono text-xs">{diffLines(notes, draft).map((part, i) => <p key={i} className={`flex gap-2 whitespace-pre-wrap break-words px-3 py-0.5 ${tone[part.kind]}`}><span aria-hidden="true" className="select-none">{mark[part.kind]}</span><span className="sr-only">{part.kind === "add" ? "Added: " : part.kind === "remove" ? "Removed: " : ""}</span>{part.text || " "}</p>)}</div> : null}
      <label htmlFor={field} className="text-xs font-medium">{reviewing ? "Edit the result before applying" : "Notes"}</label>
      <textarea id={field} value={draft ?? ""} maxLength={SOURCE_NOTES_LIMIT} rows={10} onChange={event => setDraft(event.target.value)} className="block w-full rounded-md border bg-background p-3 text-sm leading-relaxed" />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2"><Button type="button" disabled={saving || draft === notes} onClick={() => void apply()}>{saving ? "Saving…" : reviewing ? "Apply change" : "Save notes"}</Button><Button type="button" variant="ghost" onClick={cancel}>{reviewing ? "Discard" : "Cancel"}</Button></div>
    </div> : notes ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{notes}</p> : <p className="text-sm text-muted-foreground">Nothing yet. Tell the assistant your reaction, or press Edit.</p>}
    {saved ? <p role="status" className="text-xs font-medium text-emerald-700">Notes updated.</p> : null}
  </div>;
}
