"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
import type { StudioDeviceSummary } from "@/lib/studio/devices";

const buttonClass = "rounded-md border px-3 py-2 text-sm disabled:opacity-50";
const inputClass = "mt-1 w-full rounded-md border bg-background p-2";
const endpoint = "/studio/settings/devices/api";
const when = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Nicosia", dateStyle: "medium", timeStyle: "short" });
type Provider = "codex" | "claude";
type ProviderReport = { installed?: boolean; authenticated?: boolean; ready?: boolean; version?: string; models?: string[] };
function providerReport(device: StudioDeviceSummary, provider: Provider): ProviderReport {
  const value = device.capabilities[provider];
  return value && typeof value === "object" && !Array.isArray(value) ? value as ProviderReport : {};
}
const flag = (value: boolean | undefined) => value === undefined ? "unknown" : value ? "yes" : "no";

function CreateDevice() {
  const router = useRouter();
  const command = useStudioCommand(endpoint);
  const [name, setName] = useState("");
  const [credential, setCredential] = useState<{ deviceId: string; token: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  return <div className="space-y-3">
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault();
      const result = await command.run({ action: "create", name, requestId: crypto.randomUUID() });
      if (result?.ok && result.data.ok) {
        setCredential(result.data.data); setRevealed(false); setCopyStatus(""); setName(""); router.refresh();
      }
    }}>
      <label className="block">Mac name<input className={inputClass} value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={command.pending || command.retry || Boolean(credential)} placeholder="My Mac" autoComplete="off" /></label>
      <button className={buttonClass} disabled={command.pending || Boolean(credential)}>{command.pending ? "Creating…" : command.retry ? "Retry same create request" : "Create device"}</button>
      {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
    </form>
    {credential ? <div className="space-y-3 rounded-md border p-3">
      <p className="font-medium">Save this device token now</p>
      <p>It is shown only after creation and cannot be retrieved later. Keep it private; use it only with the companion on your Mac. Dismissing this panel or leaving the page clears it.</p>
      <p className="break-all text-muted-foreground">Device ID: {credential.deviceId}</p>
      <label className="block">Device token<input aria-label="Device token" className={`${inputClass} font-mono`} type={revealed ? "text" : "password"} value={credential.token} readOnly autoComplete="off" spellCheck={false} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={() => setRevealed(value => !value)}>{revealed ? "Hide token" : "Reveal token"}</button>
        <button type="button" className={buttonClass} onClick={async () => {
          try { await navigator.clipboard.writeText(credential.token); setCopyStatus("Token copied. Clear your clipboard after setup."); }
          catch { setCopyStatus("Could not copy. Reveal the token and copy it manually."); }
        }}>Copy token</button>
        <button type="button" className={buttonClass} onClick={() => { setCredential(null); setRevealed(false); setCopyStatus(""); }}>Dismiss token</button>
      </div>
      {copyStatus ? <p role="status">{copyStatus}</p> : null}
    </div> : null}
  </div>;
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
      <p className="text-muted-foreground">Runs a fixed, harmless check through the native CLI. It may consume subscription usage. No custom prompt is sent. Reported models: {models.length ? models.join(", ") : "none reported; model compatibility is not verified"}.</p>
    </fieldset> : null}
    <button className={buttonClass} disabled={command.pending}>{command.pending ? "Queuing…" : command.retry ? "Retry same check request" : cli ? "Check CLI connection" : "Run Mac check"}</button>
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
    {jobId ? <p role="status">Check queued. <Link className="text-primary hover:underline" href={`/studio/jobs#job-${jobId}`}>View result in Jobs</Link>. If the Mac is offline, this waits without paid API fallback.</p> : null}
  </form>;
}

function RevokeDevice({ device }: { device: StudioDeviceSummary }) {
  const router = useRouter();
  const command = useStudioCommand(endpoint);
  return <div className="space-y-2">
    <button type="button" className={`${buttonClass} text-destructive`} disabled={command.pending} onClick={async () => {
      if (!command.retry && !window.confirm(`Revoke ${device.name}? Its token will stop working. Pair it again to reconnect.`)) return;
      const result = await command.run({ action: "revoke", deviceId: device.id, requestId: crypto.randomUUID() });
      if (result?.ok) router.refresh();
    }}>{command.pending ? "Revoking…" : command.retry ? "Retry same revoke request" : "Revoke device"}</button>
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
  </div>;
}

export function CompanionSettings({ canManage, devices }: { canManage: boolean; devices: StudioDeviceSummary[] }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  return <section className="space-y-5 rounded-xl border bg-card p-5 text-sm" aria-labelledby="mac-companion-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="mac-companion-heading" className="text-lg font-medium">Mac companion</h2>
      <button type="button" className={buttonClass} disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>{refreshing ? "Refreshing…" : "Refresh status"}</button>
    </div>
    <p>Pair your Mac to run local checks without an OpenAI API key. Mac jobs wait while the companion is offline; they never automatically fall back to a paid API.</p>
    <p className="text-muted-foreground">Available in this slice: device pairing, Mac checks and native CLI connection checks. Full idea review, script routing and local transcription are not built yet. Provider and model choices below apply only to the connection check.</p>
    <div className="space-y-2">
      <h3 className="font-medium">Set up on your Mac</h3>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Create a device below and save its token.</li>
        <li>In this app&apos;s source checkout on your Mac, run the companion CLI (<code>scripts/studio-companion.ts</code>):
          <pre className="my-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">npm run start:studio-companion -- setup --origin https://substo.com --name &apos;My Mac&apos;</pre>
          Paste the device token at the hidden prompt. Setup also accepts stdin or the <code>STUDIO_DEVICE_TOKEN</code> environment variable. Never put the token in a URL, command-line argument or shell history.</li>
        <li>For CLI checks, install and sign in to Codex or unmodified Claude Code using the provider&apos;s native login on your Mac. Provider credentials stay on your Mac and are separate from the device token.</li>
        <li>Start the companion using its saved private configuration:
          <pre className="my-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">npm run start:studio-companion -- start</pre>
          Keep it running, refresh status here, then run a check. <Link className="text-primary hover:underline" href="/studio/jobs">Jobs</Link> shows progress and results.</li>
      </ol>
    </div>
    {canManage ? <CreateDevice /> : <p className="text-muted-foreground">Device management requires a Substo Business admin.</p>}
    <div className="space-y-4">{devices.map(device => {
      const online = !device.revoked_at && device.capabilities.draining !== true && Boolean(device.last_seen_at) && Date.now() - Date.parse(device.last_seen_at!) <= 60_000;
      return <article key={device.id} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{device.name}</h3><p>{device.revoked_at ? "Revoked" : online ? "Online" : "Offline"}</p></div>
        <p className="text-muted-foreground">{device.revoked_at ? `Revoked ${when(device.revoked_at)} · this token can no longer connect` : device.last_seen_at ? `Last seen ${when(device.last_seen_at)} · online means seen within 60 seconds` : "Not connected yet"}</p>
        {(["codex", "claude"] as const).map(provider => {
          const report = providerReport(device, provider);
          return <p key={provider} className="text-muted-foreground">{provider === "codex" ? "Codex" : "Claude Code"}: installed {flag(report.installed)} · authenticated {flag(report.authenticated)} · ready {flag(report.ready)}{report.version ? ` · ${report.version}` : ""}</p>;
        })}
        {canManage && !device.revoked_at ? <div className="space-y-4"><DeviceCheck device={device} /><DeviceCheck device={device} cli /><RevokeDevice device={device} /></div> : null}
      </article>;
    })}{!devices.length ? <p className="text-muted-foreground">No Mac devices paired yet.</p> : null}</div>
  </section>;
}
