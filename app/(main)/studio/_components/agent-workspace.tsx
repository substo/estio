"use client";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { Check, ListChecks, Trash2, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatClock, lengthFit, scriptStats, sectionStats, targetWords } from "@/lib/studio/script-length";
import type { AgentSelection } from "@/lib/studio/agent-policy";
import { Button } from "@/components/ui/button";
import { AUDIENCE_KINDS, AUDIENCE_LIMIT, AUDIENCE_ORIGINS, AUDIENCE_TEXT_LIMIT, CREATION_STAGES, stageDraft, type AudienceSignal, type CreationRecord, type CreationStage } from "@/lib/studio/creation-policy";
import { AUDIENCE_ANALYSIS_ROUTES, AUDIENCE_BRIEF_MAX_BYTES, audienceAnalysisCommand, audienceBriefPrompt,
  audienceObservation, audienceSuggestionPrompt, readAudienceBrief, type AudienceAnalysisRoute } from "@/lib/studio/audience-brief";
import { useStudioTenantHeaders } from "./studio-tenant-context";

type Draft = { recordId: string; record: CreationRecord | null; setRecord: (record: CreationRecord) => void; plan: string[]; setPlan: (plan: string[]) => void; target: number | null; setTarget: (seconds: number | null) => void;
  /** The saved source this draft was started from (comment sampling), and the chat's send function so the Draft panel can ask for an edit. */
  sourceId: string | null; prepareMessage: MutableRefObject<((message: string) => boolean) | null>; sendRef: MutableRefObject<((message: string, selection?: AgentSelection) => void) | null> };
const Context = createContext<Draft | null>(null);
/** Shares the saved draft and the persisted work plan between the chat and the draft panel. */
export function AgentDraftProvider({ recordId, sessionKey, initialRecord, initialPlan, initialTarget = null, sourceId = null, children }: { sourceId?: string | null; recordId: string | null; sessionKey: string; initialRecord: CreationRecord | null; initialPlan: string[]; initialTarget?: number | null; children: React.ReactNode }) {
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
  const prepareMessage = useRef<((message: string) => boolean) | null>(null);
  const sendRef = useRef<((message: string, selection?: AgentSelection) => void) | null>(null);
  const id = recordId ?? session.generated;
  const value = useMemo(() => ({ recordId: id, record: session.record, setRecord, plan: session.plan, setPlan, target: session.target, setTarget, sourceId, sendRef, prepareMessage }), [id, session, setRecord, setPlan, setTarget, sourceId]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAgentDraft() {
  const value = useContext(Context);
  if (!value) throw new Error("AgentDraftProvider is missing");
  return value;
}

function useDraftCommand({ startSave, endSave, onSaved }: {
  startSave?: () => boolean; endSave?: () => void; onSaved?: () => void;
} = {}) {
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const { recordId, record, setRecord } = useAgentDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const command = useCallback(async (body: Record<string, unknown>) => {
    if (saving.current) return false;
    if (startSave && !startSave()) {
      setError("Wait for your script edits to finish saving, then try again.");
      return false;
    }
    saving.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/studio/content/create/api", { method: "POST", headers: { "X-Studio-Tenant": tenant, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ recordId, version: record?.version, ...body }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not save this change."); return false; }
      setRecord(data.record); onSaved?.(); return true;
    } catch { setError("Could not confirm the save. Reload the draft before trying again."); return false; }
    finally { saving.current = false; setBusy(false); endSave?.(); }
  }, [recordId, record?.version, tenant, setRecord, startSave, endSave, onSaved]);
  return { command, busy, error };
}

export function WritingAudiencePanel({ startSave, endSave, onSaved, onPrepared }: {
  startSave: () => boolean; endSave: () => void; onSaved: () => void; onPrepared: () => void;
}) {
  const { record } = useAgentDraft();
  const { command, busy, error } = useDraftCommand({ startSave, endSave, onSaved });
  return <section aria-label="Audience language" className="space-y-3 p-4">
    <AudienceSignals record={record} sourceId={null} command={command} busy={busy} embedded onPrepared={onPrepared} />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>;
}

/** What the conversation has produced so far. Every change here was an explicit owner choice; nothing is a required step. */
export function DraftPanel() {
  const { recordId, record, plan, sourceId, sendRef } = useAgentDraft();
  const [picked, setPicked] = useState<AgentSelection | null>(null);
  const [directEdit, setDirectEdit] = useState<{ selection: AgentSelection; text: string } | null>(null);
  const [editing, setEditing] = useState<CreationStage | null>(null);
  const [text, setText] = useState("");
  const { command, busy, error } = useDraftCommand();
  const removed = record ? CREATION_STAGES.filter(stage => { const d = stageDraft(record.state, stage); return !d.text.trim() && Boolean(d.previous?.text.trim()); }) : [];
  const filled = record ? CREATION_STAGES.filter(stage => stageDraft(record.state, stage).text.trim()) : [];

  /** Reads the user's selection inside one stage paragraph as exact character offsets of the saved text. */
  function capture(element: HTMLElement, stage: CreationStage) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) { setPicked(current => current?.stage === stage ? null : current); return; }
    const range = selection.getRangeAt(0);
    const before = document.createRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length, text = range.toString();
    const saved = record ? stageDraft(record.state, stage).text : "";
    if (!text.trim() || text.length > 1800 || saved.slice(start, start + text.length) !== text) { setPicked(null); return; }
    setPicked({ stage, action: "rewrite", start, end: start + text.length, text });
  }


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
            : <p tabIndex={0} data-stage-text={stage} aria-label={`${stage} text. Select words to expand, tighten or rewrite them.`} className="whitespace-pre-wrap break-words text-sm leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onMouseUp={event => capture(event.currentTarget, stage)} onKeyUp={event => capture(event.currentTarget, stage)} onTouchEnd={event => { const element = event.currentTarget; window.setTimeout(() => capture(element, stage), 50); }}>{draft.text}</p>}
          {picked?.stage === stage && editing !== stage ? <SelectionBar selection={picked} busy={busy} onClear={() => setPicked(null)}
            onAsk={action => { sendRef.current?.(`${action === "expand" ? "Expand" : action === "tighten" ? "Tighten" : "Rewrite"} this part of the ${stage}.`, { ...picked, action }); setPicked(null); window.getSelection()?.removeAllRanges(); }}
            onEdit={() => { setDirectEdit({ selection: picked, text: picked.text }); setPicked(null); }} /> : null}
          {directEdit?.selection.stage === stage ? <div className="space-y-2 rounded-md border p-2">
            <label className="text-xs font-medium" htmlFor={`direct-${stage}`}>Edit only the selected words</label>
            <textarea id={`direct-${stage}`} value={directEdit.text} onChange={event => setDirectEdit({ ...directEdit, text: event.target.value })} rows={3} className="block w-full rounded-md border bg-background p-2 text-sm" />
            <div className="flex gap-2"><Button type="button" disabled={busy || !directEdit.text.trim()} onClick={async () => { const d = directEdit.selection; if (await command({ action: "replace", stage, selection: { start: d.start, end: d.end, text: d.text }, text: directEdit.text })) setDirectEdit(null); }}>Replace selection</Button>
              <Button type="button" variant="outline" onClick={() => setDirectEdit(null)}>Cancel</Button></div>
            <p className="text-xs text-muted-foreground">Only these words change; the rest of the {stage} stays exactly as it is, and Undo restores it.</p></div> : null}
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
      <AudienceSignals key={recordId} record={record} sourceId={sourceId} command={command} busy={busy} />
      {record ? <p className="border-t pt-3 text-xs text-muted-foreground">To set this whole draft aside, archive it from its <Link href={`/studio/content/${record.id}`} className="text-primary hover:underline">Content record</Link> (Archived option). Archived drafts can be restored there, and Content's “Include archived” filter shows them.</p> : null}
    </div>
  </section>;
}

/** Estimated spoken runtime of the saved script against the request. Cues in [brackets] are not counted as speech. */
function ScriptMeasure({ text, target }: { text: string; target: number | null }) {
  const stats = scriptStats(text);
  const fit = target ? lengthFit(target, stats.seconds) : null;
  return <><p className="text-xs text-muted-foreground" data-script-measure>
    About {formatClock(stats.seconds)} spoken · {stats.spokenWords} spoken words{stats.cueWords ? ` (+${stats.cueWords} cue words not counted)` : ""}
    {target ? <> · requested when written: about {formatClock(target)} ({targetWords(target).min}–{targetWords(target).max} words)</> : null}
    {fit ? <span className={fit.state === "match" ? " font-medium text-emerald-700" : " font-medium text-amber-700"}> · {fit.state === "match" ? "close to the request" : `${fit.percent}% ${fit.state}${fit.meaningful ? " — ask the assistant to " + (fit.state === "short" ? "expand" : "tighten") + " it" : ""}`}</span> : null}
  </p><SectionFit text={text} target={target} /></>;
}

/** Fit by section for a script written in labelled beats ([Opening], [Development], [Payoff]); nothing is shown for unlabelled text. */
export function SectionFit({ text, target }: { text: string; target: number | null }) {
  const sections = sectionStats(text, target);
  if (!sections) return null;
  return <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground" data-section-fit aria-label="Fit by section">
    {sections.map(section => <li key={section.beat}>{section.beat} {section.spokenWords}{section.budgetWords ? `/${section.budgetWords}` : ""} words
      {section.state && section.state !== "match" ? <span className="font-medium text-amber-700"> ({section.percent}% {section.state})</span> : section.state ? <span className="text-emerald-700"> ✓</span> : null}</li>)}
  </ul>;
}

/** Appears under a saved stage once words are selected: ask the assistant for a scoped edit, or edit just those words directly. */
function SelectionBar({ selection, busy, onAsk, onEdit, onClear }: { selection: AgentSelection; busy: boolean; onAsk: (action: AgentSelection["action"]) => void; onEdit: () => void; onClear: () => void }) {
  return <div role="group" aria-label="Edit the selected words" className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/60 p-1.5 text-xs">
    <span className="px-1 text-muted-foreground">{selection.end - selection.start} characters selected</span>
    {(["expand", "tighten", "rewrite"] as const).map(action => <Button key={action} type="button" variant="outline" className="min-h-9 px-2.5 text-xs capitalize" disabled={busy} onClick={() => onAsk(action)}>{action}</Button>)}
    <Button type="button" variant="ghost" className="min-h-9 px-2.5 text-xs" onClick={onEdit}>Edit myself</Button>
    <Button type="button" variant="ghost" className="min-h-9 px-2 text-xs" onClick={onClear}>Clear</Button>
  </div>;
}

type CommentSample = { status: "ok"; size: number; fetchedAt: string; videoUrl: string; comments: Array<{ text: string; href: string }> } | { status: "unavailable"; reason: string };
/** The owner's own audience observations. Public comments can be read here, but nothing from YouTube is saved: you write what you notice. */
function AudienceSignals({ record, sourceId, command, busy, embedded = false, onPrepared }: {
  record: CreationRecord | null; sourceId: string | null; command: (body: Record<string, unknown>) => Promise<boolean>; busy: boolean;
  embedded?: boolean; onPrepared?: () => void;
}) {
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const { prepareMessage } = useAgentDraft();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<AudienceSignal["kind"]>("question");
  const [origin, setOrigin] = useState<AudienceSignal["origin"]>("comments");
  const [sample, setSample] = useState<CommentSample | null>(null);
  const [loading, setLoading] = useState(false);
  const signals = record?.state.audience ?? [];
  const observationRef = useRef<HTMLTextAreaElement>(null);
  const observationId = useId();
  const [brief, setBrief] = useState<ReturnType<typeof readAudienceBrief> | null>(null);
  const [briefError, setBriefError] = useState("");
  const [readingBrief, setReadingBrief] = useState(false);
  const [opened, setOpened] = useState(embedded);
  const [analysisRoute, setAnalysisRoute] = useState<AudienceAnalysisRoute>("ollama");
  const [analysisModel, setAnalysisModel] = useState("");
  const [briefStatus, setBriefStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const analysisCommand = audienceAnalysisCommand(analysisRoute, analysisModel);

  async function openBrief(file: File) {
    setBrief(null);
    setBriefError("");
    setBriefStatus("");
    setReadingBrief(true);
    try {
      if (file.size > AUDIENCE_BRIEF_MAX_BYTES) throw new Error("Choose a Studio audience brief under 256 KB.");
      setBrief(readAudienceBrief(await file.text()));
    } catch (error) {
      setBriefError(error instanceof SyntaxError ? "This file isn't valid JSON." : error instanceof Error ? error.message : "Could not open this brief.");
    } finally {
      setReadingBrief(false);
    }
  }
  async function readComments() {
    if (!sourceId) return;
    setLoading(true);
    try {
      const response = await fetch("/studio/assistant/comments/api", { method: "POST", headers: { "X-Studio-Tenant": tenant, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ sourceId }) });
      const data = await response.json();
      setSample(response.ok ? data : { status: "unavailable", reason: data.error || "Comments could not be read right now." });
    } catch { setSample({ status: "unavailable", reason: "Could not reach Studio. Try again." }); }
    finally { setLoading(false); }
  }
  function prepareBriefMessage(message: string) {
    const prepared = prepareMessage.current?.(message);
    setBriefStatus(prepared ? "Added to the Assistant message. Review it and choose Process with before sending." :
      "Finish the current Assistant message before adding this brief.");
    if (prepared) onPrepared?.();
  }
  const controls = <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Add what you have noticed in comments, interviews or FAQs, in your own words: a question people ask, an objection, a phrase they use. The assistant uses the wording and concerns. They are your observations, not evidence and not a claim about everyone.</p>
      <details className="space-y-2">
        <summary className="cursor-pointer text-xs font-medium">Choose an analysis model</summary>
        <p className="text-xs text-muted-foreground">Run comment analysis from the Mac. The Assistant uses its own Process with setting when you send a message.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs font-medium">Analyze comments with
            <select className="mt-1 min-h-9 w-full rounded-md border bg-background px-2" value={analysisRoute} onChange={event => {
              setAnalysisRoute(event.target.value as AudienceAnalysisRoute); setAnalysisModel(""); setCopyStatus("");
            }}>{Object.entries(AUDIENCE_ANALYSIS_ROUTES).map(([value, route]) => <option key={value} value={value}>{route.label}</option>)}</select>
          </label>
          <label className="block text-xs font-medium">Analysis model
            <input className="mt-1 min-h-9 w-full rounded-md border bg-background px-2" value={analysisModel} maxLength={100} onChange={event => { setAnalysisModel(event.target.value); setCopyStatus(""); }} placeholder={AUDIENCE_ANALYSIS_ROUTES[analysisRoute].modelHint} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{AUDIENCE_ANALYSIS_ROUTES[analysisRoute].hint} The command uses only this route.</p>
        {analysisCommand ? <div className="space-y-1">
          <code className="block select-all break-all rounded-md bg-muted p-2 text-xs">{analysisCommand}</code>
          <Button type="button" variant="ghost" className="min-h-8 text-xs" onClick={async () => {
            try { await navigator.clipboard.writeText(analysisCommand); setCopyStatus("Command copied."); }
            catch { setCopyStatus("Select and copy the command above."); }
          }}>Copy Mac command</Button>
          {copyStatus ? <p role="status" className="text-xs text-muted-foreground">{copyStatus}</p> : null}
        </div> : null}
      </details>
      <div className="space-y-2">
        <label className="block text-xs font-medium">Open a local audience brief
          <input type="file" accept=".json,application/json" disabled={readingBrief} className="mt-1 block w-full text-xs file:mr-2" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void openBrief(file);
          }} />
        </label>
        {briefError ? <p role="alert" className="text-xs text-destructive">{briefError}</p> : null}
        {brief ? <div className="space-y-2" aria-label="Audience brief">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-xs text-muted-foreground">{brief.analyzed.toLocaleString()} comments read. Opening this file saves nothing.</p>
            <Button type="button" variant="ghost" className="min-h-8 text-xs" onClick={() => setBrief(null)}>Close brief</Button>
          </div>
          {brief.analysis ? <p className="text-xs text-muted-foreground">Analyzed with {brief.analysis}.</p> : null}
          {brief.signals.length ? <div className="flex flex-wrap gap-1" aria-label="Use audience comments">
            {([["explore", "Explore angles"], ["deepen", "Deepen the draft"], ["tighten", "Tighten the draft"]] as const).map(([action, label]) =>
              <Button key={action} type="button" variant="outline" className="min-h-8 px-2 text-xs" onClick={() => {
                prepareBriefMessage(audienceBriefPrompt(brief.signals, action));
              }}>{label}</Button>)}
          </div> : null}
          {briefStatus ? <p role="status" className="text-xs text-muted-foreground">{briefStatus}</p> : null}
          {brief.discarded ? <p className="text-xs text-muted-foreground">Skipped {brief.discarded.toLocaleString()} suggestions with unmatched excerpts.</p> : null}
          {brief.signals.length === 0 ? <p className="text-xs text-muted-foreground">This brief has no supported suggestions.</p> : null}
          <ul className="space-y-2">{brief.signals.map((item, index) => <li key={index} className="space-y-1 rounded-md bg-muted/60 p-2 break-words">
            <p className="text-xs font-medium capitalize">{item.beat} · {item.action}</p>
            <p>{item.signal}</p>
            <p className="text-xs">{item.suggestion}</p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Review comment excerpts</summary>
              <ul className="space-y-1 pt-1">{item.evidence.map(row => <li key={row.id}>
                <p>{row.video} · {row.file}, row {row.row}</p>
                <blockquote>“{row.text}”</blockquote>
              </li>)}</ul>
            </details>
            <Button type="button" variant="outline" className="min-h-9 px-2 text-xs"
              onClick={() => prepareBriefMessage(audienceSuggestionPrompt(item))}>Use this suggestion</Button>
            <Button type="button" variant="ghost" className="min-h-9 px-2 text-xs"
              disabled={!record || busy || Boolean(text.trim()) || signals.length >= AUDIENCE_LIMIT}
              onClick={() => {
                setText(audienceObservation(item));
                setKind(item.kind);
                setOrigin("comments");
                observationRef.current?.focus();
              }}>Review as observation</Button>
          </li>)}</ul>
        </div> : null}
      </div>
      {signals.length ? <ul className="space-y-1.5">{signals.map(item => <li key={item.id} className="flex items-start justify-between gap-2 rounded-md bg-muted/60 p-2">
        <span><span className="mr-1.5 rounded-full border px-1.5 py-0.5 text-[11px] capitalize">{item.kind}</span>{item.text}<span className="ml-1 text-xs text-muted-foreground">· {item.origin}</span></span>
        <Button type="button" variant="ghost" className="min-h-8 px-2 text-xs" disabled={busy} onClick={() => void command({ action: "audience_remove", signalId: item.id })} aria-label={`Remove observation: ${item.text.slice(0, 40)}`}>Remove</Button></li>)}</ul> : null}
      {record && signals.length < AUDIENCE_LIMIT ? <div className="space-y-2">
        <label className="sr-only" htmlFor={observationId}>Your observation</label>
        <textarea ref={observationRef} id={observationId} value={text} maxLength={AUDIENCE_TEXT_LIMIT} rows={2} onChange={event => setText(event.target.value)} placeholder="e.g. People keep asking whether this works without expensive gear" className="block w-full rounded-md border bg-background p-2 text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Kind of observation" value={kind} onChange={event => setKind(event.target.value as AudienceSignal["kind"])} className="min-h-9 rounded-md border bg-background px-2 text-xs">{AUDIENCE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select>
          <select aria-label="Where you saw it" value={origin} onChange={event => setOrigin(event.target.value as AudienceSignal["origin"])} className="min-h-9 rounded-md border bg-background px-2 text-xs">{AUDIENCE_ORIGINS.map(o => <option key={o} value={o}>from {o}</option>)}</select>
          <Button type="button" className="min-h-9" disabled={busy || !text.trim()} onClick={async () => { if (await command({ action: "audience_add", kind, origin, text })) setText(""); }}>Add</Button>
        </div></div> : record ? <p className="text-xs text-muted-foreground">Up to {AUDIENCE_LIMIT} observations. Remove one to add another.</p> : <p className="text-xs text-muted-foreground">Send a first message to start the draft, then add observations here.</p>}
      {sourceId ? <div className="space-y-2 border-t pt-3">
        <Button type="button" variant="outline" className="min-h-9 text-xs" disabled={loading} onClick={() => void readComments()}>{loading ? "Reading…" : sample ? "Read a fresh sample" : "Read a sample of this video's public comments"}</Button>
        {sample?.status === "unavailable" ? <p role="status" className="text-xs text-muted-foreground">{sample.reason}</p> : null}
        {sample?.status === "ok" ? <div className="space-y-1.5" data-comment-sample>
          <p className="text-xs text-muted-foreground">{sample.size} public comments, most relevant first, read from YouTube's official API on {new Date(sample.fetchedAt).toLocaleString()}. For reading only: this is not saved, not sent to the assistant and not representative. <a className="text-primary hover:underline" href={sample.videoUrl} target="_blank" rel="noopener noreferrer">Open the video</a></p>
          <ul className="max-h-60 space-y-1.5 overflow-y-auto text-xs">{sample.comments.map((c, i) => <li key={i} className="rounded-md bg-muted/60 p-2"><span className="whitespace-pre-wrap break-words">{c.text}</span> <a className="ml-1 text-primary hover:underline" href={c.href} target="_blank" rel="noopener noreferrer">View comment</a></li>)}</ul>
          <p className="text-xs text-muted-foreground">Then add what you notice above, in your own words.</p></div> : null}
      </div> : null}
    </div>;
  if (embedded) return controls;
  return <details className="rounded-md border p-3 text-sm" data-audience
    onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="cursor-pointer font-medium">Audience language{signals.length ? ` · ${signals.length}` : ""} <span className="font-normal text-muted-foreground">(optional)</span></summary>
    {opened ? <div className="mt-3">{controls}</div> : null}
  </details>;
}
