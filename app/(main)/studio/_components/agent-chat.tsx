"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Loader2, Mic, MicOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentTurnView } from "@/lib/studio/agent";
import { AGENT_MESSAGE_LIMIT } from "@/lib/studio/agent-policy";
import { stageDraft } from "@/lib/studio/creation-policy";
import { studioTextConsent, type StudioTextProvider } from "@/lib/studio/text-provider";
import { StudioTextProviderChoice } from "./text-provider-choice";
import { useStudioTenantHeaders } from "./studio-tenant-context";
import { useAgentDraft } from "./agent-workspace";
import { useDictation } from "./use-dictation";

const API = "/studio/assistant/agent/api";
const clock = (seconds: number) => new Date(seconds * 1000).toISOString().slice(seconds >= 3600 ? 11 : 14, 19);
export type AgentSource = { id: string; version: number; title: string; hasText: boolean };

/** One conversation for a source or a blank draft. No fields to fill: say what you want, or tap a starter. */
export function AgentChat({ locationId, source, initialTurns, provider, onProvider, newDraftHref }: {
  locationId: string; source: AgentSource | null; initialTurns: AgentTurnView[]; provider: StudioTextProvider; onProvider: (value: StudioTextProvider) => void; newDraftHref?: string;
}) {
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const { recordId, record, setRecord, setPlan } = useAgentDraft();
  const [turns, setTurns] = useState(initialTurns);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const created = useRef(initialTurns.length > 0 || Boolean(record));
  const pendingKey = useRef<{ message: string; turnId: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const dictation = useDictation(useCallback((heard: string) => setText(previous => `${previous}${previous && !/\s$/.test(previous) ? " " : ""}${heard}`.slice(0, AGENT_MESSAGE_LIMIT)), []));
  const running = turns.find(turn => turn.status === "running");
  const headers = { "X-Studio-Tenant": tenant, "Content-Type": "application/json" };
  const upsert = useCallback((turn: AgentTurnView) => setTurns(previous => previous.some(item => item.id === turn.id) ? previous.map(item => item.id === turn.id ? turn : item) : [...previous, turn]), []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [turns]);

  // Resume: a running turn (also after a reload) is advanced one step at a time by the origin-checked command.
  const runningId = running?.id;
  useEffect(() => {
    if (!runningId) return;
    let stop = false, seen = -1;
    (async () => {
      while (!stop) {
        let delay = 2200;
        try {
          const response = await fetch(API, { method: "POST", headers, signal: AbortSignal.timeout(60_000), body: JSON.stringify({ action: "advance", turnId: runningId }) });
          const data = await response.json();
          if (stop) return;
          if (!response.ok) { setError(data.error || "Could not read the answer. Your message is kept."); delay = 5000; if (response.status === 404) return; }
          else {
            setError(""); upsert(data.turn);
            if (data.record) setRecord(data.record);
            if (data.turn.result?.plan) setPlan(data.turn.result.plan);
            if (data.turn.status !== "running") return;
            if (data.turn.activity.length !== seen) { seen = data.turn.activity.length; delay = 150; }
          }
        } catch { if (stop) return; setError("Connection lost. Your message is kept; retrying."); delay = 5000; }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningId]);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || sending || running) return;
    // The same text keeps the same request id, so a lost response can be retried without a second model call.
    if (pendingKey.current?.message !== message) pendingKey.current = { message, turnId: crypto.randomUUID() };
    setSending(true); setError(""); dictation.stop();
    try {
      const response = await fetch(API, { method: "POST", headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ action: "send", recordId, turnId: pendingKey.current.turnId,
        version: created.current ? 1 : 0, sourceId: created.current ? null : source?.id ?? null, sourceVersion: created.current ? null : source?.version ?? null, message, ...studioTextConsent(provider, true) }) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) pendingKey.current = null; setError(data.error || "The message could not be sent."); return; }
      created.current = true; pendingKey.current = null; setText("");
      const url = new URL(window.location.href); url.searchParams.set("draft", recordId); url.searchParams.delete("new"); window.history.replaceState(null, "", url);
      upsert({ id: data.turnId, seq: turns.length + 1, message, status: "running", error: null, activity: [], waiting: "queued", route: null, result: null, inputs: { reads: [], context: [] } });
    } catch { setError("The outcome is unconfirmed. Press Send again to check this same message."); }
    finally { setSending(false); }
  }

  async function use(turn: AgentTurnView, index: number) {
    const proposal = turn.result!.proposals[index];
    if (!record) { setError("Reload the draft before using a proposal."); return; }
    setApplying(`${turn.id}:${index}`); setError("");
    try {
      const response = await fetch(API, { method: "POST", headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ action: "apply", recordId, version: record.version, turnId: turn.id, index, baseText: stageDraft(record.state, proposal.stage).text }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not use this proposal."); return; }
      setRecord(data.record);
    } catch { setError("Could not reach Studio. Nothing changed; try again."); }
    finally { setApplying(null); }
  }

  const last = turns.at(-1);
  const starters = source ? ["Make something inspired by this video", "Sharpen how it opens", "Start for me"] : ["Start for me"];
  const status = (turn: AgentTurnView) => <div role="status" className="mr-6 space-y-1 rounded-lg bg-muted p-3 text-muted-foreground">
    {turn.activity.map((line, index) => <p key={index} className="text-xs">{line}</p>)}
    <p className="flex items-center gap-2"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />{turn.waiting === "running" ? "Working on it…" : "Waiting for your computer or provider to pick this up…"}</p>
  </div>;

  return <>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Conversation">
      <div className="mr-6 space-y-2 rounded-lg bg-muted p-3">
        <p>{source ? <>I’m looking at <strong>{source.title}</strong>. {source.hasText ? "I can read its saved text and any approved findings, and compare ideas with your draft." : "It has no saved transcript or description, so I can only work from what you tell me."} Tell me what you want to make, or start from a suggestion. Nothing goes into your draft until you choose <strong>Use</strong>.</> : <>Tell me what you want to make, or tap Start for me. I’ll ask only what I need. Nothing goes into your draft until you choose <strong>Use</strong>.</>}</p>
        {turns.length === 0 ? <div className="flex flex-wrap gap-2">
          {starters.map(starter => <Button key={starter} type="button" variant="outline" className="h-auto min-h-9 whitespace-normal py-1.5 text-left text-xs" disabled={sending} onClick={() => void send(starter)}>{starter}</Button>)}
          {!source ? <Button type="button" variant="outline" className="min-h-9 text-xs" onClick={() => field.current?.focus()}>I have my own idea</Button> : null}
        </div> : null}
      </div>
      {turns.map(turn => <div key={turn.id} className="space-y-3">
        <p className="ml-6 whitespace-pre-wrap break-words rounded-lg bg-primary/10 p-3">{turn.message}</p>
        {turn.status === "running" ? status(turn) : null}
        {turn.status === "failed" ? <div role="alert" className="mr-6 space-y-2 rounded-lg bg-muted p-3">
          <p className="flex items-start gap-2 text-destructive"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{turn.error ?? "The assistant stopped."}</p>
          <p className="text-xs text-muted-foreground">Nothing was changed. {turn.id === last?.id ? "Send it again if you still want it." : ""}</p>
          {turn.id === last?.id ? <Button type="button" variant="outline" className="min-h-9 text-xs" disabled={sending} onClick={() => void send(turn.message)}>Send again</Button> : null}
        </div> : null}
        {turn.result ? <div className="mr-6 space-y-3 rounded-lg bg-muted p-3">
          <p className="whitespace-pre-wrap break-words">{turn.result.reply}</p>
          {turn.result.proposals.map((proposal, index) => {
            const inDraft = record ? stageDraft(record.state, proposal.stage).text === proposal.text : false;
            return <div key={index} className="space-y-2 rounded-md border bg-background p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proposed {proposal.stage}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{proposal.text}</p>
              <p className="text-xs text-muted-foreground">{proposal.rationale}</p>
              {proposal.evidence.length ? <ul className="space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">{proposal.evidence.map(item => <li key={item.id}>
                “{item.quote.length > 220 ? item.quote.slice(0, 217) + "…" : item.quote}”{item.at != null ? <span className="ml-1 tabular-nums">· {clock(item.at)}</span> : null}
                {item.sourceId ? <Link href={`/studio/library/${item.sourceId}`} className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline">Source<ExternalLink aria-hidden="true" className="h-3 w-3" /></Link> : null}</li>)}</ul> : null}
              {proposal.verify.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">{proposal.verify.map((item, i) => <li key={i}>Check before filming: {item}</li>)}</ul> : null}
              <Button type="button" className="min-h-10" disabled={inDraft || applying === `${turn.id}:${index}`} onClick={() => void use(turn, index)}>{inDraft ? "In your draft" : `Use as ${proposal.stage}`}</Button>
            </div>;
          })}
          {turn.result.decisions.length ? <p className="text-xs text-muted-foreground">Noted: {turn.result.decisions.map(d => `${d.key} — ${d.value}`).join("; ")}</p> : null}
          {turn.id === last?.id && turn.result.choices.length ? <div className="flex flex-wrap gap-2">{turn.result.choices.map(choice => <Button key={choice} type="button" variant="outline" className="h-auto min-h-9 whitespace-normal py-1.5 text-left text-xs" disabled={sending} onClick={() => void send(choice)}>{choice}</Button>)}</div> : null}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">What this answer used</summary>
            <div className="mt-1 space-y-1">
              <p>{turn.route ?? "Route not recorded"}</p>
              {turn.inputs.reads.length ? <ul className="list-disc pl-5">{turn.inputs.reads.map((read, i) => <li key={i}>{read.tool}{read.items.length ? ` — ${read.items.slice(0, 3).join("; ")}` : ""}</li>)}</ul> : <p>No saved source text was read for this answer.</p>}
              <p>Also supplied: {turn.inputs.context.join("; ")}.</p>
            </div></details>
        </div> : null}
      </div>)}
      {error ? <p role="alert" className="mr-6 rounded-lg bg-muted p-3 text-destructive">{error}</p> : null}
      <div ref={endRef} />
    </div>
    <div className="space-y-2 border-t p-3">
      <label htmlFor={`${fieldId}-msg`} className="sr-only">Message</label>
      <textarea ref={field} id={`${fieldId}-msg`} data-assistant-field value={text} rows={2} maxLength={AGENT_MESSAGE_LIMIT} disabled={Boolean(running)}
        placeholder={running ? "Working on your last message…" : source ? "What do you want to make? Or give feedback." : "What do you want to make? Or give feedback."}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return; event.preventDefault(); if (!event.repeat) void send(text); }}
        className="block w-full resize-none rounded-md border bg-background p-2 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="min-h-10" disabled={sending || Boolean(running) || !text.trim()} onClick={() => void send(text)}>{sending ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : <Send aria-hidden="true" className="mr-2 h-4 w-4" />}Send</Button>
        {dictation.supported ? <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={dictation.toggle} aria-pressed={dictation.listening} aria-label={dictation.listening ? "Stop dictation" : "Dictate"}>{dictation.listening ? <MicOff aria-hidden="true" className="h-4 w-4" /> : <Mic aria-hidden="true" className="h-4 w-4" />}</Button> : null}
        {newDraftHref && turns.length ? <Button asChild variant="ghost" className="min-h-9 px-2 text-xs"><Link href={newDraftHref}>Start a new draft</Link></Button> : null}
      </div>
      <StudioTextProviderChoice studioAgent compact provider={provider} onChange={onProvider} />
      <p className="text-xs text-muted-foreground">Each message may use up to four model calls on this route. Saved source text is read only when needed.</p>
      <p role="status" className="text-xs text-muted-foreground">{dictation.listening ? "Listening…" : dictation.note}</p>
    </div>
  </>;
}
