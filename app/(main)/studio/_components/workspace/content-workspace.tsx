"use client";
import Link from "next/link";
import { startTransition, useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { stageDraft, type CreationRecord } from "@/lib/studio/creation-policy";
import type { AgentSelection } from "@/lib/studio/agent-policy";
import { ScriptWritingAgent, type WritingAgentData } from "./script-writing-agent";
import { askVideoEditAction, openEditorAction, stopVideoAction } from "../../(tenant)/content/actions";
import { ContentRecordForm } from "../content-record-form";
import { AutoRefresh } from "../auto-refresh";
import { openEditorLine, type VideoAssemblyView, type NarrationView, type VideoLoopState } from "@/lib/studio/video-assembly-policy";
import type { VoiceRow } from "@/lib/studio/voices/policy";
import type { Availability } from "@/lib/studio/voices/library";
import { groupAssets, type AssetUpload, type PendingUpload } from "@/lib/studio/workspace/assets";
import { clipStarter, type ClipAction, type SelectedClip } from "@/lib/studio/workspace/clip-actions";
import { describeMac, type MacStatusInput } from "@/lib/studio/workspace/mac-status";
import { defaultMode, modeLabels, parseMode, workspaceModes, type WorkspaceMode } from "@/lib/studio/workspace/modes";
import { jobStepper } from "@/lib/studio/workspace/stepper";
import { AgentDock } from "./agent-dock";
import { AssetsRail } from "./assets-rail";
import { MacChip } from "./mac-chip";
import { MakeVideoDialog } from "./make-video-dialog";
import { PlayerStage } from "./player-stage";
import { TimelineView } from "./timeline-view";
import { TranscriptPanel } from "./transcript-panel";
import { buildTranscript } from "@/lib/studio/workspace/transcript";

type Form = { error?: string; notice?: string };
type FormProps = Omit<React.ComponentProps<typeof ContentRecordForm>, "visible">;

/** The content page as a mode-based workspace (Script | Edit | Details). Every field of the piece stays mounted, so switching modes never loses an unsaved edit. */
export function ContentWorkspace(props: {
  locationId: string; recordId: string; title: string; archived: boolean; hasScript: boolean; initialMode: string | null;
  form: FormProps; uploads: AssetUpload[]; pending: PendingUpload[];
  loop: VideoLoopState | null; assembly: VideoAssemblyView | null; narration: NarrationView | null; mac: MacStatusInput; /** Every voice in the Location; the picker groups them by availability. */ voices: VoiceRow[]; availability?: Availability; /** Where music and sound effects will be made, from the Location's generation sources (labels only). */ soundSources?: { music: string; effects: string }; /** The Location's saved look for titles and callouts. */ motion?: import("@/lib/studio/video-assembly/motion-style").MotionChoice;
  /** The script's spoken beats in order, for the transcript. */ beats?: string[];
  uploadSlot: React.ReactNode; nextSteps: React.ReactNode; detailsExtra: React.ReactNode; writingAgent?: WritingAgentData | null;
}) {
  const { locationId, recordId, loop, writingAgent } = props;
  const router = useRouter();
  const [writingOpen, setWritingOpen] = useState(false);
  const [writingFocus, setWritingFocus] = useState<{ selection: AgentSelection; label: string } | null>(null);
  const writingOrigin = useRef<HTMLElement | null>(null);
  const editorSaved = useRef(true);
  const applyingScript = useRef(false);
  const [scriptLock, setScriptLock] = useState(false);
  const [scriptRevision, setScriptRevision] = useState<{ version: number; text: string } | null>(null);
  const showWritingAgent = (origin: HTMLElement, focus?: NonNullable<typeof writingFocus>) => {
    writingOrigin.current = origin;
    if (focus) setWritingFocus(focus);
    setWritingOpen(true);
  };
  const startApply = () => {
    if (!editorSaved.current || applyingScript.current) return false;
    applyingScript.current = true;
    setScriptLock(true);
    return true;
  };
  const endApply = () => { applyingScript.current = false; setScriptLock(false); };
  const syncProposal = (record: CreationRecord, stage: string) => {
    if (stage === "Script") setScriptRevision({ version: record.version, text: stageDraft(record.state, "Script").text });
    router.refresh();
  };
  const refreshSavedScript = useCallback(() => { router.refresh(); }, [router]);
  const trackScriptSave = useCallback((saved: boolean) => { editorSaved.current = saved; }, []);
  const versions = loop?.versions ?? [];
  const hasVideo = versions.length > 0;
  const [mode, setMode] = useState<WorkspaceMode>(() => parseMode(props.initialMode) ?? defaultMode({ hasScript: props.hasScript, hasVideo }));
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [selected, setSelected] = useState<SelectedClip | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [askState, ask, asking] = useActionState(askVideoEditAction.bind(null, locationId, recordId), {} as Form);
  const [stopState, stop, stopping] = useActionState(stopVideoAction.bind(null, locationId, recordId), {} as Form);
  const [draft, setDraft] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [openState, open, opening] = useActionState(openEditorAction.bind(null, locationId, recordId), {} as Form);
  const latestId = versions[0]?.id;
  useEffect(() => { if (latestId) setVersionId(latestId); }, [latestId]);   // a new export shows itself
  useEffect(() => { // remembered per piece; the URL stays shareable and nothing reloads
    if (!parseMode(props.initialMode)) { const saved = parseMode(window.localStorage.getItem(`studio-mode:${recordId}`)); if (saved) setMode(saved); }
  }, [props.initialMode, recordId]);
  const choose = (next: WorkspaceMode) => {
    if (next !== "script") setWritingOpen(false);
    setMode(next); window.localStorage.setItem(`studio-mode:${recordId}`, next);
    const url = new URL(window.location.href); url.searchParams.set("mode", next); window.history.replaceState(null, "", url);
  };
  const send = (text: string) => { const form = new FormData(); form.set("instruction", text); startTransition(() => ask(form)); setSelected(null); };
  const onStop = () => startTransition(() => stop());
  // Choosing an action sends nothing. It focuses the clip and starts a message in the agent's box for the user to finish (how long, how, what instead) and send.
  const onClipAction = (action: ClipAction, clip: SelectedClip) => { setSelected(clip); setDraft(clipStarter(action)); setAgentOpen(true); };

  const current = versions.find(v => v.id === versionId) ?? versions[0];
  const voiceClips = current?.timeline?.tracks.find(t => t.n === "Voice")?.c ?? [];
  const transcript = useMemo(() => (props.beats?.length ? buildTranscript(props.beats, voiceClips.map(c => ({ s: c.s, e: c.e }))) : null), [props.beats, current?.timeline]);
  // From the transcript: open the script editor on that spoken line (editing and "regenerate audio" already work there).
  const editLine = (index: number) => { choose("script"); window.setTimeout(() => { const box = document.querySelector<HTMLElement>(`[data-narration="${index}"] textarea`); box?.scrollIntoView({ block: "center", behavior: "smooth" }); box?.focus(); }, 80); };
  // From the transcript: start a note to the agent about this moment. Nothing is sent until the user finishes it and presses Send.
  const commentOn = (line: { start: number; end: number; words: { text: string }[] }) => {
    const at = `${Math.floor(line.start / 60)}:${String(Math.floor(line.start % 60)).padStart(2, "0")}`;
    const said = line.words.map(w => w.text).join(" ").slice(0, 120);
    setSelected(null); setDraft(`At ${at}, where it says "${said}": `); setAgentOpen(true);
  };
  const groups = useMemo(() => groupAssets(props.uploads, props.pending), [props.uploads, props.pending]);
  const steps = jobStepper({ narration: props.narration, assembly: props.assembly });
  const busy = Boolean(loop?.busy) || steps?.some(s => s.state === "active") === true;
  const mac = describeMac(props.mac);
  const editorPending = loop?.openEditor?.status === "queued" || loop?.openEditor?.status === "running";
  const makeBlock = props.archived ? "This piece is archived." : !props.hasScript ? "Save a script first (Script mode)." : null;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
      <AutoRefresh active={busy || editorPending || props.narration?.status === "running"} />
      <header className="space-y-3">
        <nav className="flex gap-4 text-xs"><Link href="/studio/content" className="text-muted-foreground hover:underline">Content pipeline</Link><Link href="/studio/library" className="text-muted-foreground hover:underline">Research library</Link></nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 break-words text-xl font-semibold">{props.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <MacChip status={mac} />
            {loop?.projectKept ? <form action={open}><button type="submit" disabled={opening || editorPending} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">{editorPending ? "Opening…" : "Open in editor"}</button></form> : null}
            <MakeVideoDialog locationId={locationId} recordId={recordId} voices={props.voices} availability={props.availability} soundSources={props.soundSources} motion={props.motion} disabledReason={makeBlock} busy={busy} />
          </div>
        </div>
        <div role="tablist" aria-label="Workspace mode" className="inline-flex rounded-lg border p-1">
          {workspaceModes.map(m => <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => choose(m)}
            onKeyDown={e => { const i = workspaceModes.indexOf(mode); if (e.key === "ArrowRight") choose(workspaceModes[(i + 1) % 3]); if (e.key === "ArrowLeft") choose(workspaceModes[(i + 2) % 3]); }}
            className="min-h-11 rounded-md px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 aria-selected:bg-primary aria-selected:text-primary-foreground">{modeLabels[m]}</button>)}
        </div>
        {mode === "script" && writingAgent ? <button id={`studio-script-agent-trigger-${recordId}`} type="button" aria-haspopup="dialog" onClick={event => showWritingAgent(event.currentTarget)}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"><MessageSquare aria-hidden className="size-4" />Ask about this script</button> : null}
        {openEditorLine(loop?.openEditor ?? null) ? <p role="status" className="text-sm text-muted-foreground">{openEditorLine(loop?.openEditor ?? null)}</p> : null}
        {openState.error ? <p role="alert" className="text-sm text-destructive">{openState.error}</p> : null}
      </header>

      {/* One form instance, never unmounted: Script and Details show their own parts of it. */}
      <div className={mode === "details" ? "mx-auto max-w-3xl space-y-6" : mode === "script" ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" : "hidden"}>
        <div className="space-y-6"><ContentRecordForm {...props.form} scriptLock={scriptLock} scriptRevision={scriptRevision} onScriptSaved={writingAgent ? refreshSavedScript : undefined} onScriptSaveState={trackScriptSave}
          onAskAboutBlock={writingAgent ? (selection, label, origin) => showWritingAgent(origin, { selection, label }) : undefined} visible={mode === "script" ? "script" : mode === "details" ? "details" : "none"} />{mode === "details" ? props.detailsExtra : null}</div>
        <div hidden={mode !== "script"} className="min-w-0 space-y-4">
          {writingAgent ? <ScriptWritingAgent locationId={locationId} data={writingAgent} active={mode === "script"} open={writingOpen} onOpenChange={setWritingOpen}
            focus={writingFocus} returnFocus={writingOrigin} startApply={startApply} endApply={endApply} onApplied={syncProposal} onSent={refreshSavedScript} clearFocus={() => setWritingFocus(null)} /> : null}
          {mode === "script" ? <>{props.nextSteps}<p className="text-xs text-muted-foreground">When the script is ready, switch to Edit and press Make video. Narration that already has up-to-date audio is reused, so only changed blocks are voiced again.</p></> : null}
        </div>
      </div>

      {mode === "edit" ? (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
          <div className="order-2 lg:order-1"><AssetsRail groups={groups} uploadSlot={props.uploadSlot} /></div>
          <div className="order-1 min-w-0 space-y-4 lg:order-2">
            <PlayerStage versions={versions} versionId={versionId} onVersion={setVersionId} steps={steps} onStop={busy ? onStop : undefined} stopping={stopping} videoRef={videoRef}
              empty={<><p className="font-medium">No video yet</p><p className="text-muted-foreground">Add your footage on the left, then press Make video. Your Mac does the editing.</p>
                <MakeVideoDialog locationId={locationId} recordId={recordId} voices={props.voices} availability={props.availability} soundSources={props.soundSources} motion={props.motion} disabledReason={makeBlock} busy={busy} trigger="inline" /></>} />
            {hasVideo ? <TimelineView snapshot={current?.timeline ?? null} selected={selected} onSelect={setSelected} onAction={onClipAction} canEdit={Boolean(loop?.projectKept)} busy={busy || asking} /> : null}
            {transcript ? <TranscriptPanel lines={transcript} videoRef={videoRef} onEditLine={editLine} onComment={commentOn} /> : null}
          </div>
          <aside aria-label="Agent" className={`order-3 ${agentOpen ? "fixed inset-x-0 bottom-0 z-40 flex max-h-[75vh] rounded-t-2xl border bg-background p-4 shadow-lg" : "hidden"} lg:static lg:flex lg:max-h-none lg:rounded-xl lg:border lg:bg-card lg:p-4 lg:shadow-none`}>
            <div className="flex w-full min-h-0 flex-col">
              <button type="button" onClick={() => setAgentOpen(false)} className="mb-2 self-end text-xs text-muted-foreground underline lg:hidden">Close</button>
              <AgentDock thread={loop?.thread ?? []} projectKept={Boolean(loop?.projectKept)} busy={busy} selected={selected} onClearSelection={() => setSelected(null)} onSend={send} pending={asking} error={askState.error ?? stopState.error} notice={stopState.notice ?? askState.notice} draft={draft} onDraft={setDraft} onStop={onStop} stopping={stopping} />
            </div>
          </aside>
          <button type="button" onClick={() => setAgentOpen(true)} className="fixed bottom-4 right-4 z-30 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg lg:hidden"><MessageSquare aria-hidden className="h-4 w-4" />Agent</button>
        </div>
      ) : null}
    </div>
  );
}
