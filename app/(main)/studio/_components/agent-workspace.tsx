"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ListChecks, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CREATION_STAGES, stageDraft, type CreationRecord, type CreationStage } from "@/lib/studio/creation-policy";
import { useStudioTenantHeaders } from "./studio-tenant-context";

type Draft = { recordId: string; record: CreationRecord | null; setRecord: (record: CreationRecord) => void; plan: string[]; setPlan: (plan: string[]) => void };
const Context = createContext<Draft | null>(null);
/** Shares the saved draft and the persisted work plan between the chat and the draft panel. */
export function AgentDraftProvider({ recordId, sessionKey, initialRecord, initialPlan, children }: { recordId: string | null; sessionKey: string; initialRecord: CreationRecord | null; initialPlan: string[]; children: React.ReactNode }) {
  const [record, setRecord] = useState(initialRecord);
  const [plan, setPlan] = useState(initialPlan);
  // A fresh conversation gets one browser-held draft id for the whole session; it only changes when the session does.
  const [generated, setGenerated] = useState(() => crypto.randomUUID());
  const lastSession = useRef(sessionKey);
  const planKey = initialPlan.join("\n");
  useEffect(() => {
    if (lastSession.current !== sessionKey) { lastSession.current = sessionKey; setGenerated(crypto.randomUUID()); setRecord(initialRecord); setPlan(initialPlan); return; }
    // Same session: adopt newer server state (for example after a refresh) but never reset to older state.
    setRecord(current => !initialRecord ? current : !current || initialRecord.id !== current.id || initialRecord.version > current.version ? initialRecord : current);
    setPlan(current => planKey && planKey !== current.join("\n") ? initialPlan : current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, initialRecord?.id, initialRecord?.version, planKey]);
  const id = recordId ?? generated;
  const value = useMemo(() => ({ recordId: id, record, setRecord, plan, setPlan }), [id, record, plan]);
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
      {filled.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is saved yet. When the assistant proposes a hook, script or shoot plan, choose <strong>Use</strong> on the proposal and it appears here. You can also ask for any part at any time.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
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
          {editing !== stage ? <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => { setEditing(stage); setText(draft.text); }}>Edit</Button>
            {draft.previous ? <Button type="button" variant="ghost" className="min-h-9 px-2 text-xs" disabled={busy} onClick={() => void command({ action: "undo", stage })}><Undo2 aria-hidden="true" className="mr-1 h-3.5 w-3.5" />Undo last change</Button> : null}
          </div> : null}
        </li>;
      })}</ul>
    </div>
  </section>;
}
