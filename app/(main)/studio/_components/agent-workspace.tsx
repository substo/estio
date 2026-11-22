"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ListChecks, Trash2, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatClock, lengthFit, scriptStats, targetWords } from "@/lib/studio/script-length";
import { Button } from "@/components/ui/button";
import { CREATION_STAGES, stageDraft, type CreationRecord, type CreationStage } from "@/lib/studio/creation-policy";
import { useStudioTenantHeaders } from "./studio-tenant-context";

type Draft = { recordId: string; record: CreationRecord | null; setRecord: (record: CreationRecord) => void; plan: string[]; setPlan: (plan: string[]) => void; target: number | null; setTarget: (seconds: number | null) => void };
const Context = createContext<Draft | null>(null);
/** Shares the saved draft and the persisted work plan between the chat and the draft panel. */
export function AgentDraftProvider({ recordId, sessionKey, initialRecord, initialPlan, initialTarget = null, children }: { recordId: string | null; sessionKey: string; initialRecord: CreationRecord | null; initialPlan: string[]; initialTarget?: number | null; children: React.ReactNode }) {
  type Session = { key: string; record: CreationRecord | null; plan: string[]; target: number | null; generated: string };
  const fresh = (): Session => ({ key: sessionKey, record: initialRecord, plan: initialPlan, target: initialTarget, generated: crypto.randomUUID() });
  const [state, setState] = useState<Session>(fresh);
  // The session identity is applied during render, before any child sees it: a chat remounted for a new session must start from that
  // session's record and draft id, never the previous conversation's (an effect would run after the child's first render).
  let session = state;
  if (state.key !== sessionKey) { session = fresh(); setState(session); }
  const planKey = initialPlan.join("\n");
  useEffect(() => {
    // Same session: adopt newer server state (for example after a refresh) but never reset to older state.
    setState(current => current.key !== sessionKey ? current : { ...current,
      record: !initialRecord ? current.record : !current.record || initialRecord.id !== current.record.id || initialRecord.version > current.record.version ? initialRecord : current.record,
      plan: planKey && planKey !== current.plan.join("\n") ? initialPlan : current.plan });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, initialRecord?.id, initialRecord?.version, planKey]);
  const setRecord = useCallback((record: CreationRecord) => setState(current => ({ ...current, record })), []);
  const setPlan = useCallback((plan: string[]) => setState(current => ({ ...current, plan })), []);
  const setTarget = useCallback((target: number | null) => setState(current => ({ ...current, target })), []);
  const id = recordId ?? session.generated;
  const value = useMemo(() => ({ recordId: id, record: session.record, setRecord, plan: session.plan, setPlan, target: session.target, setTarget }), [id, session, setRecord, setPlan, setTarget]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAgentDraft() {
  const value = useContext(Context);
  if (!value) throw new Error("AgentDraftProvider is missing");
  return value;
}

/** What the conversation has produced so far. Every change here was an explicit owner choice; nothing is a required step. */
export function DraftPanel() {
  const { recordId, record, setRecord, plan } = useAgentDraft();
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const [editing, setEditing] = useState<CreationStage | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const removed = record ? CREATION_STAGES.filter(stage => { const d = stageDraft(record.state, stage); return !d.text.trim() && Boolean(d.previous?.text.trim()); }) : [];
  const filled = record ? CREATION_STAGES.filter(stage => stageDraft(record.state, stage).text.trim()) : [];

  const command = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/studio/content/create/api", { method: "POST", headers: { "X-Studio-Tenant": tenant, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ recordId, version: record?.version, ...body }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not save this change."); return false; }
      setRecord(data.record); return true;
    } catch { setError("Could not reach Studio. Nothing changed; try again."); return false; }
    finally { setBusy(false); }
  }, [recordId, record?.version, tenant, setRecord]);

  return <section aria-label="Draft" className="space-y-4">
    {plan.length ? <div className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><ListChecks aria-hidden="true" className="h-4 w-4" />Next steps</h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm">{plan.map((step, index) => <li key={index}>{step}</li>)}</ol>
      <p className="text-xs text-muted-foreground">Updated by the assistant as you give feedback. It changes nothing by itself.</p>
    </div> : null}
    <div className="space-y-3 rounded-xl border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Your draft</h2>
        {record ? <Link href={`/studio/content/${record.id}`} className="text-sm text-primary hover:underline">Open content record</Link> : null}
      </div>
      {filled.length === 0 && removed.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is saved yet. When the assistant proposes a hook, script or shoot plan, choose <strong>Use</strong> on the proposal and it appears here. You can also ask for any part at any time.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {removed.map(stage => <div key={`removed-${stage}`} role="status" className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-sm">
        <span>The saved {stage} was removed from this draft.</span>
        <Button type="button" variant="outline" className="min-h-9 text-xs" disabled={busy} onClick={() => void command({ action: "undo", stage })}><Undo2 aria-hidden="true" className="mr-1 h-3.5 w-3.5" />Undo last change</Button>
      </div>)}
      <ul className="space-y-4">{filled.map(stage => {
        const draft = stageDraft(record!.state, stage);
        return <li key={stage} className="space-y-1.5 border-t pt-3 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{stage}</h3>
            {draft.approved ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><Check aria-hidden="true" className="h-3 w-3" />In use</span> : <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Edited by you</span>}
          </div>
          {editing === stage
            ? <div className="space-y-2">
              <label className="sr-only" htmlFor={`edit-${stage}`}>Edit {stage}</label>
              <textarea id={`edit-${stage}`} value={text} onChange={event => setText(event.target.value)} rows={Math.min(14, Math.max(4, text.split("\n").length + 1))} className="block w-full rounded-md border bg-background p-2 text-sm" />
              <div className="flex gap-2">
                <Button type="button" disabled={busy || !text.trim()} onClick={async () => { if (await command({ action: "use", stage, text })) setEditing(null); }}>Save and use</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </div>
            : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{draft.text}</p>}
          {stage === "Script" ? <ScriptMeasure text={draft.text} target={draft.targetSeconds ?? null} /> : null}
          {editing !== stage ? <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => { setEditing(stage); setText(draft.text); }}>Edit</Button>
            {draft.previous ? <Button type="button" variant="ghost" className="min-h-9 px-2 text-xs" disabled={busy} onClick={() => void command({ action: "undo", stage })}><Undo2 aria-hidden="true" className="mr-1 h-3.5 w-3.5" />Undo last change</Button> : null}
            {stage === "Script" ? <AlertDialog>
              <AlertDialogTrigger asChild><Button type="button" variant="ghost" className="min-h-9 px-2 text-xs text-destructive" disabled={busy}><Trash2 aria-hidden="true" className="mr-1 h-3.5 w-3.5" />Remove script…</Button></AlertDialogTrigger>
              <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove the saved script?</AlertDialogTitle>
                <AlertDialogDescription>The script text is emptied here and in this draft's Content record, and it stops being used as context for the assistant. Your chat history and earlier proposals stay. You can bring the script back with <strong>Undo last change</strong> until you change this stage again. The rest of the draft is untouched.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Keep script</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void command({ action: "clear", stage: "Script", confirmClear: true })}>Remove script</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
            </AlertDialog> : null}
          </div> : null}
        </li>;
      })}</ul>
      {record ? <p className="border-t pt-3 text-xs text-muted-foreground">To set this whole draft aside, archive it from its <Link href={`/studio/content/${record.id}`} className="text-primary hover:underline">Content record</Link> (Archived option). Archived drafts can be restored there, and Content's “Include archived” filter shows them.</p> : null}
    </div>
  </section>;
}

/** Estimated spoken runtime of the saved script against the request. Cues in [brackets] are not counted as speech. */
function ScriptMeasure({ text, target }: { text: string; target: number | null }) {
  const stats = scriptStats(text);
  const fit = target ? lengthFit(target, stats.seconds) : null;
  return <p className="text-xs text-muted-foreground" data-script-measure>
    About {formatClock(stats.seconds)} spoken · {stats.spokenWords} spoken words{stats.cueWords ? ` (+${stats.cueWords} cue words not counted)` : ""}
    {target ? <> · requested when written: about {formatClock(target)} ({targetWords(target).min}–{targetWords(target).max} words)</> : null}
    {fit ? <span className={fit.state === "match" ? " font-medium text-emerald-700" : " font-medium text-amber-700"}> · {fit.state === "match" ? "close to the request" : `${fit.percent}% ${fit.state}${fit.meaningful ? " — ask the assistant to " + (fit.state === "short" ? "expand" : "tighten") + " it" : ""}`}</span> : null}
  </p>;
}
