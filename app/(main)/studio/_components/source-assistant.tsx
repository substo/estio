"use client";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Loader2, MessageSquare, Mic, MicOff, Search, Send, X, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSourceIdeaAction } from "../(tenant)/content/actions";
import { saveSourceNoteAction } from "../(tenant)/library/note-actions";
import { draftIdeaFromReactions, relatedSearchPhrase, REACTION_LIMIT } from "@/lib/studio/source-assistant-policy";

type Entry = { id: number; role: "you" | "assistant"; text: string; saved?: boolean; tone?: "error" };
type Recognition = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null };
export const RELATED_SEARCH_EVENT = "studio:related-search";

function IdeaDraft({ locationId, sourceId, ideaId, initial, onCancel }: { locationId: string; sourceId: string; ideaId: string; initial: { title: string; summary: string }; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createSourceIdeaAction.bind(null, locationId, sourceId, ideaId), {});
  const titleId = useId();
  return <form action={action} className="space-y-3 rounded-lg border bg-background p-3 text-sm">
    <p className="font-medium">Review the idea before it is created</p>
    <p className="text-xs text-muted-foreground">Assembled from your own words, not generated. This source is linked as research; nothing is copied or approved.</p>
    <label className="block text-xs font-medium" htmlFor={titleId}>Idea title</label>
    <input id={titleId} name="title" required maxLength={180} defaultValue={initial.title} className="block w-full rounded-md border bg-background p-2 text-sm" />
    <label className="block text-xs font-medium">Concept and audience promise<textarea name="summary" required maxLength={20_000} rows={5} defaultValue={initial.summary} className="mt-1 block w-full rounded-md border bg-background p-2 text-sm" /></label>
    {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create linked idea"}</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export function SourceAssistant({ locationId, sourceId, sourceTitle, ideaId, canRelated, archived }: { locationId: string; sourceId: string; sourceTitle: string; ideaId: string; canRelated: boolean; archived: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [idea, setIdea] = useState<{ title: string; summary: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [dictationNote, setDictationNote] = useState("");
  const [canDictate, setCanDictate] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const counter = useRef(0);
  const fieldId = useId();
  useEffect(() => { setCanDictate(typeof window !== "undefined" && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); }, []);
  useEffect(() => () => recognition.current?.stop(), []);
  useEffect(() => { if (!open) return; field.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === "Escape" && window.matchMedia("(max-width: 1023px)").matches) { setOpen(false); opener.current?.focus(); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [open]);
  const push = useCallback((entry: Omit<Entry, "id">) => { const id = ++counter.current; setLog(previous => [...previous, { ...entry, id }]); return id; }, []);
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
  function addReaction() { if (takeText()) push({ role: "assistant", text: "Added to this conversation. Nothing is saved until you choose Save to My notes." }); }
  async function saveNote(entryId?: number) {
    const entry = entryId ? log.find(item => item.id === entryId) : undefined;
    const value = entry ? entry.text : takeText();
    if (!value) { push({ role: "assistant", text: "Write or dictate a reaction first.", tone: "error" }); return; }
    setSaving(true);
    const result = await saveSourceNoteAction(locationId, sourceId, value).catch(() => ({ ok: false as const, error: "Could not reach Studio. Your words are still here; try again." }));
    setSaving(false);
    if (result.ok) { setLog(previous => previous.map(item => item.role === "you" && (entry ? item.id === entry.id : item.text === value && !item.saved) ? { ...item, saved: true } : item)); push({ role: "assistant", text: "Saved to My notes exactly as you wrote it." }); router.refresh(); }
    else { push({ role: "assistant", text: result.error, tone: "error" }); if (!entry) setText(value); }
  }
  function draftIdea() { const spoken = text.trim() ? [...reactions, text.trim()] : reactions; if (!spoken.length) { push({ role: "assistant", text: "Tell me your reaction first; the idea is built from your words.", tone: "error" }); return; } takeText(); setIdea(draftIdeaFromReactions(sourceTitle, spoken)); }
  function findRelated() {
    const phrase = relatedSearchPhrase(text.trim() ? [...reactions, text.trim()] : reactions, sourceTitle);
    takeText(); setOpen(false);
    document.getElementById("related")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    window.dispatchEvent(new CustomEvent(RELATED_SEARCH_EVENT, { detail: { phrase } }));
    push({ role: "assistant", text: `Searching related videos for “${phrase}”. Your Mac does the ranking; results appear under Related videos.` });
  }

  return <>
    <button ref={opener} type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="source-assistant" className="fixed bottom-4 right-4 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-lg lg:hidden"><MessageSquare aria-hidden="true" className="h-4 w-4" />Assistant</button>
    {open ? <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
    <aside id="source-assistant" aria-label="Source assistant" className={`${open ? "fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] rounded-t-2xl shadow-2xl" : "hidden"} min-h-0 flex-col border bg-card text-sm lg:sticky lg:top-4 lg:z-auto lg:flex lg:max-h-[calc(100dvh-2rem)] lg:rounded-xl lg:shadow-none`}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3"><div className="min-w-0"><h2 className="font-semibold">Assistant</h2><p className="truncate text-xs text-muted-foreground">Only this source: {sourceTitle}</p></div><button type="button" onClick={() => { setOpen(false); opener.current?.focus(); }} aria-label="Close assistant" className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted lg:hidden"><X aria-hidden="true" className="h-4 w-4" /></button></header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Conversation">
        {log.length === 0 ? <div className="space-y-2 text-muted-foreground"><p>Tell me your reaction to this video. Type it, or dictate it.</p><ul className="list-disc space-y-1 pl-5 text-xs"><li>Save it to <strong className="font-medium text-foreground">My notes</strong>, word for word.</li><li>Turn it into a linked idea you review first.</li><li>Ask for related videos to research.</li></ul></div> : null}
        {log.map(entry => entry.role === "you"
          ? <div key={entry.id} className="ml-6 space-y-1 rounded-lg bg-primary/10 p-3"><p className="whitespace-pre-wrap break-words">{entry.text}</p>{entry.saved ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Saved to My notes</p> : <button type="button" disabled={saving} onClick={() => void saveNote(entry.id)} className="inline-flex min-h-9 items-center text-xs font-medium text-primary hover:underline disabled:opacity-50">Save to My notes</button>}</div>
          : <p key={entry.id} role={entry.tone === "error" ? "alert" : undefined} className={`mr-6 whitespace-pre-wrap break-words rounded-lg bg-muted p-3 ${entry.tone === "error" ? "text-destructive" : ""}`}>{entry.text}</p>)}
        {idea ? <IdeaDraft locationId={locationId} sourceId={sourceId} ideaId={ideaId} initial={idea} onCancel={() => setIdea(null)} /> : null}
      </div>
      <div className="space-y-2 border-t p-3">
        {archived ? <p className="text-xs text-muted-foreground">This source is archived, so notes and ideas are read-only.</p> : null}
        <label htmlFor={fieldId} className="text-xs font-medium">Your reaction</label>
        <textarea id={fieldId} ref={field} value={text} maxLength={REACTION_LIMIT} rows={3} disabled={archived} placeholder="What stood out? What would you do differently?" onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return; event.preventDefault(); if (!event.repeat) addReaction(); }}
          className="block w-full resize-none rounded-md border bg-background p-2 text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void saveNote()} disabled={saving || archived} className="min-h-10">{saving ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : <NotebookPen aria-hidden="true" className="mr-2 h-4 w-4" />}Save to My notes</Button>
          <Button type="button" variant="outline" onClick={addReaction} disabled={archived || !text.trim()} className="min-h-10"><Send aria-hidden="true" className="mr-2 h-4 w-4" />Add</Button>
          {canDictate ? <Button type="button" variant="outline" onClick={toggleDictation} aria-pressed={listening} disabled={archived} className="min-h-10">{listening ? <MicOff aria-hidden="true" className="mr-2 h-4 w-4" /> : <Mic aria-hidden="true" className="mr-2 h-4 w-4" />}{listening ? "Stop" : "Dictate"}</Button> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={draftIdea} disabled={archived} className="min-h-10"><Lightbulb aria-hidden="true" className="mr-2 h-4 w-4" />Draft an idea</Button>
          {canRelated ? <Button type="button" variant="secondary" onClick={findRelated} className="min-h-10"><Search aria-hidden="true" className="mr-2 h-4 w-4" />Find related videos</Button> : null}
        </div>
        <p role="status" className="text-xs text-muted-foreground">{listening ? "Listening… speech is converted by your browser's own speech service." : dictationNote || (canDictate ? "Enter adds; Shift+Enter starts a new line." : "Dictation isn't available in this browser; typing works everywhere.")}</p>
        <p className="text-xs text-muted-foreground">No AI rewriting here yet: your words are kept exactly as written. Mac research uses your paired subscription only, never a paid fallback.</p>
      </div>
    </aside>
  </>;
}
