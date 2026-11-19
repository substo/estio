"use client";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Loader2, MessageSquare, Mic, MicOff, NotebookPen, Search, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { createSourceIdeaAction } from "../(tenant)/content/actions";
import { saveSourceNoteAction } from "../(tenant)/library/note-actions";
import { draftIdeaFromReactions, relatedSearchPhrase, REACTION_LIMIT } from "@/lib/studio/source-assistant-policy";
import type { SourceAssistRun } from "@/lib/studio/source-assist";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import { StudioTextProviderChoice } from "./text-provider-choice";
import { useStudioTenantHeaders } from "./studio-tenant-context";

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

function IdeaDraft({ locationId, sourceId, ideaId, initial, onCancel }: { locationId: string; sourceId: string; ideaId: string; initial: { title: string; summary: string; ai?: boolean }; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createSourceIdeaAction.bind(null, locationId, sourceId, ideaId), {});
  const titleId = useId();
  return <form action={action} className="space-y-3 rounded-lg border bg-background p-3 text-sm">
    <p className="font-medium">Review the idea before it is created</p>
    <p className="text-xs text-muted-foreground">{initial.ai ? "Proposed by the assistant from this source. Edit freely." : "Assembled from your own words, not generated."} This source is linked as research; nothing is copied or approved.</p>
    <label className="block text-xs font-medium" htmlFor={titleId}>Idea title</label>
    <input id={titleId} name="title" required maxLength={180} defaultValue={initial.title} className="block w-full rounded-md border bg-background p-2 text-sm" />
    <label className="block text-xs font-medium">Concept and audience promise<textarea name="summary" required maxLength={20_000} rows={5} defaultValue={initial.summary} className="mt-1 block w-full rounded-md border bg-background p-2 text-sm" /></label>
    {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create linked idea"}</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export function SourceAssistant({ locationId, sourceId, sourceTitle, version, ideaId, canRelated, archived, hasEvidence, knowledgeInput, canTemplate }: { knowledgeInput: KnowledgeInput | null; canTemplate: boolean; locationId: string; sourceId: string; sourceTitle: string; version: number; ideaId: string; canRelated: boolean; archived: boolean; hasEvidence: boolean }) {
  const router = useRouter();
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [idea, setIdea] = useState<{ title: string; summary: string; ai?: boolean } | null>(null);
  const [listening, setListening] = useState(false);
  const [dictationNote, setDictationNote] = useState("");
  const [canDictate, setCanDictate] = useState(false);
  const [mode, setMode] = useState<Mode>("discuss");
  const taskMode = mode === "knowledge" || mode === "template";
  const intent: Intent = taskMode ? "discuss" : mode;
  const [provider, setProvider] = useState<StudioTextProvider>("subscription");
  const [asking, setAsking] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const requestKey = useRef<string | null>(null);
  const alive = useRef(true);
  const fieldId = useId();
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
  function draftIdea() { const spoken = text.trim() ? [...reactions, text.trim()] : reactions; if (!spoken.length) { push({ role: "assistant", text: "Tell me your reaction first, or use Propose idea to ask the assistant.", tone: "error" }); return; } takeText(); setIdea(draftIdeaFromReactions(sourceTitle, spoken)); }
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
        ? { action: "enqueueOutline", requestId: requestKey.current, sourceId, expectedVersion: version, inputId: knowledgeInput!.inputId, mode: knowledgeInput!.mode, provider, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription" }
        : { requestId: requestKey.current, sourceId, expectedVersion: version, provider, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription" };
      const response = await fetch(url, { method: "POST", headers: { "X-Studio-Tenant": tenant, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) requestKey.current = null; push({ role: "assistant", text: data.error || "The task could not start.", tone: "error" }); return; }
      requestKey.current = null;
      const id = knowledge ? data.outlineId : data.reviewId;
      push({ role: "assistant", text: knowledge ? "Knowledge extraction started on " + (provider === "subscription" ? "your Mac" : "the Location OpenAI key") + ". Review the cited takeaways when it finishes:" : "Script template extraction started. Review the beats when it finishes:", link: { href: knowledge ? `/studio/knowledge/extractions/${id}` : `/studio/content/templates/from-video/${id}`, label: knowledge ? "Open knowledge review" : "Open template review" } });
      router.refresh();
    } catch { push({ role: "assistant", text: "The outcome is unconfirmed. Press Run again to check this same request.", tone: "error" }); }
    finally { setAsking(false); }
  }
  async function ask() {
    if (taskMode) { await runTask(); return; }
    const message = text.trim();
    if (!message || asking) return;
    requestKey.current ??= crypto.randomUUID();
    setAsking(true);
    try {
      const response = await fetch("/studio/assistant/api", { method: "POST", headers: { "X-Studio-Tenant": tenant, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ requestId: requestKey.current, sourceId, expectedVersion: version, provider, intent, message, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription" }) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) requestKey.current = null; push({ role: "assistant", text: data.error || "The assistant could not start.", tone: "error" }); return; }
      requestKey.current = null; recognition.current?.stop(); setText("");
      push({ role: "you", text: message });
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
      {result.note ? <ProposedNote key={entry.id} note={result.note} disabled={saving || archived} onSave={value => saveNote(value)} /> : null}
      {result.ideaTitle && result.ideaConcept ? <Button type="button" variant="secondary" disabled={archived} onClick={() => setIdea({ title: result.ideaTitle!, summary: result.ideaConcept!, ai: true })}><Lightbulb aria-hidden="true" className="mr-2 h-4 w-4" />Review proposed idea</Button> : null}
      {result.relatedQuery && canRelated ? <Button type="button" variant="outline" onClick={() => findRelated(result.relatedQuery!)}><Search aria-hidden="true" className="mr-2 h-4 w-4" />Search “{result.relatedQuery}”</Button> : null}
      <p className="text-xs text-muted-foreground">{run!.provider === "subscription" ? "Your Mac subscription" : "Location OpenAI key (paid)"} · {run!.model.replace(/^mac_/, "")} · {run!.evidence.kind === "description" ? "from the saved description only" : `${run!.evidence.selected} of ${run!.evidence.total} saved passages read`}{run!.stale ? " · source changed since" : ""}. Nothing is saved until you choose.</p>
    </div>;
  }

  const body = (variant: string) => <>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Conversation">
      {log.length === 0 ? <p className="text-muted-foreground">Pick what to work on, then tell me your reaction. Everything is answered from this source only, and nothing is saved until you choose.</p> : null}
      {log.map(entry => entry.role === "you"
        ? <div key={entry.id} className="ml-6 space-y-1 rounded-lg bg-primary/10 p-3"><p className="whitespace-pre-wrap break-words">{entry.text}</p>{entry.saved ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Saved to My notes</p> : <button type="button" disabled={saving || archived} onClick={() => void saveNote(entry.text, entry.id)} className="inline-flex min-h-9 items-center text-xs font-medium text-primary hover:underline disabled:opacity-50">Save to My notes as written</button>}</div>
        : entry.role === "ai" ? <AiAnswer key={entry.id} entry={entry} />
        : <p key={entry.id} role={entry.tone === "error" ? "alert" : undefined} className={`mr-6 whitespace-pre-wrap break-words rounded-lg bg-muted p-3 ${entry.tone === "error" ? "text-destructive" : ""}`}>{entry.text}{entry.link ? <> <a href={entry.link.href} className="font-medium text-primary underline">{entry.link.label}</a></> : null}</p>)}
      {idea ? <IdeaDraft key={`${idea.title}:${idea.summary}`} locationId={locationId} sourceId={sourceId} ideaId={ideaId} initial={idea} onCancel={() => setIdea(null)} /> : null}
    </div>
    <div className="space-y-2 border-t p-3">
      {archived ? <p className="text-xs text-muted-foreground">This source is archived, so notes and ideas are read-only.</p> : null}
      <label htmlFor={`${fieldId}-${variant}`} className="sr-only">Your reaction</label>
      <textarea id={`${fieldId}-${variant}`} data-assistant-field value={text} maxLength={REACTION_LIMIT} rows={2} disabled={archived} placeholder={taskMode ? "Optional: nothing to type for this task." : "What stood out? What would you do differently?"} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return; event.preventDefault(); if (!event.repeat && text.trim()) { takeText(); push({ role: "assistant", text: "Added. Choose Ask, or Save as written." }); } }}
        className="block w-full resize-none rounded-md border bg-background p-2 text-sm" />
      <fieldset disabled={archived || !hasEvidence}>
        <legend className="sr-only">Assistant mode</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Assistant mode">{INTENTS.filter(item => item.value !== "template" || canTemplate).map(item => <label key={item.value} title={item.hint} className={`inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${mode === item.value ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}><input type="radio" className="sr-only" name={`mode-${variant}`} checked={mode === item.value} onChange={() => setMode(item.value)} />{item.label}</label>)}</div>
      </fieldset>
      {hasEvidence ? <StudioTextProviderChoice sourceAssist compact provider={provider} onChange={setProvider} />
        : <p className="text-xs text-muted-foreground">The assistant needs a saved transcript or description. Transcribe on your Mac first.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void ask()} disabled={asking || archived || !hasEvidence || (taskMode ? (mode === "knowledge" && !knowledgeInput) : !text.trim())} className="min-h-10">{asking ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles aria-hidden="true" className="mr-2 h-4 w-4" />}{taskMode ? (mode === "knowledge" ? "Extract knowledge" : "Extract template") : "Ask"}</Button>
        {taskMode ? null : <Button type="button" variant="outline" onClick={() => void saveAsWritten()} disabled={saving || archived || !text.trim()} className="min-h-10"><NotebookPen aria-hidden="true" className="mr-2 h-4 w-4" />Save as written</Button>}
        {canDictate ? <Button type="button" variant="outline" size="icon" onClick={toggleDictation} aria-pressed={listening} aria-label={listening ? "Stop dictation" : "Dictate"} disabled={archived} className="h-10 w-10">{listening ? <MicOff aria-hidden="true" className="h-4 w-4" /> : <Mic aria-hidden="true" className="h-4 w-4" />}</Button> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={draftIdea} disabled={archived} className="min-h-9 px-2 text-xs"><Lightbulb aria-hidden="true" className="mr-1.5 h-4 w-4" />Draft idea from my words</Button>
        {canRelated ? <Button type="button" variant="ghost" onClick={() => findRelated()} className="min-h-9 px-2 text-xs"><Search aria-hidden="true" className="mr-1.5 h-4 w-4" />Find related videos</Button> : null}
      </div>
      <p role="status" className="text-xs text-muted-foreground">{listening ? "Listening…" : dictationNote}</p>
    </div>
  </>;
  const header = <div className="min-w-0"><h2 className="font-semibold">Assistant</h2><p className="truncate text-xs text-muted-foreground">Only this source: {sourceTitle}</p></div>;
  return <>
    <button ref={opener} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="fixed bottom-4 right-4 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-lg lg:hidden"><MessageSquare aria-hidden="true" className="h-4 w-4" />Assistant</button>
    <aside id="source-assistant" aria-label="Source assistant" className="sticky top-4 hidden max-h-[calc(100dvh-2rem)] min-h-0 flex-col rounded-xl border bg-card text-sm lg:flex">
      <header className="border-b px-4 py-3">{header}</header>
      {body("side")}
    </aside>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="flex max-h-[88dvh] flex-col gap-0 rounded-t-2xl p-0 text-sm lg:hidden" ref={sheetRef} onOpenAutoFocus={event => { event.preventDefault(); sheetRef.current?.querySelector<HTMLTextAreaElement>("[data-assistant-field]")?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}>
        <div className="border-b px-4 py-3 pr-12"><SheetTitle className="text-base">Assistant</SheetTitle><SheetDescription className="truncate text-xs">Only this source: {sourceTitle}</SheetDescription></div>
        {open ? body("sheet") : null}
      </SheetContent>
    </Sheet>
  </>;
}

function ProposedNote({ note, disabled, onSave }: { note: string; disabled: boolean; onSave: (value: string) => Promise<boolean> }) {
  const [value, setValue] = useState(note);
  const [saved, setSaved] = useState(false);
  const id = useId();
  return <div className="space-y-2 rounded-md border bg-background p-2">
    <label htmlFor={id} className="text-xs font-medium">Proposed note (edit before saving)</label>
    <textarea id={id} value={value} rows={4} maxLength={REACTION_LIMIT} onChange={event => { setValue(event.target.value); setSaved(false); }} className="block w-full resize-none rounded-md border bg-background p-2 text-sm" />
    <Button type="button" disabled={disabled || saved || !value.trim()} onClick={async () => setSaved(await onSave(value))}><NotebookPen aria-hidden="true" className="mr-2 h-4 w-4" />{saved ? "Saved to My notes" : "Save to My notes"}</Button>
  </div>;
}
