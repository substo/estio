"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DeviceStatus } from "./device-status";
import type { StudioDeviceCommandSummary, StudioDeviceSummary } from "@/lib/studio/devices";
import { DeviceSetupForm } from "./device-setup-form";
import { buttonClass, endpoint, inputClass, primaryButtonClass, providerReport, record, type Provider } from "./shared";
import { computerTasks, type ComputerTask } from "@/lib/studio/computer-readiness-policy";
import { videoSetupCommand, videoSetupGuide, videoToolLabels, VIDEO_TOOL_NAMES, type VideoToolName } from "@/lib/studio/video-transcription-policy";
import { companionRefreshDelay, DEVICE_WORK_KINDS, deviceWorkLabels, type DeviceWorkKind } from "@/lib/studio/devices-policy";

const when = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Nicosia", dateStyle: "medium", timeStyle: "short" });
const providerName = (provider: Provider) => provider === "codex" ? "Codex" : "Claude";
/** "3 minutes ago", "9 days ago": how stale the last heartbeat is, next to the exact time. */
export function sinceText(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}
export const companionRunCommand = "bash scripts/studio-companion-launchagent.sh install";
const finalStatuses = ["succeeded", "failed", "cancelled"];
export const isCommandActive = (command: StudioDeviceCommandSummary) => !finalStatuses.includes(command.status);
const commandLabel: Record<StudioDeviceCommandSummary["status"], string> = {
  pending: "Waiting for the Mac to pick this up…", running: "Running on the Mac…", waiting_for_user: "Finish signing in using the link below.",
  succeeded: "Done.", failed: "Failed.", cancelled: "Cancelled.",
};

/** Refresh server data while the page is visible, per `companionRefreshDelay`; the window restarts when the tab is shown again. */
function useAutoRefresh(fast: boolean) {
  const router = useRouter();
  useEffect(() => {
    let since = Date.now();
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      const delay = companionRefreshDelay(fast, Date.now() - since);
      if (delay !== null) timer = window.setTimeout(() => { if (document.visibilityState === "visible") router.refresh(); schedule(); }, delay);
    };
    const onVisibility = () => { if (document.visibilityState !== "visible") return; since = Date.now(); router.refresh(); schedule(); };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [fast, router]);
}

function ActionButton({ label, pendingLabel, command, className = buttonClass, confirm, destructive = false }: {
  label: string; pendingLabel: string; command: Record<string, unknown>; className?: string;
  confirm?: string; destructive?: boolean;
}) {
  const router = useRouter();
  const run = useStudioCommand(endpoint);
  const [open, setOpen] = useState(false);
  const error = run.error ? <span role="alert" className="text-sm text-destructive">{run.error}</span> : null;
  const actionLabel = run.pending ? pendingLabel : run.retry ? `Retry: ${label}` : label;
  async function execute() {
    const result = await run.run(command);
    if (result?.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  if (!confirm) return <span className="inline-flex flex-col gap-1">
    <button type="button" className={className} disabled={run.pending} onClick={execute}>{actionLabel}</button>
    {error}
  </span>;

  return <AlertDialog open={open} onOpenChange={next => { if (!run.pending) setOpen(next); }}>
    <AlertDialogTrigger asChild>
      <button type="button" className={className}>{label}</button>
    </AlertDialogTrigger>
    <AlertDialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto">
      <AlertDialogHeader>
        <AlertDialogTitle>{label}?</AlertDialogTitle>
        <AlertDialogDescription className="break-words">{confirm}</AlertDialogDescription>
      </AlertDialogHeader>
      {error}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={run.pending}>Cancel</AlertDialogCancel>
        <Button type="button" variant={destructive ? "destructive" : "default"} disabled={run.pending} onClick={execute}>
          {actionLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

function DeviceCheck({ device, cli = false }: { device: StudioDeviceSummary; cli?: boolean }) {
  const router = useRouter();
  const command = useStudioCommand(endpoint);
  const [provider, setProvider] = useState<Provider>("codex");
  const [model, setModel] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const models = providerReport(device, provider).models ?? [];
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault();
    const result = await command.run({ action: "diagnostic", deviceId: device.id, requestId: crypto.randomUUID(), ...(cli ? { provider, ...(model.trim() ? { model: model.trim() } : {}) } : {}) });
    if (result?.ok && result.data.ok) { setJobId(result.data.data.jobId); router.refresh(); }
  }}>
    {cli ? <fieldset disabled={command.pending || command.retry} className="space-y-3">
      <legend className="font-medium">Native CLI connection check</legend>
      <label className="block">Provider<select className={inputClass} value={provider} onChange={event => { setProvider(event.target.value as Provider); setModel(""); }}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
      <label className="block">Model ID (optional)<input className={inputClass} value={model} onChange={event => setModel(event.target.value)} maxLength={100} pattern="[A-Za-z0-9][A-Za-z0-9._:\/\-]{0,99}" list={`models-${device.id}`} placeholder="Use native CLI default" autoComplete="off" /></label>
      <datalist id={`models-${device.id}`}>{models.map(id => <option key={id} value={id} />)}</datalist>
      <p className="text-muted-foreground">Runs a fixed, harmless check through the native CLI. It may use subscription usage. No custom prompt is sent. Reported models: {models.length ? models.join(", ") : "none reported"}.</p>
    </fieldset> : null}
    <button className={buttonClass} disabled={command.pending}>{command.pending ? "Queuing…" : command.retry ? "Retry same check request" : cli ? "Check CLI connection" : "Run Mac check"}</button>
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
    {jobId ? <p role="status">Check queued. <Link className="text-primary hover:underline" href={`/studio/jobs#job-${jobId}`}>View result in Jobs</Link>. If the Mac is offline, it waits; there is no paid API fallback.</p> : null}
  </form>;
}

function Hardware({ device }: { device: StudioDeviceSummary }) {
  const hw = record(device.capabilities.hardware); const power = record(hw.power);
  const runtimes = Object.entries(record(device.capabilities.runtimes)).filter(([, v]) => typeof v === "string");
  const localModels = Array.isArray(device.capabilities.localModels) ? device.capabilities.localModels as string[] : [];
  const parts = [
    typeof hw.chip === "string" ? hw.chip : null, typeof hw.arch === "string" ? hw.arch : null,
    typeof hw.osVersion === "string" ? `macOS ${hw.osVersion}` : null,
    typeof hw.memoryGb === "number" ? `${hw.memoryGb} GB memory` : null,
    hw.gpu === "apple-metal" ? "Metal GPU" : hw.gpu === "none" ? "No GPU" : null,
    typeof hw.freeDiskGb === "number" ? `${hw.freeDiskGb} GB free${typeof hw.totalDiskGb === "number" ? ` of ${hw.totalDiskGb} GB` : ""}` : null,
    power.source === "ac" ? "On power" : power.source === "battery" ? `On battery${typeof power.batteryPercent === "number" ? ` (${power.batteryPercent}%)` : ""}` : null,
    typeof hw.timeZone === "string" ? hw.timeZone : null,
  ].filter(Boolean);
  return <div className="space-y-1 text-muted-foreground">
    <p><span className="font-medium text-foreground">Hardware:</span> {parts.length ? parts.join(" · ") : "Not reported yet"}</p>
    <p><span className="font-medium text-foreground">Runtimes:</span> {runtimes.length ? runtimes.map(([k, v]) => `${k} ${v}`).join(" · ") : "None found"}</p>
    {localModels.length ? <p><span className="font-medium text-foreground">Local models:</span> {localModels.join(", ")}</p> : null}
  </div>;
}

/** What this Mac can do right now: signed-in subscriptions, the work it is allowed, and whether research can run. */
function Capabilities({ device }: { device: StudioDeviceSummary }) {
  const ready = (provider: Provider) => { const r = providerReport(device, provider); return r.authenticated === true && r.ready === true; };
  const allowed = DEVICE_WORK_KINDS.filter(kind => device.allowed_kinds.includes(kind)).map((kind: DeviceWorkKind) => deviceWorkLabels[kind]);
  return <div className="space-y-1">
    <p><span className="font-medium">Subscriptions:</span> {(["codex", "claude"] as const).map(p => `${providerName(p)} ${ready(p) ? "ready" : "not ready"}`).join(" · ")}</p>
    <p><span className="font-medium">Allowed work:</span> {allowed.join(", ")}{device.processingEnabled ? "" : " (turn processing on to allow research and summaries)"}</p>
    <p><span className="font-medium">Business research:</span> {device.research.ready ? `Ready on ${device.research.providers.map(providerName).join(" and ")}` : `Not available: ${device.research.reason}`}</p>
    <VideoSetupGuide device={device} />
    <YoutubeSearchStatus device={device} />
  </div>;
}

/** Whether this Mac can run Related YouTube search in its own browser, and the one step that unblocks it. */
function YoutubeSearchStatus({ device }: { device: StudioDeviceSummary }) {
  const handles = Array.isArray(device.capabilities.handlers) && (device.capabilities.handlers as string[]).includes("studio.youtube_search");
  const search = (device.capabilities as { youtubeSearch?: { ready?: boolean; signedIn?: boolean } }).youtubeSearch;
  if (!handles) return <p><span className="font-medium">Related YouTube search:</span> Update the Studio companion on this Mac (git pull, then <code>bash scripts/studio-companion-launchagent.sh restart</code>). Until then Related videos use YouTube&apos;s API.</p>;
  return <div className="space-y-1">
    <p><span className="font-medium">Related YouTube search:</span> {search?.ready ? `Ready in this Mac's Chrome${search.signedIn ? " (signed in to YouTube)" : " (not signed in; optional)"}` : "Not ready: install Google Chrome on this Mac and turn processing on."}</p>
    {search?.ready && !search.signedIn ? <p className="text-muted-foreground">To use your YouTube account, run <code>npm run start:studio-companion -- youtube-login</code> once, sign in, then quit Chrome.</p> : null}
  </div>;
}

/** Guided Setup: what the Mac reported for video transcription, and the exact step for anything missing. Nothing is installed automatically. */
function VideoSetupGuide({ device }: { device: StudioDeviceSummary }) {
  const video = (device.capabilities as { video?: { ready?: boolean; missing?: string[]; tools?: Record<string, string> } }).video;
  const handles = Array.isArray(device.capabilities.handlers) && (device.capabilities.handlers as string[]).includes("studio.video_transcribe");
  if (!handles) return <p><span className="font-medium">Video transcription:</span> Update the Studio companion on this Mac to enable it.</p>;
  const missing = (video?.missing ?? []).filter((name): name is VideoToolName => (VIDEO_TOOL_NAMES as readonly string[]).includes(name));
  const optional: VideoToolName[] = missing.filter(name => name === "ffprobe" || name === "tesseract");
  const required = missing.filter(name => !optional.includes(name));
  return <div className="space-y-1">
    <p><span className="font-medium">Video transcription:</span> {video?.ready ? "Ready (local Parakeet, YouTube captions fallback)" : "Not ready"}{device.config.value.features.transcription ? "" : " · turn on Video transcription in Setup below"}</p>
    {required.length ? <div role="note" className="space-y-1 text-muted-foreground"><p>Missing on this Mac:</p>
      <ul className="list-disc pl-5">{required.map(name => <li key={name}>{videoToolLabels[name]} — <code>{videoSetupGuide[name]}</code></li>)}</ul>
      <p>Guided install of the isolated environment and model: <code>{videoSetupCommand} install</code> (check anytime with <code>{videoSetupCommand} check</code>). Then wait a minute for the Mac to report again.</p></div> : null}
    {optional.length ? <p className="text-muted-foreground">Slides need {optional.map(name => videoToolLabels[name]).join(" and ")} (<code>{videoSetupGuide[optional[0]]}</code>); without them you still get a transcript.</p> : null}
  </div>;
}

function ProviderConnection({ device, provider, canManage }: { device: StudioDeviceSummary; provider: Provider; canManage: boolean }) {
  const report = providerReport(device, provider);
  const command = device.commands.find(c => c.provider === provider) ?? null;
  const active = command ? isCommandActive(command) : false;
  const usable = canManage && !device.revoked_at && device.online;
  const state = report.installed === false ? "Not installed" : report.authenticated ? `Signed in${report.version ? ` · ${report.version}` : ""}` : report.installed ? "Installed, not signed in" : "Unknown";
  return <div className="space-y-2 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p><span className="font-medium">{providerName(provider)}:</span> {state}</p>
      {usable && report.installed !== false && !active ? report.authenticated
        ? <ActionButton label={`Disconnect ${providerName(provider)}`} pendingLabel="Sending…" command={{ action: "provider_logout", deviceId: device.id, provider, requestId: crypto.randomUUID() }} confirm={`Sign ${providerName(provider)} out on ${device.name}?`} />
        : <ActionButton label={`Connect ${providerName(provider)}`} pendingLabel="Sending…" command={{ action: "provider_login", deviceId: device.id, provider, requestId: crypto.randomUUID() }} /> : null}
    </div>
    {report.installed === false ? <p className="text-muted-foreground">Install the {providerName(provider)} CLI on this Mac first.</p> : null}
    {command && (active || command.finished_at && Date.now() - Date.parse(command.finished_at) < 10 * 60_000) ? <div role="status" className="space-y-1">
      <p>{command.kind === "provider_logout" ? "Sign out" : "Sign in"}: {commandLabel[command.status]}{command.error ? ` ${command.error}` : ""}</p>
      {active && command.display?.verificationUrl ? <p>Open <a className="break-all text-primary hover:underline" href={command.display.verificationUrl} target="_blank" rel="noopener noreferrer">{command.display.verificationUrl}</a>{command.display.userCode ? <> and enter code <code className="rounded bg-muted px-1 font-mono">{command.display.userCode}</code></> : null}.</p> : null}
      {active && canManage ? <ActionButton label="Cancel" pendingLabel="Cancelling…" command={{ action: "cancel_command", commandId: command.id }} /> : null}
    </div> : null}
  </div>;
}

/** Plain-language tasks first: what this Mac can do for you, and the one step that unblocks anything that cannot. */
function TaskChecklist({ device, canManage }: { device: StudioDeviceSummary; canManage: boolean }) {
  const tasks = computerTasks(device);
  const anchor: Record<string, string> = { "Start the companion": `#companion-${device.id}`, "Open Setup": `#setup-${device.id}`, "Connect your subscription": `#providers-${device.id}`,
    "Install transcription tools": `#diagnostics-${device.id}`, "Install Google Chrome": `#diagnostics-${device.id}`, "Update the companion": `#diagnostics-${device.id}` };
  const fix = (task: ComputerTask) => {
    if (!task.fix || !canManage && task.fix !== "Start the companion") return null;
    if (task.fix === "Resume") return <ActionButton label="Resume" pendingLabel="Saving…" className={primaryButtonClass} command={{ action: "set_paused", deviceId: device.id, paused: false }} />;
    if (task.fix === "Turn processing on") return <ActionButton label="Turn processing on" pendingLabel="Saving…" className={primaryButtonClass} command={{ action: "set_processing", deviceId: device.id, enabled: true }} confirm={`Use ${device.name} to process this Business's work?`} />;
    return anchor[task.fix] ? <a href={anchor[task.fix]} className="font-medium text-primary hover:underline">{task.fix}</a> : null;
  };
  return <section aria-label="What this computer can do" className="space-y-2">
    <h5 className="font-medium">What this Mac can do for you</h5>
    <ul className="divide-y rounded-lg border">{tasks.map(task => <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${task.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
      <span className="min-w-0 flex-1"><span className="font-medium">{task.label}</span><span className="sr-only">{task.ready ? ": ready" : ": needs attention"}</span><span className="block text-muted-foreground">{task.detail}</span></span>
      {fix(task)}
    </li>)}</ul>
  </section>;
}

function DeviceCard({ device, canManage }: { device: StudioDeviceSummary; canManage: boolean }) {
  const id = `computer-${device.id}`;
  const identity = `${device.name} · paired ${when(device.created_at)} · ${device.id.slice(-8)}`;
  return <article id={id} aria-labelledby={`${id}-name`} className="scroll-mt-4 space-y-4 rounded-lg border p-4 target:ring-2 target:ring-primary">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 id={`${id}-name`} className="break-words font-medium">{device.name}</h4>
          <DeviceStatus state={device.online ? "Online" : "Offline"} />
        </div>
        <p className="text-xs text-muted-foreground">Paired {when(device.created_at)} · ID {device.id.slice(-8)}</p>
      </div>
      {canManage ? <ActionButton label="Remove Mac" pendingLabel="Removing…" destructive className={`${buttonClass} text-destructive`}
        command={{ action: "revoke", deviceId: device.id }}
        confirm={`${identity}. Removing this pairing disconnects the Mac. To reconnect, pair it again.`} /> : null}
    </div>
    <p className="text-muted-foreground">{device.online
      ? `Companion running · last seen ${device.last_seen_at ? sinceText(device.last_seen_at) : "just now"}`
      : device.last_seen_at
        ? `No recent heartbeat · last seen ${sinceText(device.last_seen_at)} (${when(device.last_seen_at)})`
        : "Paired, but the companion has never connected"}</p>
    <p>Processing: <span className="font-medium">{device.processingEnabled ? "On" : "Off"}</span>{device.paused ? " · Paused" : device.busy ? " · Busy" : ""}</p>
    <details className="space-y-3 rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">Setup and checks</summary>
      {!device.online && device.processingEnabled ? <div id={`companion-${device.id}`} role="status" className="scroll-mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
        <p className="font-medium">Processing is on, but work waits until the Studio companion reconnects.</p>
        <p className="text-muted-foreground">If the companion is stopped, start it from this app&apos;s source checkout on the Mac: <code className="rounded bg-muted px-1">{companionRunCommand}</code>.</p>
      </div> : null}
      <TaskChecklist device={device} canManage={canManage} />
      {canManage ? <div className="flex flex-wrap gap-2">
        <ActionButton label={device.processingEnabled ? "Turn processing off" : "Turn processing on"} pendingLabel="Saving…" className={device.processingEnabled ? buttonClass : primaryButtonClass}
          command={{ action: "set_processing", deviceId: device.id, enabled: !device.processingEnabled }}
          confirm={device.processingEnabled ? undefined : `Use ${device.name} to process this Business's work?`} />
        <ActionButton label={device.paused ? "Resume" : "Pause"} pendingLabel="Saving…" command={{ action: "set_paused", deviceId: device.id, paused: !device.paused }} />
      </div> : null}
      <div id={`providers-${device.id}`} className="scroll-mt-4 space-y-2">
        <h5 className="font-medium">Codex and Claude</h5>
        <p className="text-muted-foreground">The CLI sign-in runs on this Mac and keeps credentials there.</p>
        {(["codex", "claude"] as const).map(provider => <ProviderConnection key={provider} device={device} provider={provider} canManage={canManage} />)}
      </div>
      <div id={`setup-${device.id}`} className="scroll-mt-4"><DeviceSetupForm device={device} canManage={canManage} /></div>
      <div id={`diagnostics-${device.id}`} className="scroll-mt-4 space-y-3">
        <Capabilities device={device} /><Hardware device={device} />
        {canManage ? <div className="space-y-4"><DeviceCheck device={device} /><DeviceCheck device={device} cli /></div> : null}
      </div>
    </details>
  </article>;
}

function formatCode(value: string) {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

type Pairing = { name: string; platform: string | null; expiresAt: string; status: string };
function PairingApproval({ code, businessName, canManage, computersHref }: { code: string; businessName: string; canManage: boolean; computersHref: string }) {
  const router = useRouter();
  const lookup = useStudioCommand(endpoint);
  const decide = useStudioCommand(endpoint);
  const enable = useStudioCommand(endpoint);
  const [processing, setProcessing] = useState(true);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);
  const userCode = formatCode(code);
  useEffect(() => {
    if (!canManage || userCode.length !== 9) return;
    void lookup.run({ action: "lookup_pairing", userCode }).then(result => { if (result?.ok && result.data.ok) setPairing(result.data.data); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, userCode]);
  const done = (next: "approved" | "denied") => { setOutcome(next); router.replace(computersHref); router.refresh(); };
  return <section className="space-y-3 rounded-xl border-2 border-primary/40 bg-card p-5 text-sm" aria-labelledby="pairing-heading">
    <h2 id="pairing-heading" className="text-lg font-medium">Approve this computer?</h2>
    <p>Code <code className="rounded bg-muted px-1 font-mono">{userCode}</code> · Business: <span className="font-medium">{businessName}</span></p>
    {!canManage ? <p className="text-muted-foreground">Only a Business admin can approve a computer. Ask a Business admin to open this page with the code.</p>
      : outcome === "approved" ? <>
        <p role="status">Approved. The companion on your Mac finishes setup on its own.</p>
        {enable.error ? <p role="alert" className="text-destructive">Processing could not be confirmed: {enable.error}</p> : null}
        <button type="button" className={buttonClass} onClick={() => done("approved")}>Back to computers</button>
      </>
      : outcome === "denied" ? <p role="status">Denied. The Mac was not connected.</p>
      : lookup.pending ? <p className="text-muted-foreground">Looking up code…</p>
      : lookup.error ? <p role="alert" className="text-destructive">{lookup.error}</p>
      : pairing ? pairing.status !== "pending" ? <p className="text-muted-foreground">{pairing.status === "approved" || pairing.status === "consumed" ? "This computer is already approved." : `This code is ${pairing.status}. Run pairing on the Mac again.`}</p> : <>
        <p>{pairing.name}{pairing.platform ? ` · ${pairing.platform}` : ""} · expires {when(pairing.expiresAt)}</p>
        <p className="text-muted-foreground">Approving lets this Mac connect to {businessName} only.</p>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={processing} onChange={event => setProcessing(event.target.checked)} disabled={decide.pending} />
          <span>Also turn processing on: this Mac may run Business research and Library summaries on its own Codex or Claude subscription. You can turn it off at any time.</span></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButtonClass} disabled={decide.pending || enable.pending} onClick={async () => {
            const result = await decide.run({ action: "approve_pairing", userCode, requestId: crypto.randomUUID() });
            if (!result?.ok || !result.data.ok) return;
            const deviceId = (result.data.data as { deviceId?: string } | undefined)?.deviceId;
            if (processing && deviceId) {
              const enabled = await enable.run({ action: "set_processing", deviceId, enabled: true });
              if (!enabled?.ok || !enabled.data.ok) {
                setOutcome("approved");
                return;
              }
            }
            done("approved");
          }}>{decide.pending || enable.pending ? "Saving…" : decide.retry ? "Retry approve" : "Approve"}</button>
          <button type="button" className={`${buttonClass} text-destructive`} disabled={decide.pending || decide.retry} onClick={async () => {
            const result = await decide.run({ action: "deny_pairing", userCode }); if (result?.ok) done("denied");
          }}>Deny</button>
        </div>
        {decide.error ? <p role="alert" className="text-destructive">{decide.error}</p> : null}
      </> : null}
  </section>;
}

function CodeEntry({ computersHref }: { computersHref: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  return <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); const url = new URL(computersHref, window.location.origin); url.searchParams.set("code", formatCode(code)); router.push(url.pathname + url.search); }}>
    <label className="block">Pairing code<input className={`${inputClass} font-mono uppercase`} value={code} onChange={event => setCode(formatCode(event.target.value))} placeholder="XXXX-XXXX" required minLength={9} maxLength={9} autoComplete="off" spellCheck={false} /></label>
    <button className={primaryButtonClass}>Continue</button>
  </form>;
}

export function CompanionSettings({ canManage, devices, origin, businessName, code, computersHref = "/settings/computer" }: {
  canManage: boolean; devices: StudioDeviceSummary[]; origin: string; businessName: string; code: string | null; computersHref?: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  useAutoRefresh(devices.some(device => device.commands.some(isCommandActive)));
  const onlineCount = devices.filter(device => device.online).length;
  const sortedDevices = [...devices].sort((a, b) => Number(b.online) - Number(a.online));
  return <div className="space-y-6">
    {code ? <PairingApproval code={code} businessName={businessName} canManage={canManage} computersHref={computersHref} /> : null}
    <section className="space-y-4 rounded-xl border bg-card p-5 text-sm" aria-labelledby="devices-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="devices-heading" className="text-lg font-medium">Computers</h2>
        <button type="button" className={buttonClass} disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>{refreshing ? "Refreshing…" : "Refresh status"}</button>
      </div>
      {!canManage ? <p className="text-muted-foreground">You can see status. Ask a Business admin to change settings.</p> : null}
      {sortedDevices.map((device, index) => <Fragment key={device.id}>
        {index === 0 || device.online !== sortedDevices[index - 1].online
          ? <h3 className="font-semibold">{device.online ? `Online (${onlineCount})` : `Offline (${devices.length - onlineCount})`}</h3>
          : null}
        <DeviceCard device={device} canManage={canManage} />
      </Fragment>)}
      {!devices.length ? <p className="text-muted-foreground">No computers connected yet.</p> : null}
    </section>
    <section className="space-y-3 rounded-xl border bg-card p-5 text-sm" aria-labelledby="pair-heading">
      <h2 id="pair-heading" className="text-lg font-medium">Connect a Mac</h2>
      <p>Run this Business&apos;s research, summaries and checks on your own Mac and its Codex or Claude subscription. Mac jobs use eligible subscriptions. Onboarding can continue with another connection in the Location AI order when a subscription cannot start.</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>In this app&apos;s source checkout on your Mac, run:
          <pre className="my-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">npm run start:studio-companion -- pair --origin {origin} --name &apos;My Mac&apos;</pre></li>
        <li>It opens this page with a code. Check the code matches, then approve.</li>
        <li>Keep the companion running in the background (starts at login, restarts if it stops, logs in <code>~/Library/Logs/Estio/</code>): <code>{companionRunCommand}</code></li>
      </ol>
      {canManage ? code ? null : <CodeEntry computersHref={computersHref} /> : <p className="text-muted-foreground">Ask a Business admin to approve a new computer.</p>}
    </section>
  </div>;
}
