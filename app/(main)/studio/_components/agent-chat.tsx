"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Search, AlertTriangle, ExternalLink, Loader2, Mic, MicOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentTurnView } from "@/lib/studio/agent";
import { agentCitationHref, citedQuote, proposalAnchor, type ProposalFocus } from "@/lib/studio/citation-navigation";
import { AGENT_MESSAGE_LIMIT, type AgentSelection } from "@/lib/studio/agent-policy";
import { IDEA_CARD_FORMAT, ideaComparisonPrompt, readIdeaCard } from "@/lib/studio/idea-cards";
import { CREATION_STAGES, stageDraft, type CreationRecord, type CreationStage } from "@/lib/studio/creation-policy";
import { formatClock, parseDurationRequest, scriptStats, targetWords } from "@/lib/studio/script-length";
import { studioTextConsent, type StudioTextProvider } from "@/lib/studio/text-provider";
import { StudioTextProviderChoice } from "./text-provider-choice";
import { useStudioTenantHeaders } from "./studio-tenant-context";
import { SectionFit, useAgentDraft } from "./agent-workspace";
import { OPEN_TAB_EVENT } from "./source-tabs";
import { useOptionalSourceWorkspace } from "./source-workspace";
import { AgentEvidenceChoice, type EvidenceMode, type EvidenceSourceFocus } from "./agent-evidence-choice";
import { RelatedYoutubeVideos } from "./related-youtube-videos";
import { useDictation } from "./use-dictation";

const API = "/studio/assistant/agent/api";
/** A preview of a saved quote that ends on a whole word; the full, unaltered quote stays available beside it. */
const quotePreview = (quote: string) => { const cut = quote.slice(0, 220), space = cut.lastIndexOf(" "); return `${(space > 150 ? cut.slice(0, space) : cut).trimEnd()}…`; };
const clock = (seconds: number) => new Date(seconds * 1000).toISOString().slice(seconds >= 3600 ? 11 : 14, 19);
export type AgentSource = { id: string; version: number; title: string; hasText: boolean };
export type AgentResume = { id: string; title: string; turns: number; updatedAt: string; href: string };

/** Route memory is per browser, account and Location; a paid route is never restored without an existing thread that already used it. */
const ROUTE_KEY = (scope: string) => `studio-agent-route:${scope}`;
const readRoute = (scope: string): StudioTextProvider | null => {
  try { const value = JSON.parse(localStorage.getItem(ROUTE_KEY(scope)) ?? "null"); return value === "location_order" || value === "subscription" ? value : null; } catch { return null; }
};

/** One conversation for a source or a blank draft. No fields to fill: say what you want, or tap a starter. */
export function AgentChat({ locationId, source, initialTurns, provider, onProvider, newDraftHref, resume, scope, focus, scriptEditor, focusProposal }: {
  locationId: string; source: AgentSource | null; initialTurns: AgentTurnView[]; provider: StudioTextProvider; onProvider: (value: StudioTextProvider) => void; newDraftHref?: string;
  resume?: AgentResume | null; scope: string;
  focusProposal?: ProposalFocus | null;
  focus?: { selection: AgentSelection; label: string } | null;
  scriptEditor?: { startApply: () => boolean; endApply: () => void; onApplied: (record: CreationRecord, stage: CreationStage) => void; clearFocus: () => void; onSent: () => void };
}) {
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const { recordId, record, setRecord, setPlan, target, setTarget, sendRef, prepareMessage } = useAgentDraft();
  const [turns, setTurns] = useState(initialTurns);
  const [text, setText] = useState("");
  const [comparison, setComparison] = useState<{ turnId: string; indices: number[] } | null>(null);
  // "Brainstorm this section" in the script editor leaves a prompt for this piece: show it for review once; nothing is sent until the owner does.
  useEffect(() => {
    if (!recordId) return;
    try { const key = `studio-agent-prefill:${recordId}`, prefill = sessionStorage.getItem(key); if (prefill) { sessionStorage.removeItem(key); setText(prefill.slice(0, AGENT_MESSAGE_LIMIT)); } } catch { /* no storage: start blank */ }
  }, [recordId]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const created = useRef(initialTurns.length > 0 || Boolean(record));
  const pendingKey = useRef<{ input: string; turnId: string } | null>(null);
  const [evidenceMode, setEvidenceMode] = useState<EvidenceMode>("automatic");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceSourceFocus | null>(null);
  const [researchPhrase, setResearchPhrase] = useState("");
  const [researchOpen, setResearchOpen] = useState(false);
  const researchHeading = useRef<HTMLHeadingElement>(null);
  const researchOrigin = useRef<HTMLButtonElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const dictation = useDictation(useCallback((heard: string) => setText(previous => `${previous}${previous && !/\s$/.test(previous) ? " " : ""}${heard}`.slice(0, AGENT_MESSAGE_LIMIT)), []));
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [routeNote, setRouteNote] = useState("");
  const running = turns.find(turn => turn.status === "running");
  // An existing thread keeps the route its last message used; a new one uses the last unpaid route chosen here, never a paid one.
  useEffect(() => {
    const kept = initialTurns.at(-1)?.provider ?? null;
    const next = kept ?? readRoute(scope);
    // The session starts on its own route, never inheriting one from a previously shown conversation.
    if ((next ?? "location_order") !== provider) onProvider(next ?? "location_order");
    if (kept === "openai") setRouteNote("Paid route kept from your last message in this draft. Change it below before sending if you prefer.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chooseRoute = (value: StudioTextProvider) => { onProvider(value); setRouteNote(""); try { if (value !== "openai") localStorage.setItem(ROUTE_KEY(scope), JSON.stringify(value)); } catch { /* optional */ } };
  const headers = { "X-Studio-Tenant": tenant, "Content-Type": "application/json" };
  const upsert = useCallback((turn: AgentTurnView) => setTurns(previous => previous.some(item => item.id === turn.id) ? previous.map(item => item.id === turn.id ? turn : item) : [...previous, turn]), []);

  const targetProposal = focusProposal ? proposalAnchor(focusProposal) : null;
  const focusedAnchor = useRef<string | null>(null);
  useEffect(() => {
    const log = endRef.current?.parentElement;
    if (targetProposal && focusedAnchor.current !== targetProposal) {
      const proposal = document.getElementById(targetProposal);
      if (proposal && log?.contains(proposal)) {
        focusedAnchor.current = targetProposal;
        proposal.focus({ preventScroll: true });
        proposal.scrollIntoView({ block: "nearest" });
        return;
      }
    }
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [turns, targetProposal]);

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
            setTarget(data.turn.target ?? null);
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

  async function send(raw: string, selection?: AgentSelection | null) {
    if (selection === undefined) selection = focus?.selection;
    const message = raw.trim();
    if (!message || sending || running) return;
    if (evidenceMode === "selected" && !evidenceIds.length) { setError("Choose at least one passage or change the source evidence mode."); return; }
    const chosen = evidenceMode === "automatic" ? null : evidenceMode === "none" ? [] : evidenceIds;
    // A retry keeps its id only when the message, route, span and evidence choice are identical.
    const input = JSON.stringify([message, provider, selection ?? null, chosen]);
    if (pendingKey.current?.input !== input) pendingKey.current = { input, turnId: crypto.randomUUID() };
    setSending(true); setError(""); dictation.stop();
    try {
      const response = await fetch(API, { method: "POST", headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ action: "send", recordId, turnId: pendingKey.current.turnId,
        version: created.current ? 1 : 0, sourceId: created.current ? null : source?.id ?? null, sourceVersion: created.current ? null : source?.version ?? null, message, ...(chosen === null ? {} : { evidenceIds: chosen }), ...(selection ? { selection } : {}), ...studioTextConsent(provider, true) }) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) pendingKey.current = null; setError(data.error || "The message could not be sent."); return; }
      created.current = true; pendingKey.current = null; setText(""); setEvidenceMode("automatic"); setEvidenceIds([]); setEvidenceFocus(null); { const asked = parseDurationRequest(message); if (asked) setTarget(asked.kind === "set" ? asked.seconds : null); } try { if (provider !== "openai") localStorage.setItem(ROUTE_KEY(scope), JSON.stringify(provider)); } catch { /* optional */ }
      if (scriptEditor) { scriptEditor.clearFocus(); scriptEditor.onSent(); }
      else { const url = new URL(window.location.href); url.searchParams.set("draft", recordId); url.searchParams.delete("new"); window.history.replaceState(null, "", url); }
      upsert({ id: data.turnId, seq: turns.length + 1, message, provider, selection: selection ?? null, target: (() => { const asked = parseDurationRequest(message); return asked?.kind === "set" ? asked.seconds : asked?.kind === "clear" ? null : target; })(), status: "running", error: null, activity: [], waiting: "queued", route: null, result: null, inputs: { reads: [], checks: [], context: [] } });
    } catch { setError("The outcome is unconfirmed. Press Send again to check this same message."); }
    finally { setSending(false); }
  }

  async function changeDraft(path: string, body: object, key: string, stage: CreationStage) {
    if (!record) { setError("Reload the draft before using a proposal."); return; }
    if (applying) return;
    if (scriptEditor && !scriptEditor.startApply()) { setError("Wait for your script edits to finish saving before applying a proposal."); return; }
    setApplying(key); setError("");
    try {
      const response = await fetch(path, { method: "POST", headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ recordId, version: record.version, ...body }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not save this change."); return; }
      setRecord(data.record);
      scriptEditor?.onApplied(data.record, stage);
    } catch { setError("Could not confirm the change. Reload the draft before trying again."); }
    finally { setApplying(null); scriptEditor?.endApply(); }
  }

  function use(turn: AgentTurnView, index: number) {
    const stage = turn.result!.proposals[index].stage;
    if (!record) return;
    void changeDraft(API, { action: "apply", turnId: turn.id, index, baseText: stageDraft(record.state, stage).text }, `${turn.id}:${index}`, stage);
  }

  // The Draft panel asks for scoped edits through this same send (same route, same visible consent).
  useEffect(() => { sendRef.current = (message, selection) => void send(message, selection); return () => { sendRef.current = null; }; });
  useEffect(() => {
    prepareMessage.current = message => {
      const next = [text.trim(), message].filter(Boolean).join("\n\n");
      if (sending || running || next.length > AGENT_MESSAGE_LIMIT) return false;
      setText(next);
      setResearchOpen(false);
      requestAnimationFrame(() => field.current?.focus());
      return true;
    };
    return () => { prepareMessage.current = null; };
  }, [text, sending, running, prepareMessage]);
  function prepareCreativeMessage(message: string) {
    if (!prepareMessage.current?.(message)) setError("Make room in your message before adding this suggestion.");
    else setError("");
  }

  const last = turns.at(-1);
  const workspace = useOptionalSourceWorkspace();
  /** One click into the existing Related videos search with the assistant's phrase; the owner stays in control of picking, saving and transcribing. */
  useEffect(() => { if (researchOpen) researchHeading.current?.focus(); }, [researchOpen, researchPhrase]);
  function openRelated(query: string, origin: HTMLButtonElement) {
    if (record) {
      researchOrigin.current = origin;
      setResearchPhrase(query);
      setResearchOpen(true);
      return;
    }
    workspace?.setCreating(false);
    const url = new URL(window.location.href); url.searchParams.delete("mode"); window.history.replaceState(null, "", url);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: "related" }));
      window.setTimeout(() => {
        document.getElementById("related")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        window.dispatchEvent(new CustomEvent("studio:related-search", { detail: { phrase: query } }));
      }, 60);
    }, 120);
  }
  function chooseResearchEvidence(id: string, title: string) {
    setResearchOpen(false);
    setEvidenceMode("selected");
    setEvidenceFocus({ id, title });
  }
  const hasWork = record ? CREATION_STAGES.some(stage => stageDraft(record.state, stage).text.trim().length > 0) : false;
  const concept = record ? stageDraft(record.state, "Concept") : null;
  const activeIdea = concept?.approved ? readIdeaCard(concept.text) : null;
  const currentProposal = activeIdea
    ? [...turns].reverse().flatMap(turn => (turn.result?.proposals ?? []).map((proposal, index) => ({ turnId: turn.id, index, proposal })))
      .find(({ proposal }) => proposal.stage === "Concept" && proposal.text === concept?.text)
    : null;
  const currentEvidence = currentProposal?.proposal.evidence.find(item => item.sourceId);
  const savedScript = record ? stageDraft(record.state, "Script") : null;
  const savedShootPlan = record ? stageDraft(record.state, "Shoot plan") : null;
  const startIdeas = `Give me three genuinely different video ideas for this context. ${IDEA_CARD_FORMAT}`;
  const moves = [
    ["Go wider", `Explore two or three distinct directions beyond the current idea. ${IDEA_CARD_FORMAT}`],
    ["Go deeper", "Develop the current direction with one stronger example, one filmable demonstration, and what the viewer gets from it."],
    ["Simplify", "Keep the strongest promise and payoff. Show the simplest way to film it and suggest what I can cut."],
  ];
  const starters = scriptEditor && hasWork ? ["Suggest three stronger openings"] : source ? ["Suggest video ideas", "Sharpen how it opens", "Start for me"] : ["Start for me"];
  const status = (turn: AgentTurnView) => <div role="status" className="mr-6 space-y-1 rounded-lg bg-muted p-3 text-muted-foreground">
    {turn.activity.map((line, index) => <p key={index} className="text-xs">{line}</p>)}
    <p className="flex items-center gap-2"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />{turn.waiting === "running" ? "Working on it…" : "Waiting for your computer or provider to pick this up…"}</p>
  </div>;

  return <>
    {record && researchPhrase ? <div hidden={!researchOpen} className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 ref={researchHeading} tabIndex={-1} className="font-semibold">Research for this draft</h2>
        <Button type="button" variant="outline" className="min-h-10"
          onClick={() => { setResearchOpen(false); requestAnimationFrame(() => researchOrigin.current?.focus()); }}>Back to writing</Button>
      </div>
      <RelatedYoutubeVideos anchorId={recordId} draftResearch={{ phrase: researchPhrase, onChooseEvidence: chooseResearchEvidence }} />
    </div> : null}
    <div hidden={researchOpen} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Conversation">
      {resume && !resumeDismissed && turns.length === 0 && !record ? <div className="mr-6 space-y-2 rounded-lg border border-primary/40 bg-background p-3" role="group" aria-label="Earlier draft from this source">
        <p><strong>You already started a draft from this source:</strong> {resume.title}. {resume.turns ? `${resume.turns} earlier ${resume.turns === 1 ? "exchange" : "exchanges"}. ` : ""}Last changed {new Date(resume.updatedAt).toLocaleDateString()}.</p>
        <div className="flex flex-wrap gap-2"><Button asChild className="min-h-10"><Link href={resume.href}>Resume that draft</Link></Button>
          <Button type="button" variant="outline" className="min-h-10" onClick={() => { setResumeDismissed(true); const url = new URL(window.location.href); url.searchParams.set("new", "1"); window.history.replaceState(null, "", url); field.current?.focus(); }}>Start new</Button></div>
        <p className="text-xs text-muted-foreground">Starting new never changes the earlier draft.</p>
      </div> : null}
      <div className="mr-6 space-y-2 rounded-lg bg-muted p-3">
        <p>{scriptEditor ? <>Ask for ideas or revisions using your saved script. Review a proposal before using it.</> : source ? <>I’m looking at <strong>{source.title}</strong>. {source.hasText ? "I can read its saved text and any approved findings, and compare ideas with your draft." : "It has no saved transcript or description, so I can only work from what you tell me."} Tell me what you want to make, or start from a suggestion. Nothing goes into your draft until you choose <strong>Use</strong>.</> : <>Tell me what you want to make, or tap Start for me. I’ll ask only what I need. Nothing goes into your draft until you choose <strong>Use</strong>.</>}</p>
        {turns.length === 0 ? <div className="flex flex-wrap gap-2">
          {starters.map(starter => <Button key={starter} type="button" variant="outline" className="h-auto min-h-9 whitespace-normal py-1.5 text-left text-xs" disabled={sending} onClick={() => starter === "Suggest video ideas" || starter === "Start for me" ? prepareCreativeMessage(startIdeas) : prepareCreativeMessage(starter)}>{starter}</Button>)}
          {!source && !scriptEditor ? <Button type="button" variant="outline" className="min-h-9 text-xs" onClick={() => field.current?.focus()}>I have my own idea</Button> : null}
        </div> : null}
      </div>
      {turns.map(turn => <div key={turn.id} className="space-y-3">
        <p className="ml-6 whitespace-pre-wrap break-words rounded-lg bg-primary/10 p-3">{turn.message}</p>
        {turn.status === "running" ? status(turn) : null}
        {turn.status === "failed" ? <div role="alert" className="mr-6 space-y-2 rounded-lg bg-muted p-3">
          <p className="flex items-start gap-2 text-destructive"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{turn.error ?? "The assistant stopped."}</p>
          <p className="text-xs text-muted-foreground">Nothing was changed. {turn.id === last?.id ? "Send it again if you still want it." : ""}</p>
          {turn.id === last?.id ? <Button type="button" variant="outline" className="min-h-9 text-xs" disabled={sending} onClick={() => void send(turn.message, turn.selection)}>Send again</Button> : null}
        </div> : null}
        {turn.result ? <div className="mr-6 space-y-3 rounded-lg bg-muted p-3">
          <p className="whitespace-pre-wrap break-words">{turn.result.reply}</p>
          {turn.result.proposals.map((proposal, index) => {
            const savedText = record ? stageDraft(record.state, proposal.stage).text : "";
            const inDraft = savedText === proposal.text && Boolean(savedText);
            const replaces = proposal.stage === "Script" && savedText.trim().length > 0 && !inDraft && !proposal.replaces;
            const sel = turn.selection;
            const patchable = Boolean(proposal.replaces && sel && savedText.slice(sel.start, sel.end) === sel.text);
            const composed = patchable && sel ? savedText.slice(0, sel.start) + /^\s*/.exec(sel.text)![0] + proposal.text + /\s*$/.exec(sel.text)![0] + savedText.slice(sel.end) : null;
            const after = composed ? scriptStats(composed) : null;
            const anchor = proposalAnchor({ turnId: turn.id, index });
            const idea = proposal.stage === "Concept" && !proposal.replaces ? readIdeaCard(proposal.text) : null;
            const compared = comparison?.turnId === turn.id ? comparison.indices : [];
            const shortlisted = concept?.shortlist.includes(proposal.text) ?? false;
            return <div key={index} id={anchor} tabIndex={-1}
              className="space-y-2 rounded-md border bg-background p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{proposal.replaces ? `Proposed edit to your ${proposal.stage}` : `Proposed ${proposal.stage}`}</p>
              {proposal.replaces ? <p className="whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-xs text-muted-foreground line-through decoration-muted-foreground/60" data-patch-before>{proposal.replaces}</p> : null}
              {idea ? <div className="space-y-2 break-words text-sm">
                <h3 className="font-semibold">{idea.Title}</h3>
                <p>{idea.Premise}</p>
                <dl className="space-y-1 text-xs">
                  <div><dt className="inline font-medium">Audience </dt><dd className="inline">{idea.Audience}</dd></div>
                  <div><dt className="inline font-medium">Spoken opening </dt><dd className="inline">“{idea["Spoken opening"]}”</dd></div>
                  <div><dt className="inline font-medium">Payoff </dt><dd className="inline">{idea.Payoff}</dd></div>
                </dl>
              </div> : <p className="whitespace-pre-wrap break-words text-sm">{proposal.text}</p>}
              <p className="text-xs text-muted-foreground">{proposal.rationale}</p>
              {proposal.length ? <div className="space-y-1.5 text-xs" data-length-check>
                <p className="text-muted-foreground">Estimated about {formatClock(proposal.length.estimatedSeconds)} spoken · {proposal.length.spokenWords} spoken words{proposal.length.cueWords ? ` (+${proposal.length.cueWords} cue words not counted)` : ""}{proposal.length.targetSeconds ? ` · requested about ${formatClock(proposal.length.targetSeconds)}` : ""}</p>
                <SectionFit text={proposal.text} target={proposal.length.targetSeconds} />
                {proposal.length.fit ? <p className={proposal.length.fit.state === "match" ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>{proposal.length.fit.beyondSupported ? "That runtime is longer than one script can hold, so this is a part; ask for the next part when you are ready."
                  : proposal.length.fit.state === "match" ? "Close to the request." : `${proposal.length.fit.percent}% ${proposal.length.fit.state} of the request${proposal.length.fit.meaningful ? " — it did not reach the length you asked for." : "."}`}</p> : null}
                {proposal.length.fit && proposal.length.fit.state !== "match" && !proposal.length.fit.beyondSupported && proposal.length.targetSeconds ? <Button type="button" variant="outline" className="min-h-9 text-xs" disabled={sending || Boolean(running)}
                  onClick={() => void send(`${proposal.length!.fit!.state === "short" ? "Expand" : "Tighten"} the script to about ${proposal.length!.targetSeconds! <= 180 ? `${proposal.length!.targetSeconds} seconds` : `${Math.round(proposal.length!.targetSeconds! / 6) / 10} minutes`}`)}>{proposal.length.fit.state === "short" ? "Expand it" : "Tighten it"} to about {formatClock(proposal.length.targetSeconds)}</Button> : null}
              </div> : null}
              {proposal.evidence.length ? <ul className="space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">{proposal.evidence.map(item => {
                const quote = citedQuote(item.id, item.quote);
                return <li key={item.id}>
                  {quote.length > 220 ? <>“{quotePreview(quote)}” <details className="mt-0.5"><summary className="cursor-pointer text-primary">Show full quote</summary><span className="mt-1 block whitespace-pre-wrap">“{quote}”</span></details></> : <>“{quote}”</>}{item.at != null ? <span className="ml-1 tabular-nums">· {clock(item.at)}</span> : null}
                  {item.sourceId ? <Link href={agentCitationHref(item.sourceId, { turnId: turn.id, index }, item.id)} target="_blank" rel="noreferrer"
                    className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline">Open cited passage (new tab)<ExternalLink aria-hidden="true" className="h-3 w-3" /></Link> : null}
                </li>;
              })}</ul> : null}
              {proposal.verify.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">{proposal.verify.map((item, i) => <li key={i}>Check before filming: {item}</li>)}</ul> : null}
              {proposal.replaces ? <p className="text-xs text-muted-foreground" data-patch-note>{patchable && after ? <>Only the selected words change; the rest stays exactly as saved. {proposal.stage === "Script" ? <>After applying, the whole script is about {formatClock(after.seconds)} spoken ({after.spokenWords} words).</> : null} <strong>{scriptEditor ? "Undo last script change" : "Undo last change"}</strong> restores it.</> : "The selected words changed since this edit was written, so it can't be applied. Select them again."}</p> : null}
              {replaces ? <p className="text-xs text-muted-foreground">This replaces your saved {proposal.stage}. {scriptEditor ? <><strong>Undo last script change</strong> restores it.</> : <><strong>Undo last change</strong> in the Draft panel restores it.</>}</p> : null}
              <div className="flex flex-wrap gap-2">
                {scriptEditor && proposal.stage !== "Script" && proposal.stage !== "Shoot plan" && !idea ? <Button asChild variant="outline" className="min-h-10"><Link href={`/studio/content/create?draft=${recordId}`}>Review in guided draft</Link></Button> : <Button type="button" className="min-h-10" disabled={inDraft || Boolean(proposal.replaces && !patchable) || Boolean(applying)} onClick={() => use(turn, index)}>{inDraft ? "In your draft" : idea ? "Use this direction" : proposal.stage === "Shoot plan" ? "Save filming checklist" : proposal.replaces ? "Replace selected text" : replaces ? `Replace saved ${proposal.stage}` : `Use as ${proposal.stage}`}</Button>}
                {idea && record ? <Button type="button" variant="outline" className="min-h-10" disabled={shortlisted || Boolean(applying)}
                  onClick={() => void changeDraft("/studio/content/create/api", { action: "shortlist", stage: "Concept", text: proposal.text }, `${anchor}-shortlist`, "Concept")}>{shortlisted ? "Shortlisted" : "Shortlist"}</Button> : null}
                {idea && turn.result!.proposals.filter(item => item.stage === "Concept" && !item.replaces && readIdeaCard(item.text)).length > 1 ?
                  <Button type="button" variant="outline" className="min-h-10" aria-pressed={compared.includes(index)}
                    aria-label={`Compare ${idea.Title}`} disabled={!compared.includes(index) && compared.length === 2}
                    onClick={() => setComparison({ turnId: turn.id, indices: compared.includes(index) ? compared.filter(item => item !== index) : [...compared, index] })}>Compare</Button> : null}
              </div>
            </div>;
          })}
          {comparison?.turnId === turn.id && comparison.indices.length === 2 ?
            <Button type="button" variant="outline" className="min-h-10" disabled={Boolean(running) || sending}
              onClick={() => prepareCreativeMessage(ideaComparisonPrompt(comparison.indices.map(index => turn.result!.proposals[index].text)))}>Compare these two ideas</Button> : null}
          {turn.result.research ? <div className="space-y-1.5 rounded-md border border-dashed p-3 text-xs" data-research-suggestion>
            <p><strong>Worth looking for:</strong> “{turn.result.research.query}” — {turn.result.research.reason}</p>
            <p className="text-muted-foreground">Save a result to this draft, then review its transcript and approve findings before choosing passages.</p>
            {record || source ? <Button type="button" variant="outline" className="min-h-9 text-xs" onClick={event => openRelated(turn.result!.research!.query, event.currentTarget)}><Search aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Search related videos for this</Button> : null}
          </div> : null}
          {turn.inputs.checks.length ? <p className="text-xs text-muted-foreground" data-length-outcome>{turn.inputs.checks.join(" · ")}</p> : null}
          {turn.result.decisions.length ? <p className="text-xs text-muted-foreground">Noted: {turn.result.decisions.map(d => `${d.key} — ${d.value}`).join("; ")}</p> : null}
          {turn.id === last?.id && turn.result.choices.length ? <div className="flex flex-wrap gap-2">{turn.result.choices.map(choice => <Button key={choice} type="button" variant="outline" className="h-auto min-h-9 whitespace-normal py-1.5 text-left text-xs" disabled={sending} onClick={() => void send(choice)}>{choice}</Button>)}</div> : null}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">What this answer used</summary>
            <div className="mt-1 space-y-1">
              <p>{turn.route ?? "Route not recorded"}</p>
              {turn.inputs.checks.length ? <div><p className="font-medium">Length checks (measured by Studio)</p><ul className="list-disc pl-5">{turn.inputs.checks.map((check, i) => <li key={i}>{check}</li>)}</ul></div> : null}
              <p className="font-medium">Reads</p>
              {turn.inputs.reads.length ? <ul className="list-disc pl-5">{turn.inputs.reads.map((read, i) => <li key={i}>{read.tool}{read.items.length ? ` — ${read.items.slice(0, 3).join("; ")}` : ""}</li>)}</ul> : <p>No saved source text was read for this answer.</p>}
              <p>Also supplied: {turn.inputs.context.join("; ")}.</p>
            </div></details>
        </div> : null}
      </div>)}
      {error ? <p role="alert" className="mr-6 rounded-lg bg-muted p-3 text-destructive">{error}</p> : null}
      <div ref={endRef} />
    </div>
    <div hidden={researchOpen} className="space-y-2 border-t p-3">
      {activeIdea || concept?.shortlist.length ? <details className="text-xs">
        <summary className="cursor-pointer break-words font-medium">{activeIdea ? `Current direction · ${activeIdea.Title}` : "Shortlisted ideas"}</summary>
        {activeIdea ? <p className="mt-1 break-words">{activeIdea.Premise} <strong>Payoff</strong> {activeIdea.Payoff}</p> : null}
        {currentProposal && currentEvidence?.sourceId ? <p className="mt-1 break-words">
          <Link href={agentCitationHref(currentEvidence.sourceId, currentProposal, currentEvidence.id)} target="_blank" rel="noreferrer"
            className="text-primary underline">Supporting passage (new tab)</Link>
        </p> : null}
        {currentProposal?.proposal.verify[0] ? <p className="mt-1 break-words text-muted-foreground">Check before filming: {currentProposal.proposal.verify[0]}</p> : null}
        {concept?.shortlist.length ? <ul className="mt-1 list-disc space-y-1 break-words pl-5">{concept.shortlist.map(text => <li key={text}>{readIdeaCard(text)?.Title ?? text}</li>)}</ul> : null}
      </details> : null}
      {scriptEditor && record && stageDraft(record.state, "Script").approved && stageDraft(record.state, "Script").previous ? <Button type="button"
        variant="outline" className="min-h-10 text-xs" disabled={Boolean(applying)}
        onClick={() => void changeDraft("/studio/content/create/api", { action: "undo", stage: "Script" }, "undo", "Script")}>Undo last script change</Button> : null}
      {savedScript?.text.trim() && !focus ? <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button type="button" variant="outline" className="min-h-10 text-xs" disabled={Boolean(running) || sending}
          onClick={() => {
            const estimate = formatClock(scriptStats(savedScript.text).seconds);
            const requested = savedScript.targetSeconds ? ` Its saved target was about ${formatClock(savedScript.targetSeconds)}.` : "";
            prepareCreativeMessage(`Is this ready to film? Review the current saved Script, using read_stage as needed. Studio estimates ${estimate} of speech.${requested} Check the complete first spoken line, whether the payoff delivers the title, runtime fit if a target exists, and any demonstration, assets or proof still needed. Explain the biggest fix and propose a short Shoot plan checklist with what I should capture and what still needs verification. If you can only review part of the script, say what you checked. Keep my script intact.`);
          }}>Is this ready to film?</Button>
        {savedShootPlan?.text.trim() ? <details className="min-w-0 basis-full">
          <summary className="cursor-pointer font-medium">Saved filming checklist</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{savedShootPlan.text}</p>
        </details> : null}
      </div> : null}
      {focus ? <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate" title={focus.selection.text}>Focus: {focus.label} · “{focus.selection.text}”</span>
        <Button type="button" variant="ghost" size="sm" onClick={scriptEditor?.clearFocus}>Clear focus</Button>
      </div> : null}
      {hasWork || turns.length ? <div className="flex flex-wrap items-center gap-1.5 text-xs" data-creative-moves role="group" aria-label="Creative moves">
        {moves.map(([label, message]) => <button key={label} type="button" disabled={Boolean(running) || sending} onClick={() => prepareCreativeMessage(message)}
          className="min-h-8 rounded-full border px-2.5 hover:bg-accent disabled:opacity-50">{label}</button>)}
      </div> : null}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-length-target>
        <span>{target ? <>Length: about <strong className="text-foreground">{formatClock(target)}</strong> (~{targetWords(target).target} spoken words)</> : "Length: not set. Say it in words, e.g. “about 90 seconds”."}</span>
        {[["60 sec", "about 60 seconds"], ["90 sec", "about 90 seconds"], ["3 min", "about 3 minutes"]].map(([label, phrase]) => <button key={label} type="button" disabled={Boolean(running)} className="min-h-8 rounded-full border px-2.5 hover:bg-accent disabled:opacity-50"
          onClick={() => { setText(previous => `${previous.trim() ? previous.trim() + " " : ""}Make it ${phrase}.`.slice(0, AGENT_MESSAGE_LIMIT)); field.current?.focus(); }}>{label}</button>)}
      </div>
      <AgentEvidenceChoice key={record?.id ?? source?.id ?? "fresh"} recordId={record?.id ?? (initialTurns.length ? recordId : null)} sourceId={source?.id ?? null}
        tenant={tenant} mode={evidenceMode} selected={evidenceIds} onMode={setEvidenceMode} onSelected={setEvidenceIds}
        focusedSource={evidenceFocus} onClearFocus={() => setEvidenceFocus(null)} disabled={sending || Boolean(running)} />
      <label htmlFor={`${fieldId}-msg`} className="sr-only">Message</label>
      <textarea ref={field} id={`${fieldId}-msg`} data-assistant-field value={text} rows={2} maxLength={AGENT_MESSAGE_LIMIT} disabled={Boolean(running)}
        placeholder={running ? "Working on your last message…" : focus ? "What should change in this block?" : scriptEditor ? "What would you like to change in this script?" : "What do you want to make? Or give feedback."}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return; event.preventDefault(); if (!event.repeat) void send(text); }}
        className="block w-full resize-none rounded-md border bg-background p-2 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="min-h-10" disabled={sending || Boolean(running) || !text.trim() || evidenceMode === "selected" && evidenceIds.length === 0} onClick={() => void send(text)}>{sending ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : <Send aria-hidden="true" className="mr-2 h-4 w-4" />}Send</Button>
        {dictation.supported ? <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={dictation.toggle} aria-pressed={dictation.listening} aria-label={dictation.listening ? "Stop dictation" : "Dictate"}>{dictation.listening ? <MicOff aria-hidden="true" className="h-4 w-4" /> : <Mic aria-hidden="true" className="h-4 w-4" />}</Button> : null}
        {newDraftHref && (turns.length || record) ? <Button asChild variant="ghost" className="min-h-9 px-2 text-xs"><Link href={newDraftHref}>Start a new draft</Link></Button> : null}
      </div>
      <StudioTextProviderChoice studioAgent compact provider={provider} onChange={chooseRoute} />
      {routeNote ? <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{routeNote}</p> : null}
      <p className="text-xs text-muted-foreground">Each message may use up to four model calls on this route. Saved source text is read only when needed.</p>
      <p role="status" className="text-xs text-muted-foreground">{dictation.listening ? "Listening…" : dictation.note}</p>
    </div>
  </>;
}
