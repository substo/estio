"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
import type { StudioDeviceCommandSummary, StudioDeviceSummary } from "@/lib/studio/devices";
import { DeviceSetupForm } from "./device-setup-form";
import { buttonClass, endpoint, inputClass, providerReport, record, type Provider } from "./shared";

const when = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Nicosia", dateStyle: "medium", timeStyle: "short" });
const providerName = (provider: Provider) => provider === "codex" ? "Codex" : "Claude";
const finalStatuses = ["succeeded", "failed", "cancelled"];
export const isCommandActive = (command: StudioDeviceCommandSummary) => !finalStatuses.includes(command.status);
const statusLabel: Record<StudioDeviceSummary["status"], string> = { online: "Online", busy: "Busy", paused: "Paused", offline: "Offline", revoked: "Revoked" };
const commandLabel: Record<StudioDeviceCommandSummary["status"], string> = {
  pending: "Waiting for the Mac to pick this up…", running: "Running on the Mac…", waiting_for_user: "Finish signing in using the link below.",
  succeeded: "Done.", failed: "Failed.", cancelled: "Cancelled.",
};

/** Refresh server data: every 3s while a sign-in command is in progress, otherwise every 15s, only while the page is visible. */
function useAutoRefresh(fast: boolean) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(tick, fast ? 3_000 : 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [fast, router]);
}

function ActionButton({ label, pendingLabel, command, className = buttonClass, confirm }: {
  label: string; pendingLabel: string; command: Record<string, unknown>; className?: string; confirm?: string;
}) {
  const router = useRouter();
  const run = useStudioCommand(endpoint);
  return <span className="inline-flex flex-col gap-1">
    <button type="button" className={className} disabled={run.pending} onClick={async () => {
      if (confirm && !run.retry && !window.confirm(confirm)) return;
      const result = await run.run(command);
      if (result?.ok) router.refresh();
    }}>{run.pending ? pendingLabel : run.retry ? `Retry: ${label}` : label}</button>
    {run.error ? <span role="alert" className="text-destructive">{run.error}</span> : null}
  </span>;
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

function ProviderConnection({ device, provider, canManage }: { device: StudioDeviceSummary; provider: Provider; canManage: boolean }) {
  const report = providerReport(device, provider);
  const command = device.commands.find(c => c.provider === provider) ?? null;
  const active = command ? isCommandActive(command) : false;
  const usable = canManage && !device.revoked_at && device.status !== "offline";
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

function DeviceCard({ device, canManage }: { device: StudioDeviceSummary; canManage: boolean }) {
  const revoked = Boolean(device.revoked_at);
  return <article className="space-y-4 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-medium">{device.name}{device.platform ? <span className="text-muted-foreground"> · {device.platform}</span> : null}</h3>
      <span className="rounded-full border px-2 py-0.5 text-xs">{statusLabel[device.status]}</span>
    </div>
    <p className="text-muted-foreground">{revoked ? `Revoked ${when(device.revoked_at!)}. Pair again to reconnect.` : device.last_seen_at ? `Last seen ${when(device.last_seen_at)}` : "Not connected yet"}</p>
    {revoked ? null : <>
      <Hardware device={device} />
      <div className="space-y-2">
        <p className="font-medium">Use this computer for processing?</p>
        <p className="text-muted-foreground">When On, this Mac may run this Business&apos;s queued local work while the companion is running. Off by default. Mac checks work either way. No local workflows are available yet, so turning this on does not run anything today.</p>
        <p>Processing: <span className="font-medium">{device.processingEnabled ? "On" : "Off"}</span>{device.paused ? " · Paused (nothing will be picked up, including checks)" : ""}</p>
        {canManage ? <div className="flex flex-wrap gap-2">
          <ActionButton label={device.processingEnabled ? "Turn processing off" : "Turn processing on"} pendingLabel="Saving…" command={{ action: "set_processing", deviceId: device.id, enabled: !device.processingEnabled }}
            confirm={device.processingEnabled ? undefined : `Use ${device.name} to process this Business's work?`} />
          <ActionButton label={device.paused ? "Resume" : "Pause"} pendingLabel="Saving…" command={{ action: "set_paused", deviceId: device.id, paused: !device.paused }} />
          <ActionButton label="Revoke" pendingLabel="Revoking…" className={`${buttonClass} text-destructive`} command={{ action: "revoke", deviceId: device.id }}
            confirm={`Revoke ${device.name}? It will stop working until you pair it again.`} />
        </div> : null}
      </div>
      <div className="space-y-2">
        <h4 className="font-medium">Codex and Claude</h4>
        <p className="text-muted-foreground">Uses the CLI sign-in already on this Mac. Connect runs the CLI&apos;s own sign-in on the Mac; your credentials stay there.</p>
        {(["codex", "claude"] as const).map(provider => <ProviderConnection key={provider} device={device} provider={provider} canManage={canManage} />)}
      </div>
      {canManage ? <div className="space-y-4"><DeviceCheck device={device} /><DeviceCheck device={device} cli /></div> : null}
      <DeviceSetupForm device={device} canManage={canManage} />
    </>}
  </article>;
}

function formatCode(value: string) {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

type Pairing = { name: string; platform: string | null; expiresAt: string; status: string };
function PairingApproval({ code, businessName, canManage }: { code: string; businessName: string; canManage: boolean }) {
  const router = useRouter();
  const lookup = useStudioCommand(endpoint);
  const decide = useStudioCommand(endpoint);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);
  const userCode = formatCode(code);
  useEffect(() => {
    if (!canManage || userCode.length !== 9) return;
    void lookup.run({ action: "lookup_pairing", userCode }).then(result => { if (result?.ok && result.data.ok) setPairing(result.data.data); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, userCode]);
  const done = (next: "approved" | "denied") => { setOutcome(next); router.replace("/studio/settings/computer"); router.refresh(); };
  return <section className="space-y-3 rounded-xl border-2 border-primary/40 bg-card p-5 text-sm" aria-labelledby="pairing-heading">
    <h2 id="pairing-heading" className="text-lg font-medium">Approve this computer?</h2>
    <p>Code <code className="rounded bg-muted px-1 font-mono">{userCode}</code> · Business: <span className="font-medium">{businessName}</span></p>
    {!canManage ? <p className="text-muted-foreground">Only a Business admin can approve a computer. Ask a Business admin to open this page with the code.</p>
      : outcome === "approved" ? <p role="status">Approved. The companion on your Mac finishes setup on its own.</p>
      : outcome === "denied" ? <p role="status">Denied. The Mac was not connected.</p>
      : lookup.pending ? <p className="text-muted-foreground">Looking up code…</p>
      : lookup.error ? <p role="alert" className="text-destructive">{lookup.error}</p>
      : pairing ? pairing.status !== "pending" ? <p className="text-muted-foreground">{pairing.status === "approved" || pairing.status === "consumed" ? "This computer is already approved." : `This code is ${pairing.status}. Run pairing on the Mac again.`}</p> : <>
        <p>{pairing.name}{pairing.platform ? ` · ${pairing.platform}` : ""} · expires {when(pairing.expiresAt)}</p>
        <p className="text-muted-foreground">Approving lets this Mac connect to {businessName} only. Processing stays Off until you turn it on.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={decide.pending} onClick={async () => {
            const result = await decide.run({ action: "approve_pairing", userCode, requestId: crypto.randomUUID() }); if (result?.ok) done("approved");
          }}>{decide.pending ? "Saving…" : decide.retry ? "Retry approve" : "Approve"}</button>
          <button type="button" className={`${buttonClass} text-destructive`} disabled={decide.pending || decide.retry} onClick={async () => {
            const result = await decide.run({ action: "deny_pairing", userCode }); if (result?.ok) done("denied");
          }}>Deny</button>
        </div>
        {decide.error ? <p role="alert" className="text-destructive">{decide.error}</p> : null}
      </> : null}
  </section>;
}

function CodeEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); router.push(`/studio/settings/computer?code=${encodeURIComponent(formatCode(code))}`); }}>
    <label className="block">Pairing code<input className={`${inputClass} font-mono uppercase`} value={code} onChange={event => setCode(formatCode(event.target.value))} placeholder="XXXX-XXXX" required minLength={9} maxLength={9} autoComplete="off" spellCheck={false} /></label>
    <button className={buttonClass}>Continue</button>
  </form>;
}

export function CompanionSettings({ canManage, devices, origin, businessName, code }: {
  canManage: boolean; devices: StudioDeviceSummary[]; origin: string; businessName: string; code: string | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  useAutoRefresh(devices.some(device => device.commands.some(isCommandActive)));
  return <div className="space-y-6">
    {code ? <PairingApproval code={code} businessName={businessName} canManage={canManage} /> : null}
    <section className="space-y-3 rounded-xl border bg-card p-5 text-sm" aria-labelledby="pair-heading">
      <h2 id="pair-heading" className="text-lg font-medium">Use this computer for processing?</h2>
      <p>Connect a Mac to run this Business&apos;s checks (and later, local transcription and text work) on your own hardware. Mac work waits while the Mac is offline; it never falls back to a paid API.</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>In this app&apos;s source checkout on your Mac, run:
          <pre className="my-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">npm run start:studio-companion -- pair --origin {origin} --name &apos;My Mac&apos;</pre></li>
        <li>It opens this page with a code. Check the code matches, then approve.</li>
        <li>Start the companion: <code>npm run start:studio-companion -- start</code></li>
      </ol>
      {canManage ? code ? null : <CodeEntry /> : <p className="text-muted-foreground">Ask a Business admin to approve a new computer.</p>}
    </section>
    <section className="space-y-4 rounded-xl border bg-card p-5 text-sm" aria-labelledby="devices-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="devices-heading" className="text-lg font-medium">Computers</h2>
        <button type="button" className={buttonClass} disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>{refreshing ? "Refreshing…" : "Refresh status"}</button>
      </div>
      {!canManage ? <p className="text-muted-foreground">You can see status. Ask a Business admin to change settings.</p> : null}
      {devices.map(device => <DeviceCard key={device.id} device={device} canManage={canManage} />)}
      {!devices.length ? <p className="text-muted-foreground">No computers connected yet.</p> : null}
    </section>
  </div>;
}
