"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, Check, MessageSquare, Scissors, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CREATION_STAGES, REWRITE_ACTIONS, SELECTION_LIMIT, requestsDirectionChange, stageDraft, stageTextLimit, type CreationCommand, type CreationRecord, type CreationSource, type CreationStage, type LinkedDraft, type DraftContextChoice, type Selection } from "@/lib/studio/creation-policy";
import type { CreationRun } from "@/lib/studio/creation-text-policy";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import { CreationDirection } from "./creation-direction";
import { CreationFeedback } from "./creation-feedback";
import { CreationNextContext, CreationRunContext } from "./creation-context";
import { StudioTextProviderChoice } from "./text-provider-choice";
import { useStudioTenantHeaders } from "./studio-tenant-context";

import { useOptionalSourceWorkspace } from "./source-workspace";
import { OPEN_TAB_EVENT } from "./source-tabs";

const endpoint = "/studio/content/create/api";
const stageHint: Record<CreationStage, string> = {
  Concept: "State the idea in one or two sentences.",
  Angle: "Choose the perspective or demonstration that makes the idea yours.",
  Title: "Write the promise viewers will see before they click.",
  Hook: "Write the opening they’ll hear or see.",
  Payoff: "Describe what the viewer will learn, see, or be able to do.",
  Script: "Write the spoken lines and review the full draft before using it.",
  "Shoot plan": "Capture shots, on-screen examples and recording notes.",
};
type HistoryItem = { id: string; stage: string; kind: string; created_at: string };
type TemplateChoice = { id: string; name: string; version: number };
type LocalCommand = CreationCommand extends infer T ? T extends CreationCommand ? Omit<T, "recordId" | "version"> : never : never;
type Panel = "generate" | "selection" | "comment";
type Rewrite = typeof REWRITE_ACTIONS[number];

export function CreationWorkspace({ recordId, initial, initialStage = "Concept", source, publisher, templates, history, linkedDrafts = [] }: {
  recordId: string; initial: CreationRecord | null; initialStage?: CreationStage; source: CreationSource | null; publisher: string;
  templates: TemplateChoice[]; history: HistoryItem[]; linkedDrafts?: LinkedDraft[];
}) {
  const sourceWorkspace = useOptionalSourceWorkspace();
  const assistant = sourceWorkspace?.creationControls;
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const [record, setRecord] = useState(initial);
  const [stage, setStage] = useState<CreationStage>(initialStage);
  const [value, setValue] = useState(initial ? stageDraft(initial.state, initialStage).text : "");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [rewrite, setRewrite] = useState<Rewrite | null>(null);
  const [generationKind, setGenerationKind] = useState<"suggest" | "draft">("suggest");
  const [replacement, setReplacement] = useState("");
  const [firstFocus, setFirstFocus] = useState("");
  const [feedback, setFeedback] = useState("");
  const [includeReferences, setIncludeReferences] = useState(true);
  const [draftId, setDraftId] = useState("");
  const [purpose, setPurpose] = useState<DraftContextChoice["purpose"]>("compare");
  const [standaloneProvider, setStandaloneProvider] = useState<StudioTextProvider>("subscription");
  const provider = sourceWorkspace?.provider ?? standaloneProvider;
  const setProvider = sourceWorkspace?.setProvider ?? setStandaloneProvider;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeReview, setActiveReview] = useState<string | null>(history.find(item => item.stage === initialStage)?.id ?? null);
  const [run, setRun] = useState<CreationRun | null>(null);
  const [runs, setRuns] = useState(history);
  const [directionOpen, setDirectionOpen] = useState(false);

  const input = useRef<HTMLTextAreaElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const active = record ? stageDraft(record.state, stage) : null;
  const directionChange = requestsDirectionChange(feedback);
  const dirty = Boolean(active && value !== active.text);
  const visibleRun = run?.operation.stage === stage ? run : null;
  const latestStageRun = runs.find(item => item.stage === stage);
  const acceptedAngle = record ? stageDraft(record.state, "Angle") : null;

  const readRun = useCallback(async (id: string, signal: AbortSignal) => {
    const response = await fetch(`${endpoint}?reviewId=${id}`, { headers: { "X-Studio-Tenant": tenant }, cache: "no-store", signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to read the proposal.");
    return body.run as CreationRun;
  }, [tenant]);
  useEffect(() => {
    if (!activeReview) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll(id: string) {
      try {
        const next = await readRun(id, controller.signal);
        if (controller.signal.aborted) return;
        setRun(next);
        failures = 0;
        if (next.state === "queued" || next.state === "running") timer = setTimeout(() => void poll(id), 1800);
        else setNotice(next.state === "done" ? "Proposal ready for review." : "");
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (++failures <= 2) timer = setTimeout(() => void poll(id), 2500);
        else {
          setError(reason instanceof Error ? reason.message : "Unable to read the proposal.");
          setActiveReview(null);
        }
      }
    }
    void poll(activeReview);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [activeReview, readRun]);

  async function send(command: LocalCommand, baseRecord = record): Promise<false | { record?: CreationRecord }> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": tenant },
        body: JSON.stringify({ ...command, recordId, version: baseRecord?.version ?? 0 }) });
      const body = await response.json();
      if (!response.ok) {
        if (command.action === "generate" && response.status < 500) attempt.current = null;
        throw new Error(body.error || "The draft could not be saved.");
      }
      if (body.record) {
        const saved = body.record as CreationRecord;
        setRecord(saved); setValue(stageDraft(saved.state, stage).text); setSelection(null);
        if (command.action === "apply") { setRun(null); setActiveReview(null); }
        if (!baseRecord) {
          const url = new URL(window.location.href);
          url.searchParams.delete("source");
          if (sourceWorkspace) url.searchParams.set("mode", "create");
          url.searchParams.set("draft", saved.id);
          window.history.replaceState(null, "", url);
        }
        setNotice(command.action === "undo" ? "Edit undone." : command.action === "use" || command.action === "apply" ? "Applied to draft." : "Saved.");
      } else if (body.reviewId && command.action === "generate") {
        attempt.current = null;
        setRun(null);
        setActiveReview(body.reviewId);
        setRuns(previous => [{ id: body.reviewId, stage, kind: command.kind, created_at: new Date().toISOString() }, ...previous.filter(item => item.id !== body.reviewId)]);
        setNotice("Proposal queued.");
      }
      return { record: body.record as CreationRecord | undefined };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request could not be confirmed.");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function move(next: CreationStage) {
    if (!record || next === stage) return;
    if (dirty) { setError("Save or discard this edit before changing stages."); return; }
    setFeedback("");
    setStage(next); setValue(stageDraft(record.state, next).text); setSelection(null); setError(""); setNotice("");
    const url = new URL(window.location.href);
    if (next === "Concept") url.searchParams.delete("stage");
    else url.searchParams.set("stage", next.toLowerCase());
    window.history.replaceState(null, "", url);
  }
  function currentSelection(): Selection | null {
    const field = input.current;
    if (!field || field.selectionStart === field.selectionEnd) return null;
    const start = field.selectionStart, end = field.selectionEnd;
    return { start, end, text: field.value.slice(start, end) };
  }
  function openPanel(next: Panel, trigger: HTMLElement, kind: "suggest" | "draft" = "suggest") {
    setError("");
    if (dirty) { setError("Save this edit before using contextual actions."); return; }
    const selected = next === "generate" ? null : currentSelection() ?? selection;
    if (next === "selection" && (!selected?.text.trim() || selected.text.length > SELECTION_LIMIT)) {
      setError("Select the exact words to change, up to 1,800 characters.");
      input.current?.focus();
      return;
    }
    setSelection(selected);
    panelTrigger.current = trigger;
    setDraftId(""); setPurpose("compare"); setIncludeReferences(true);
    setFeedback(""); setReplacement(""); setRewrite(null); setGenerationKind(kind); setPanel(next);
  }
  async function generate(baseRecord = record, initialConcept = false, kind = generationKind) {
    const selected = linkedDrafts.find(draft => draft.id === draftId);
    const linkedDraft = selected ? { id: selected.id, version: selected.version, purpose } : null;
    const route = { provider, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription", includeReferences, linkedDraft };
    const parameters = initialConcept
      ? { ...route, action: "generate" as const, kind: "suggest" as const, stage: "Concept" as const, feedback: firstFocus }
      : rewrite && selection && (!sourceWorkspace || panel === "selection")
      ? { ...route, action: "generate" as const, kind: "rewrite" as const, stage, feedback, selection, instruction: rewrite }
      : { ...route, action: "generate" as const, kind, stage, feedback };
    const fingerprint = JSON.stringify([baseRecord?.version, parameters]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    if (await send({ ...parameters, requestId: attempt.current.requestId }, baseRecord)) setPanel(null);
  }
  async function confirm(brief: string, direction: Parameters<React.ComponentProps<typeof CreationDirection>["onConfirm"]>[1]) {
    // The same shared parser canonicalizes rationale and confirms direction on the server.
    const directionInput = { ...direction, rationale: "" };
    const command: LocalCommand = record
      ? { action: "direction", brief, direction: directionInput }
      : { action: "create", brief, direction: directionInput, sourceId: source?.id ?? null, sourceVersion: source?.version ?? null, templateId: null };
    const saved = await send(command);
    if (!saved) return;
    setDirectionOpen(false);
    if (!record && sourceWorkspace && saved.record) {
      setFeedback(firstFocus);
      await generate(saved.record, true);
    }
  }

  const pending = Boolean(activeReview && (!run || run.state === "running" || run.state === "queued"));
  const stageControls = "min-h-11";
  const sourceDirection = !record && sourceWorkspace && assistant ? createPortal(
    <div className="space-y-3">
      <p>I’ll suggest original ideas using the saved evidence from this source.</p>
      <Button type="button" variant="link" className="min-h-11 px-0" onClick={() => {
        sourceWorkspace.setCreating(false);
        const url = new URL(window.location.href);
        url.searchParams.delete("mode");
        window.history.replaceState(null, "", url);
        window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: "knowledge" }));
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
      }}>Review source knowledge</Button>
      <CreationDirection sourceFirst publisher={publisher} source={source} busy={busy} onConfirm={confirm}
        submitLabel={provider === "openai" ? "Confirm and suggest ideas with paid API" : "Confirm and suggest ideas on my Mac"}>
        <CreationFeedback id="source-creation-goal" label="Anything to focus on? (optional)" value={firstFocus} onChange={setFirstFocus} />
        <StudioTextProviderChoice stagedCreation compact provider={provider} onChange={setProvider} />
      </CreationDirection>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>, assistant) : null;
  const sourceCoach = record && sourceWorkspace && assistant ? createPortal(
    <section className="space-y-3" aria-label={`${stage} assistant`}>
      <p className="font-medium">{stage}</p>
      <p className="text-muted-foreground">{pending ? "Preparing a proposal…" : visibleRun?.state === "done" ? "Your suggestions are ready to review." : stageHint[stage]}</p>
      <CreationFeedback id="source-creation-feedback" label="What should I focus on? (optional)" value={feedback} onChange={setFeedback} />
      {directionChange ? <Button type="button" variant="outline" className={stageControls} onClick={() => setDirectionOpen(true)}>Confirm a new direction</Button> : null}
      <CreationNextContext recordId={recordId} drafts={linkedDrafts} includeReferences={includeReferences} onReferences={setIncludeReferences}
        draftId={draftId} onDraft={setDraftId} purpose={purpose} onPurpose={setPurpose} />
      <StudioTextProviderChoice stagedCreation compact provider={provider} onChange={setProvider} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" className={stageControls} disabled={busy || pending || dirty || directionChange}
          onClick={() => void generate(record, false, "suggest")}>{provider === "openai" ? "Get suggestions (paid)" : "Get suggestions on my Mac"}</Button>
        {stage === "Script" && <Button type="button" variant="outline" className={stageControls} disabled={busy || pending || dirty || directionChange}
          onClick={() => void generate(record, false, "draft")}>{provider === "openai" ? "Draft script (paid)" : "Draft script on my Mac"}</Button>}
      </div>
      {visibleRun?.state === "done" && <Button type="button" variant="link" className="min-h-11 px-0 lg:hidden" onClick={() => document.getElementById("creation-stage-heading")?.focus()}>Review proposal</Button>}
      <p role="status" className="text-muted-foreground">{notice}</p>
      {error && !panel && <p role="alert" className="text-destructive">{error}</p>}
    </section>, assistant) : null;
  return <div className="min-w-0 space-y-4">
    {sourceDirection}{sourceCoach}
    {!record ? <>
      {source && <SourceSummary source={source} embedded={Boolean(sourceWorkspace)} />}
      {!sourceWorkspace && <section className="rounded-xl border bg-card p-4 sm:p-6" aria-label="Video direction">
        <CreationDirection publisher={publisher} source={source} busy={busy} onConfirm={confirm} />
      </section>}
    </> : <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 px-4 py-2">
        <p className="min-w-0 break-words text-sm">
          <span className="font-medium">{record.state.direction.publisher || "Supplied brief"}</span>
          {record.state.direction.viewer && <span className="text-muted-foreground"> · {record.state.direction.viewer}</span>}
        </p>
        <Button className={stageControls} type="button" variant="ghost" disabled={busy || dirty}
          onClick={() => setDirectionOpen(open => !open)} aria-expanded={directionOpen} aria-controls="creation-direction">
          {directionOpen ? "Close direction" : "Change direction"}
        </Button>
      </div>
      {directionOpen && <section id="creation-direction" className="rounded-xl border bg-card p-4 sm:p-6" aria-label="Change video direction">
        <CreationDirection initialBrief={record.state.brief} initial={record.state.direction} publisher={publisher} source={source} busy={busy} onConfirm={confirm} />
      </section>}
      <nav aria-label="Creation stages" className="flex flex-wrap gap-1 rounded-xl border bg-muted/30 p-1.5">
        {CREATION_STAGES.map(item => {
          const current = stageDraft(record.state, item);
          return <Button key={item} type="button" variant={stage === item ? "default" : "ghost"} className={`${stageControls} flex-1 gap-1.5 px-3`}
            aria-current={stage === item ? "step" : undefined} aria-controls="creation-stage" disabled={busy} onClick={() => move(item)}>
            {current.approved && <Check aria-label="approved" className="size-3.5 shrink-0" />}{item}
          </Button>;
        })}
      </nav>
      <section id="creation-stage" aria-labelledby="creation-stage-heading" className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1"><h2 id="creation-stage-heading" tabIndex={-1} className="text-xl font-semibold">{stage}</h2><p className="text-sm text-muted-foreground">{stageHint[stage]}</p></div>
          {!sourceWorkspace && <Button type="button" variant="outline" className={`${stageControls} gap-2`} disabled={busy || pending} onClick={event => openPanel("generate", event.currentTarget)}>
            <Sparkles aria-hidden="true" className="size-4" /> Get suggestions
          </Button>}
          {!sourceWorkspace && stage === "Script" && <Button type="button" variant="outline" className={stageControls} disabled={busy || pending} onClick={event => openPanel("generate", event.currentTarget, "draft")}>Draft full script</Button>}
        </div>
        {latestStageRun && !visibleRun && !pending && <Button type="button" variant="link" className="min-h-11 px-0" disabled={busy || dirty}
          onClick={() => { setRun(null); setActiveReview(latestStageRun.id); }}>
          Inspect last run
        </Button>}
        {stage === "Script" && <label className="flex flex-wrap items-center gap-2 text-sm font-medium">Pinned template
          <select className="min-h-11 max-w-full rounded-md border bg-background px-3 text-sm" value={record.templateId ?? ""} disabled={busy || dirty}
            onChange={event => void send({ action: "template", templateId: event.target.value || null })}>
            <option value="">No template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}
          </select>
        </label>}
        <label htmlFor="creation-stage-text" className="sr-only">{stage} text</label>
        <Textarea id="creation-stage-text" ref={input} value={value} className={`text-base leading-relaxed ${stage === "Script" ? "min-h-72" : "min-h-32"}`}
          maxLength={stageTextLimit(stage)} disabled={busy} spellCheck onSelect={() => setSelection(currentSelection())} onChange={event => { setValue(event.target.value); setSelection(null); }} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" className={stageControls} disabled={busy || !value.trim() || Boolean(active?.approved && !dirty)} onClick={() => void send({ action: "use", stage, text: value })}>
            {stage === "Angle" ? "Confirm angle" : stage === "Script" ? "Approve script for use" : "Approve for use"}
          </Button>
          {dirty && <><Button type="button" variant="outline" className={stageControls} disabled={busy} onClick={() => void send({ action: "save", stage, text: value })}>Save edit</Button>
            <Button type="button" variant="ghost" className={stageControls} onClick={() => { setValue(active?.text ?? ""); setSelection(null); setError(""); }}>Discard edit</Button></>}
          <Button type="button" variant="ghost" className={`${stageControls} gap-2 ${selection ? "bg-accent" : ""}`} disabled={busy}
            onMouseDown={event => { if (currentSelection()) event.preventDefault(); }}
            onClick={event => openPanel("selection", event.currentTarget)}>
            <Scissors aria-hidden="true" className="size-4" /> Selection actions
          </Button>
          <Button type="button" variant="ghost" className={`${stageControls} gap-2`} disabled={busy} onClick={event => openPanel("comment", event.currentTarget)}>
            <MessageSquare aria-hidden="true" className="size-4" /> Comment
          </Button>
          {active?.previous && !dirty && <Button type="button" variant="ghost" className={`${stageControls} gap-2`} disabled={busy} onClick={() => void send({ action: "undo", stage })}><Undo2 aria-hidden="true" className="size-4" /> Undo last edit</Button>}
        </div>
        {visibleRun && <Proposal run={visibleRun} stale={visibleRun.stale || visibleRun.version !== record.version}
          applied={record.state.history.some(item => item.reviewId === visibleRun.id)} disabled={busy || dirty} onApply={candidate => void send({ action: "apply", stage, reviewId: visibleRun.id, candidate })}
          onShortlist={text => void send({ action: "shortlist", stage, text })} />}
        {active?.shortlist.length ? <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Shortlist ({active.shortlist.length})</summary>
          <ul className="mt-3 space-y-2">{active.shortlist.map(text => <li key={text} className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 basis-36 whitespace-pre-wrap break-words text-sm">{text}</p>
            <Button className={stageControls} type="button" variant="outline" disabled={dirty || busy} onClick={() => void send({ action: "use", stage, text })}>Use option</Button>
          </li>)}</ul>
        </details> : null}
      </section>
      <div className="grid gap-2 sm:grid-cols-3">
        <details className="min-w-0 rounded-xl border p-3">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">Evidence & direction <ArrowRight aria-hidden="true" className="size-3" /></summary>
          <div className="mt-2 space-y-3 text-sm">
            {source && <SourceSummary source={source} embedded={Boolean(sourceWorkspace)} />}
            <p><strong>Confirmed goal</strong><br />{record.state.direction.choice === "brief" ? "Follow the supplied brief." : record.state.direction.goal}</p>
            {(acceptedAngle?.approved || record.state.direction.angle) && <p className="whitespace-pre-wrap break-words"><strong>Confirmed angle</strong><br />{acceptedAngle?.approved ? acceptedAngle.text : record.state.direction.angle}</p>}
            <p>{record.state.direction.rationale}</p>
            {record.state.brief && <p className="whitespace-pre-wrap break-words"><strong>Supplied brief</strong><br />{record.state.brief}</p>}
            <Link className="text-primary underline" href={`/studio/records/${recordId}/links?kind=reference`}>Manage linked research</Link>
          </div>
        </details>
        <details className="min-w-0 rounded-xl border p-3">
          <summary className="min-h-11 cursor-pointer py-2.5 font-medium">Decision history</summary>
          <ul className="mt-2 space-y-2 break-words text-sm">
            {record.state.history.map((item, index) => <li key={`${item.at}:${index}`}><strong>{item.stage ?? "Brief"}</strong> · {item.note}{item.quote && <blockquote className="mt-1 border-l pl-2 text-muted-foreground">{item.quote}</blockquote>}</li>)}
            {!record.state.history.length && <li>Direction confirmed.</li>}
            {runs.map(item => <li key={item.id}><Button variant="link" type="button" className="h-auto min-h-11 whitespace-normal p-0 text-left" disabled={dirty || busy}
              onClick={() => { move(item.stage as CreationStage); setRun(null); setActiveReview(item.id); }}>
              Open {item.stage.toLowerCase()} {item.kind === "draft" ? "draft" : item.kind === "rewrite" ? "rewrite" : "suggestions"}
              <span className="ml-2 text-xs text-muted-foreground">{item.created_at.slice(0, 10)}</span>
            </Button></li>)}
          </ul>
        </details>
        <details className="min-w-0 rounded-xl border p-3">
          <summary className="min-h-11 cursor-pointer py-2.5 font-medium">Whole script</summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{stageDraft(record.state, "Script").text || "The current script will appear here after you save it."}</p>
        </details>
      </div>
    </>}
    {!sourceWorkspace && <div aria-live="polite" className="text-sm text-muted-foreground">{notice || (pending ? "Preparing a proposal…" : "")}</div>}
    {!sourceWorkspace && error && !panel && <p role="alert" className="text-sm text-destructive">{error} <Button type="button" onClick={() => window.location.reload()} className={stageControls} variant="link">Reload draft</Button></p>}
    <Sheet open={panel !== null} onOpenChange={open => { if (!open && !busy) setPanel(null); }}>
      <SheetContent side="bottom" className="mx-auto max-h-[90dvh] max-w-xl space-y-4 overflow-y-auto rounded-t-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] motion-reduce:transition-none sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-xl [&>button:last-child]:grid [&>button:last-child]:size-11 [&>button:last-child]:place-items-center"
        onCloseAutoFocus={event => { event.preventDefault(); panelTrigger.current?.focus(); }}>
        <SheetHeader>
          <SheetTitle>{panel === "comment" ? `Comment on ${stage.toLowerCase()}` : panel === "selection" ? "Edit selected words" : generationKind === "draft" ? "Draft a script" : `Suggestions for ${stage.toLowerCase()}`}</SheetTitle>
          <SheetDescription>{panel === "comment" ? "Save feedback with this stage." : panel === "selection" ? "Choose how to change the selected passage." : "Review the proposal before applying it to the draft."}</SheetDescription>
        </SheetHeader>
        {(panel === "selection" || panel === "comment") && selection && <blockquote className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{selection.text}</blockquote>}
        {panel === "selection" && <div className="space-y-3">
          <div className="flex flex-wrap gap-2" aria-label="AI selection actions">
            {REWRITE_ACTIONS.map(item => <Button key={item} className={stageControls} type="button" variant={rewrite === item ? "default" : "outline"} aria-pressed={rewrite === item} onClick={() => setRewrite(item)}>{item}</Button>)}
            {rewrite && <Button className={stageControls} type="button" variant="ghost" onClick={() => setRewrite(null)}>Replace exactly</Button>}
          </div>
          {!rewrite && <form className="space-y-2" onSubmit={async event => { event.preventDefault();
            if (selection && await send({ action: "replace", stage, selection, text: replacement })) setPanel(null);
          }}>
            <label className="block space-y-1 text-sm font-medium">Exact replacement<Textarea className="text-base" value={replacement} maxLength={SELECTION_LIMIT} onChange={event => setReplacement(event.target.value)} /></label>
            <Button type="submit" className={stageControls} disabled={busy}>{replacement ? "Replace selected words" : "Remove selected words"}</Button>
          </form>}
        </div>}
        {(panel === "generate" || panel === "comment" || rewrite) && <CreationFeedback id="creation-feedback" label={panel === "comment" ? "Comment" : "Feedback for this stage (optional)"} value={feedback} onChange={setFeedback} />}
        {panel === "comment" && <Button type="button" className={stageControls} disabled={!feedback.trim() || busy}
          onClick={async () => { if (await send({ action: "comment", stage, selection, text: feedback })) setPanel(null); }}>Save comment</Button>}
        {(panel === "generate" || rewrite) && <div className="space-y-3">
          <CreationNextContext recordId={recordId} drafts={linkedDrafts} includeReferences={includeReferences} onReferences={setIncludeReferences}
            draftId={draftId} onDraft={setDraftId} purpose={purpose} onPurpose={setPurpose} />
          <StudioTextProviderChoice stagedCreation provider={provider} onChange={setProvider} />
          {directionChange && <p role="status" className="text-sm">Confirm the new video direction before generating. <Button type="button" variant="link" className={stageControls}
            onClick={() => { setPanel(null); setDirectionOpen(true); }}>Review direction</Button></p>}
          <Button type="button" className={stageControls} disabled={busy || pending || directionChange} onClick={() => void generate()}>
            {busy ? "Submitting…" : provider === "openai" ? "Generate with paid API" : "Generate on my Mac"}
          </Button>
        </div>}
        {error && panel && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </SheetContent>
    </Sheet>
  </div>;
}

function SourceSummary({ source, embedded }: { source: CreationSource; embedded: boolean }) {
  return <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
    <p className="font-medium">Source concept</p>
    {embedded ? <p className="break-words">{source.title}</p> : <Link className="break-words text-primary underline" href={`/studio/library/${source.id}`}>{source.title}</Link>}
    {source.concept !== source.title && <p className="break-words">{source.concept}</p>}
    <p className="text-xs text-muted-foreground">{source.basis} · source version {source.version}</p>
  </div>;
}

function Proposal({ run, stale, applied, disabled, onApply, onShortlist }: {
  run: CreationRun; stale: boolean; applied: boolean; disabled: boolean; onApply: (index: number | null) => void; onShortlist: (text: string) => void;
}) {
  if (run.state === "failed") return <p role="alert" className="break-words rounded-lg border p-3 text-sm text-destructive">{run.error}</p>;
  if (!run.result) return <p role="status" className="text-sm text-muted-foreground">{run.state === "queued" ? "Queued for the selected provider." : "Generating proposal…"}</p>;
  const result = run.result;
  const selected = run.operation.kind === "rewrite" ? run.operation.selection.text : null;
  return <section aria-label="Proposal preview" className="min-w-0 space-y-3 rounded-xl border bg-muted/30 p-4">
    <h3 className="font-semibold">{result.options.length ? `${result.options.length} ${result.options.length === 1 ? "suggestion" : "suggestions"}` : selected ? "Rewrite preview" : "Script draft preview"}</h3>
    {applied ? <p className="text-sm text-muted-foreground">Applied in an earlier edit. You’re viewing the saved proposal.</p>
      : stale && <p className="text-sm text-muted-foreground">Draft or source changed since this proposal. Generate a fresh one to apply it.</p>}
    <p className="break-words text-sm text-muted-foreground">{result.rationale}</p>
    {result.options.length ? <ol className="space-y-2">
      {result.options.map((option, index) => <li key={option.text} className="min-w-0 space-y-2 rounded-lg border bg-card p-3">
        <p className="whitespace-pre-wrap break-words">{option.text}</p>
        <p className="break-words text-sm text-muted-foreground">{option.rationale}</p>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" type="button" disabled={stale || disabled} onClick={() => onApply(index)}>Use suggestion</Button>
          <Button className="min-h-11" type="button" variant="outline" disabled={disabled} onClick={() => onShortlist(option.text)}>Shortlist</Button>
        </div>
      </li>)}
    </ol> : <div className="space-y-3">
      {selected && <p className="whitespace-pre-wrap break-words text-sm"><strong>Original</strong><br />{selected}</p>}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed"><strong>{selected ? "Replacement" : "Proposed script"}</strong><br />{result.text}</p>
      <Button className="min-h-11" type="button" disabled={stale || disabled} onClick={() => onApply(null)}>{selected ? "Apply rewrite" : "Use script"}</Button>
    </div>}
    {result.verification.length > 0 && <div className="space-y-1 text-sm"><strong>Verify before filming</strong><ul className="list-disc space-y-1 pl-4">{result.verification.map((item, i) => <li className="break-words" key={i}>{item}</li>)}</ul></div>}
    <CreationRunContext run={run} />
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">Generation evidence</summary>
      <p className="break-words text-muted-foreground">{[run.model, run.profileVersion ? `Business profile v${run.profileVersion}` : null, run.template].filter(Boolean).join(" · ")}</p>
      {run.evidence.length ? <ul className="mt-2 space-y-2">{run.evidence.map(item => <li key={item.id} className="break-words rounded-md border p-2">
        <Link className="text-primary underline" href={`/studio/library/${item.sourceId}`}>{item.title}</Link>
        <span className="ml-2 text-muted-foreground">{item.type}{item.start ? ` · ${item.start}s` : ""}{result.evidenceIds.includes(item.id) ? " · cited" : ""}</span>
        {item.statement && <p>{item.statement}</p>}<blockquote className="whitespace-pre-wrap text-muted-foreground">{item.quote}</blockquote>
      </li>)}</ul> : <p>No eligible saved evidence was supplied.</p>}
    </details>
  </section>;
}
