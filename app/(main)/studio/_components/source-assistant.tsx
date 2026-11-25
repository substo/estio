"use client";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Loader2, MessageSquare, Mic, MicOff, NotebookPen, Search, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { saveSourceNoteAction } from "../(tenant)/library/note-actions";
import { draftIdeaFromReactions, relatedSearchPhrase, REACTION_LIMIT } from "@/lib/studio/source-assistant-policy";
import type { SourceAssistRun } from "@/lib/studio/source-assist";
import { studioTextConsent } from "@/lib/studio/text-provider";
import { StudioTextProviderChoice } from "./text-provider-choice";
import { useStudioTenantHeaders } from "./studio-tenant-context";
import { DRAFT_FROM_FINDINGS_EVENT, useSourceWorkspace } from "./source-workspace";
import { OPEN_TAB_EVENT } from "./source-tabs";
import type { ProposalFocus } from "@/lib/studio/citation-navigation";
import { AgentChat, type AgentResume, type AgentSource } from "./agent-chat";
import type { AgentTurnView } from "@/lib/studio/agent";

type Intent = "discuss" | "rewrite_note" | "propose_idea";
type Mode = Intent | "knowledge" | "template";
export type KnowledgeInput = { inputId: string; mode: string; label: string };
type AiState = { reviewId: string; run: SourceAssistRun | null; error: string | null; waited: boolean; intent: Intent };
type Entry = { id: number; role: "you" | "assistant" | "ai"; text: string; saved?: boolean; tone?: "error"; ai?: AiState; link?: { href: string; label: string } };
type Recognition = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null };
export const RELATED_SEARCH_EVENT = "studio:related-search";
const INTENTS: Array<{ value: Mode; label: string; hint: string }> = [
  { value: "discuss", label: "Discuss", hint: "Answer about this video" },
  { value: "rewrite_note", label: "Notes", hint: "Tidy my words into a note" },
  { value: "propose_idea", label: "Idea", hint: "Draft a linked idea" },
  { value: "knowledge", label: "Knowledge", hint: "Extract cited takeaways for review" },
  { value: "template", label: "Script template", hint: "Extract reusable writing beats for review" },
];
const clock = (seconds: number) => new Date(seconds * 1000).toISOString().slice(seconds >= 3600 ? 11 : 14, 19);

export function SourceAssistant({ locationId, sourceId, sourceTitle, version, canRelated, archived, hasEvidence, knowledgeInputs, canTemplate, canCreate, agent }: { agent?: { source: AgentSource; turns: AgentTurnView[]; focusProposal?: ProposalFocus | null; newDraftHref: string; resume: AgentResume | null; scope: string; sessionKey: string }; knowledgeInputs: KnowledgeInput[]; canTemplate: boolean; canCreate?: boolean; locationId: string; sourceId: string; sourceTitle: string; version: number; canRelated: boolean; archived: boolean; hasEvidence: boolean }) {
  const router = useRouter();
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const [open, setOpen] = useState(false);
  const draftOrigin = useRef<HTMLElement | null>(null);
  const [log, setLog] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const { setNoteProposal, setIdeaProposal, findingSelection, setFindingSelection, provider, setProvider, creating, setCreating } = useSourceWorkspace();
  const [inputChoice, setInputChoice] = useState(0);
  const knowledgeInput = knowledgeInputs[inputChoice] ?? null;
  const showIn = (tab: string, line: string) => {
    setOpen(false);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: tab }));
      if (tab === "script") requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-idea-draft-title]")?.focus());
    }, 50);
    push({ role: "assistant", text: line });
  };
  const [listening, setListening] = useState(false);
  const [dictationNote, setDictationNote] = useState("");
  const [canDictate, setCanDictate] = useState(false);
  const fieldId = useId();
  const [mode, setMode] = useState<Mode>("discuss");
  useEffect(() => {
    const openDraft = (event: Event) => {
      setCreating(false);
      setMode("propose_idea");
      if (window.matchMedia("(min-width: 1024px)").matches) {
        requestAnimationFrame(() => document.getElementById(`${fieldId}-side`)?.focus());
      } else {
        const origin = (event as CustomEvent<unknown>).detail;
        draftOrigin.current = origin instanceof HTMLElement ? origin : null;
        setOpen(true);
      }
    };
    window.addEventListener(DRAFT_FROM_FINDINGS_EVENT, openDraft);
    return () => window.removeEventListener(DRAFT_FROM_FINDINGS_EVENT, openDraft);
  }, [fieldId, setCreating]);

  const taskMode = mode === "knowledge" || mode === "template";
  const selectedIdea = mode === "propose_idea" && findingSelection;
  const intent: Intent = taskMode ? "discuss" : mode;
  const [asking, setAsking] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const requestKey = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { setCanDictate(typeof window !== "undefined" && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; recognition.current?.stop(); }; }, []);
  const push = useCallback((entry: Omit<Entry, "id">) => { const id = ++counter.current; setLog(previous => [...previous, { ...entry, id }]); return id; }, []);
  const patchAi = (id: number, patch: Partial<AiState>) => setLog(previous => previous.map(item => item.id === id && item.ai ? { ...item, ai: { ...item.ai, ...patch } } : item));
  const reactions = log.filter(entry => entry.role === "you").map(entry => entry.text);

  function toggleDictation() {
    if (listening) { recognition.current?.stop(); return; }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const engine: Recognition = new Ctor();
    engine.continuous = true; engine.interimResults = false; engine.lang = navigator.language || "en-US";
    engine.onresult = event => { let heard = ""; for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) heard += event.results[i][0].transcript; if (heard) setText(previous => `${previous}${previous && !/\s$/.test(previous) ? " " : ""}${heard.trim()}`.slice(0, REACTION_LIMIT)); };
    engine.onerror = event => setDictationNote(event.error === "not-allowed" ? "Microphone access was blocked. You can type instead." : "Dictation stopped. You can keep typing.");
    engine.onend = () => { setListening(false); recognition.current = null; };
    setDictationNote(""); recognition.current = engine; setListening(true);
    try { engine.start(); } catch { setListening(false); setDictationNote("Dictation could not start. You can type instead."); }
  }
  function takeText() { const value = text.trim(); if (!value) return null; recognition.current?.stop(); push({ role: "you", text: value }); setText(""); return value; }
  async function saveNote(value: string | null, entryId?: number) {
    if (!value) { push({ role: "assistant", text: "Write or dictate a reaction first.", tone: "error" }); return false; }
    setSaving(true);
    const result = await saveSourceNoteAction(locationId, sourceId, value).catch(() => ({ ok: false as const, error: "Could not reach Studio. Your words are still here; try again." }));
    setSaving(false);
    if (result.ok) { if (entryId) setLog(previous => previous.map(item => item.id === entryId ? { ...item, saved: true } : item)); push({ role: "assistant", text: "Saved to My notes." }); router.refresh(); return true; }
    push({ role: "assistant", text: result.error, tone: "error" }); return false;
  }
  async function saveAsWritten() { const value = text.trim() || null; if (await saveNote(value)) { const saved = takeText(); if (saved) setLog(previous => previous.map(item => item.role === "you" && item.text === saved && !item.saved ? { ...item, saved: true } : item)); } }
  function draftIdea() { const spoken = text.trim() ? [...reactions, text.trim()] : reactions; if (!spoken.length) { push({ role: "assistant", text: "Tell me your reaction first, or use Propose idea to ask the assistant.", tone: "error" }); return; } takeText(); setIdeaProposal(draftIdeaFromReactions(sourceTitle, spoken)); showIn("script", "Drafted an idea from your words. Review it in the Script tab before it is created."); }
  function findRelated(phrase?: string) {
    const query = phrase || relatedSearchPhrase(text.trim() ? [...reactions, text.trim()] : reactions, sourceTitle);
    takeText(); setOpen(false);
    window.setTimeout(() => {
      document.getElementById("related")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      window.dispatchEvent(new CustomEvent(RELATED_SEARCH_EVENT, { detail: { phrase: query } }));
    }, 50);
    push({ role: "assistant", text: `Searching related videos for “${query}”. Your Mac ranks them; results appear under Related videos.` });
  }

  async function poll(entryId: number, reviewId: string) {
    const started = Date.now();
    while (alive.current) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (!alive.current) return;
      try {
        const response = await fetch(`/studio/assistant/api?reviewId=${encodeURIComponent(reviewId)}`, { headers: { "X-Studio-Tenant": tenant }, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not read the answer.");
        const run = data.run as SourceAssistRun;
        patchAi(entryId, { run });
        if (run.status === "done" || run.status === "failed") return;
        if (Date.now() - started > 20_000) patchAi(entryId, { waited: true });
        if (Date.now() - started > 3 * 60_000) { patchAi(entryId, { error: "Your Mac did not answer yet. It keeps the request; check Connected computer, then ask again if needed." }); return; }
      } catch (error) { patchAi(entryId, { error: error instanceof Error ? error.message : "Could not read the answer." }); return; }
    }
  }
  async function runTask() {
    if (asking) return;
    const knowledge = mode === "knowledge";
    if (knowledge && !knowledgeInput) { push({ role: "assistant", text: "Knowledge needs a saved transcript or source text first.", tone: "error" }); return; }
    requestKey.current ??= crypto.randomUUID();
    setAsking(true);
    try {
      const url = knowledge ? "/studio/knowledge/extractions/api" : "/studio/content/templates/from-video/api";
      const body = knowledge
        ? { action: "enqueueOutline", requestId: requestKey.current, sourceId, expectedVersion: version, inputId: knowledgeInput!.inputId, mode: knowledgeInput!.mode, ...studioTextConsent(provider, true) }
        : { requestId: requestKey.current, sourceId, expectedVersion: version, ...studioTextConsent(provider, true) };
      const response = await fetch(url, { method: "POST", headers: { "X-Studio-Tenant": tenant, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) requestKey.current = null; push({ role: "assistant", text: data.error || "The task could not start.", tone: "error" }); return; }
      requestKey.current = null;
      const id = knowledge ? data.outlineId : data.reviewId;
      push({ role: "assistant", text: knowledge ? "Knowledge extraction queued. Review the cited takeaways when it finishes:" : "Script template extraction started. Review the beats when it finishes:", link: { href: knowledge ? `/studio/knowledge/extractions/${id}` : `/studio/content/templates/from-video/${id}`, label: knowledge ? "Open knowledge review" : "Open template review" } });
      setOpen(false);
      // Switch tabs first: updating the URL hash after a refresh starts would restore the old page state over it.
      window.setTimeout(() => { window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: knowledge ? "knowledge" : "script" })); window.setTimeout(() => router.refresh(), 100); }, 50);
    } catch { push({ role: "assistant", text: "The outcome is unconfirmed. Press Run again to check this same request.", tone: "error" }); }
    finally { setAsking(false); }
  }
  async function ask() {
    if (taskMode) { await runTask(); return; }
    const message = text.trim();
    const selection = intent === "propose_idea" ? findingSelection : null;
    if ((!message && !selection) || asking) return;
    requestKey.current ??= crypto.randomUUID();
    setAsking(true);
    try {
      const response = await fetch("/studio/assistant/api", { method: "POST", headers: { "X-Studio-Tenant": tenant, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ requestId: requestKey.current, sourceId, expectedVersion: version, ...studioTextConsent(provider, true), intent, message, ...(selection ? { selection } : {}) }) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) requestKey.current = null; push({ role: "assistant", text: data.error || "The assistant could not start.", tone: "error" }); return; }
      requestKey.current = null; recognition.current?.stop(); setText("");
      if (selection) setFindingSelection(null);
      push({ role: "you", text: message || "Draft an idea from the selected takeaways." });
      const entryId = push({ role: "ai", text: "", ai: { reviewId: data.reviewId, run: null, error: null, waited: false, intent } });
      void poll(entryId, data.reviewId);
    } catch { push({ role: "assistant", text: "The outcome is unconfirmed. Press Ask again to check this same request.", tone: "error" }); }
    finally { setAsking(false); }
  }

  function AiAnswer({ entry }: { entry: Entry }) {
    const ai = entry.ai!; const run = ai.run; const result = run?.result;
    if (ai.error || run?.status === "failed") return <div role="alert" className="mr-6 space-y-1 rounded-lg bg-muted p-3 text-destructive"><p>{ai.error || run?.error}</p><p className="text-xs text-muted-foreground">Nothing was saved or created. You can ask again.</p></div>;
    if (!result) return <p role="status" className="mr-6 flex items-center gap-2 rounded-lg bg-muted p-3 text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />{run?.status === "running" ? "Your Mac is working on it…" : ai.waited ? "Waiting for your Mac… It must be on with the Studio companion running." : "Queued."}</p>;
    return <div className="mr-6 space-y-3 rounded-lg bg-muted p-3">
      <p className="whitespace-pre-wrap break-words">{result.reply}</p>
      {result.citations.length ? <ul className="space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">{result.citations.map((c, i) => <li key={i}>“{c.quote}”{run!.citedAt[c.unitId] != null ? <span className="ml-1 tabular-nums">· {clock(run!.citedAt[c.unitId]!)}</span> : null}</li>)}</ul> : null}
      {result.limitations.length ? <ul className="list-disc pl-5 text-xs text-muted-foreground">{result.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul> : null}
      {result.note ? <Button type="button" variant="secondary" disabled={archived} onClick={() => { setNoteProposal(result.note!); showIn("notes", "Showing the proposed note change in My notes. Nothing is saved until you apply it."); }}><NotebookPen aria-hidden="true" className="mr-2 h-4 w-4" />Review change in My notes</Button> : null}
      {result.ideaTitle && result.ideaConcept ? <Button type="button" variant="secondary" disabled={archived} onClick={() => { setIdeaProposal({ title: result.ideaTitle!, summary: result.ideaConcept!, ai: true, draftReviewId: run?.selectedOutline ? run.id : undefined, limitations: run?.selectedOutline ? result.limitations : undefined,
         evidence: run?.selectedOutline ? result.citations.flatMap(c => {
           const passage = run.citedPassage?.[c.unitId];
           return passage === undefined ? [] : [{ href: `/studio/knowledge/extractions/${run.selectedOutline}?passage=${passage}#unit-${passage}`,
             label: run.citedAt[c.unitId] == null ? "Source passage" : clock(run.citedAt[c.unitId]!), quote: c.quote }];
         }) : undefined }); showIn("script", "Showing the proposed idea in the Script tab. It is not created until you confirm."); }}><Lightbulb aria-hidden="true" className="mr-2 h-4 w-4" />Review proposed idea</Button> : null}
      {result.relatedQuery && canRelated ? <Button type="button" variant="outline" onClick={() => findRelated(result.relatedQuery!)}><Search aria-hidden="true" className="mr-2 h-4 w-4" />Search “{result.relatedQuery}”</Button> : null}
      <p className="text-xs text-muted-foreground">{run!.provider === "subscription" ? "Your Mac subscription" : "Location OpenAI key (paid)"} · {run!.model.replace(/^mac_/, "")} · {run!.evidence.kind === "description" ? "from the saved description only" : run!.evidence.kind === "selection" ? `${run!.evidence.selected} selected evidence references` : `${run!.evidence.selected} of ${run!.evidence.total} saved passages read`}{run!.stale ? " · source changed since" : ""}. Nothing is saved until you choose.</p>
    </div>;
  }

  function changeWorkspace(next: boolean) {
    setCreating(next);
    if (next) setOpen(false);
    requestAnimationFrame(() => {
      if (next) document.getElementById("source-assistant")?.focus();
      else if (opener.current?.offsetParent) opener.current.focus();
      else document.querySelector<HTMLButtonElement>("[data-create-entry]")?.focus();
    });
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("mode", "create");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
  }

  const createToggle = canCreate && <div className="shrink-0 border-t p-3">
      <Button type="button" variant={creating ? "outline" : "default"} className="min-h-11 w-full"
        data-create-entry onClick={() => changeWorkspace(!creating)}>{creating ? "Back to source research" : "Create with Studio"}</Button>
    </div>;
  const researchBody = (variant: string) => <>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Conversation">
      {!creating && log.length === 0 ? <p className="text-muted-foreground">Pick what to work on, then tell me your reaction. Everything is answered from this source only, and nothing is saved until you choose.</p> : null}
      {log.map(entry => entry.role === "you"
        ? <div key={entry.id} className="ml-6 space-y-1 rounded-lg bg-primary/10 p-3"><p className="whitespace-pre-wrap break-words">{entry.text}</p>{entry.saved ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Saved to My notes</p> : <button type="button" disabled={saving || archived} onClick={() => void saveNote(entry.text, entry.id)} className="inline-flex min-h-9 items-center text-xs font-medium text-primary hover:underline disabled:opacity-50">Save to My notes as written</button>}</div>
        : entry.role === "ai" ? <AiAnswer key={entry.id} entry={entry} />
        : <p key={entry.id} role={entry.tone === "error" ? "alert" : undefined} className={`mr-6 whitespace-pre-wrap break-words rounded-lg bg-muted p-3 ${entry.tone === "error" ? "text-destructive" : ""}`}>{entry.text}{entry.link ? <> <a href={entry.link.href} className="font-medium text-primary underline">{entry.link.label}</a></> : null}</p>)}
    </div>
    <div className={creating ? "hidden" : "space-y-2 border-t p-3"}>
      {archived ? <p className="text-xs text-muted-foreground">This source is archived, so notes and ideas are read-only.</p> : null}
      {selectedIdea ? <div className="flex flex-wrap items-center gap-2 rounded-md border px-2 text-sm">
        <span>{selectedIdea.selections.length} selected finding references</span>
        <Button type="button" variant="ghost" onClick={() => setFindingSelection(null)} disabled={asking}>Clear selection</Button>
      </div> : null}
      <label htmlFor={`${fieldId}-${variant}`} className="sr-only">Your reaction</label>
      <textarea id={`${fieldId}-${variant}`} data-assistant-field value={text} maxLength={REACTION_LIMIT} rows={2} disabled={archived} placeholder={selectedIdea ? "Optional: add your reaction or filming angle" : taskMode ? "Optional: nothing to type for this task." : "What stood out? What would you do differently?"} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return; if (selectedIdea) return; event.preventDefault(); if (!event.repeat && text.trim()) { takeText(); push({ role: "assistant", text: "Added. Choose Ask, or Save as written." }); } }}
        className="block w-full resize-none rounded-md border bg-background p-2 text-sm" />
      <fieldset disabled={archived || (!hasEvidence && !selectedIdea)}>
        <legend className="sr-only">Assistant mode</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Assistant mode">{INTENTS.filter(item => item.value !== "template" || canTemplate).map(item => <label key={item.value} title={item.hint} className={`inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${mode === item.value ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}><input type="radio" className="sr-only" name={`mode-${variant}`} checked={mode === item.value} onChange={() => setMode(item.value)} />{item.label}</label>)}</div>
      </fieldset>
      {mode === "knowledge" && knowledgeInputs.length > 1 ? <label className="flex items-center gap-2 text-xs">Evidence<select value={inputChoice} onChange={event => setInputChoice(Number(event.target.value))} className="min-h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs">{knowledgeInputs.map((item, index) => <option key={`${item.mode}:${item.inputId}`} value={index}>{item.label}</option>)}</select></label> : null}
      {hasEvidence || selectedIdea ? <StudioTextProviderChoice selectedIdea={Boolean(selectedIdea)} compact sourceAssist={!taskMode} fullSource={mode === "knowledge"} videoTemplate={mode === "template"} provider={provider} onChange={setProvider} />
        : <p className="text-xs text-muted-foreground">The assistant needs a saved transcript or description. Add one in the Transcript tab first.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void ask()} disabled={asking || archived || (!hasEvidence && !selectedIdea) || (taskMode ? (mode === "knowledge" && !knowledgeInput) : (!text.trim() && !selectedIdea))} className="min-h-10">{asking ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles aria-hidden="true" className="mr-2 h-4 w-4" />}{taskMode ? (mode === "knowledge" ? "Extract knowledge" : "Extract template") : selectedIdea ? "Generate idea draft" : "Ask"}</Button>
        {taskMode ? null : <Button type="button" variant="outline" onClick={() => void saveAsWritten()} disabled={saving || archived || !text.trim()} className="min-h-10"><NotebookPen aria-hidden="true" className="mr-2 h-4 w-4" />Save as written</Button>}
        {canDictate ? <Button type="button" variant="outline" size="icon" onClick={toggleDictation} aria-pressed={listening} aria-label={listening ? "Stop dictation" : "Dictate"} disabled={archived} className="h-10 w-10">{listening ? <MicOff aria-hidden="true" className="h-4 w-4" /> : <Mic aria-hidden="true" className="h-4 w-4" />}</Button> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={draftIdea} disabled={archived} className="min-h-9 px-2 text-xs"><Lightbulb aria-hidden="true" className="mr-1.5 h-4 w-4" />Draft idea from my words</Button>
        {canRelated ? <Button type="button" variant="ghost" onClick={() => findRelated()} className="min-h-9 px-2 text-xs"><Search aria-hidden="true" className="mr-1.5 h-4 w-4" />Find related videos</Button> : null}
      </div>
      <p role="status" className="text-xs text-muted-foreground">{listening ? "Listening…" : dictationNote}</p>
    </div>
    {createToggle}
  </>;
  const body = (variant: string) => creating && agent
    ? <><AgentChat key={agent.sessionKey} locationId={locationId} source={agent.source} initialTurns={agent.turns} focusProposal={agent.focusProposal} provider={provider} onProvider={setProvider} newDraftHref={agent.newDraftHref} resume={agent.resume} scope={agent.scope} />{createToggle}</>
    : researchBody(variant);
  const header = <div className="min-w-0"><h2 className="font-semibold">Assistant</h2><p className="truncate text-xs text-muted-foreground">{creating ? "Creating from: " : "Only this source: "}{sourceTitle}</p></div>;
  return <>
    {!creating && <button ref={opener} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="fixed bottom-4 right-4 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-lg lg:hidden"><MessageSquare aria-hidden="true" className="h-4 w-4" />Assistant</button>}
    <aside id="source-assistant" tabIndex={-1} aria-label="Source assistant" className={`min-h-0 flex-col rounded-xl border bg-card text-sm lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-2rem)] ${creating ? "order-first flex max-h-[85dvh] lg:order-none" : "hidden"}`}>
      <header className="border-b px-4 py-3">{header}</header>
      {body("side")}
    </aside>
    <Sheet open={open && !creating} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="flex max-h-[88dvh] flex-col gap-0 rounded-t-2xl p-0 text-sm lg:hidden" ref={sheetRef} onOpenAutoFocus={event => { event.preventDefault(); sheetRef.current?.querySelector<HTMLElement>("[data-assistant-field]")?.focus(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          (creating ? document.getElementById("source-assistant") : draftOrigin.current?.isConnected ? draftOrigin.current : opener.current)?.focus();
          draftOrigin.current = null;
        }}>
        <div className="border-b px-4 py-3 pr-12"><SheetTitle className="text-base">Assistant</SheetTitle><SheetDescription className="truncate text-xs">{creating ? "Creating from: " : "Only this source: "}{sourceTitle}</SheetDescription></div>
        {open && !creating ? body("sheet") : null}
      </SheetContent>
    </Sheet>
  </>;
}
