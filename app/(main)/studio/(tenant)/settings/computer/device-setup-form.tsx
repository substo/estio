"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
import { defaultDeviceConfig, isIanaTimeZone, type StudioDeviceConfig } from "@/lib/studio/devices-policy";
import type { StudioDeviceSummary } from "@/lib/studio/devices";
import { buttonClass, endpoint, inputClass, providerReport } from "./shared";

const laterReason = "Saved for later — local workflows arrive in the next slice";
const launchReason = "Needs the installed Mac app (not built yet)";
const list = (value: string) => value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
const configStatus: Record<StudioDeviceSummary["config"]["status"], string> = {
  none: "Not saved yet", pending: "Pending — waiting for the Mac to apply it", applied: "Applied on the Mac", error: "The Mac could not apply it",
};

export function DeviceSetupForm({ device, canManage }: { device: StudioDeviceSummary; canManage: boolean }) {
  const router = useRouter();
  const command = useStudioCommand(endpoint);
  const saved = device.config.version > 0 ? device.config.value as StudioDeviceConfig : defaultDeviceConfig;
  const [config, setConfig] = useState<StudioDeviceConfig>(saved);
  const [languages, setLanguages] = useState(saved.languages.join(", "));
  const [targets, setTargets] = useState(saved.translationTargets.join(", "));
  const [formError, setFormError] = useState("");
  const set = (patch: Partial<StudioDeviceConfig>) => setConfig(value => ({ ...value, ...patch }));
  const setResources = (patch: Partial<StudioDeviceConfig["resources"]>) => setConfig(value => ({ ...value, resources: { ...value.resources, ...patch } }));
  const models = config.textProvider ? providerReport(device, config.textProvider).models ?? [] : [];
  const hours = config.resources.workingHours;
  const report = device.config.report as { unsupported?: Record<string, string>; error?: string };
  const unsupported = Object.entries(report.unsupported ?? {});
  return <form className="space-y-4 rounded-md border p-3" onSubmit={async event => {
    event.preventDefault(); setFormError("");
    if (hours && !isIanaTimeZone(hours.timeZone)) { setFormError("Enter a time zone like Europe/London."); return; }
    const next = { ...config, languages: list(languages), translationTargets: list(targets) };
    if (!next.languages.length) { setFormError("Add at least one language."); return; }
    const result = await command.run({ action: "save_config", deviceId: device.id, expectedVersion: device.config.version, config: next });
    if (result?.ok) router.refresh();
  }}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-medium">Setup</h4>
      <p className="text-muted-foreground">{configStatus[device.config.status]}{device.config.version ? ` (version ${device.config.version})` : ""}</p>
    </div>
    {report.error ? <p role="alert" className="text-destructive">{report.error}</p> : null}
    {unsupported.length ? <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{unsupported.map(([key, reason]) => <li key={key}><code>{key}</code>: {reason}</li>)}</ul> : null}
    <fieldset disabled={!canManage || command.pending} className="space-y-4">
      <fieldset className="space-y-1">
        <legend className="font-medium">Features</legend>
        <label className="flex items-center gap-2"><input type="checkbox" checked={config.features.transcription} onChange={event => set({ features: { ...config.features, transcription: event.target.checked } })} />Transcription</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={config.features.text} onChange={event => set({ features: { ...config.features, text: event.target.checked } })} />Text work (summaries, reviews)</label>
        <p className="text-muted-foreground">{laterReason}.</p>
      </fieldset>
      <label className="block">Languages<input className={inputClass} value={languages} onChange={event => setLanguages(event.target.value)} placeholder="en, el" autoComplete="off" /></label>
      <label className="block">Translate into (optional)<input className={inputClass} value={targets} onChange={event => setTargets(event.target.value)} placeholder="en-GB" autoComplete="off" /></label>
      <p className="text-muted-foreground">Language codes, separated by commas (for example en, el, en-GB).</p>
      <label className="block">Prefer<select className={inputClass} value={config.preference} onChange={event => set({ preference: event.target.value as StudioDeviceConfig["preference"] })}>
        <option value="quality">Quality</option><option value="balanced">Balanced</option><option value="speed">Speed</option></select></label>
      <label className="block">Text provider<select className={inputClass} value={config.textProvider ?? ""} onChange={event => set({ textProvider: (event.target.value || null) as StudioDeviceConfig["textProvider"], textModel: null })}>
        <option value="">None</option><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
      <label className="block">Text model<select className={inputClass} value={config.textModel ?? ""} disabled={!config.textProvider} onChange={event => set({ textModel: event.target.value || null })}>
        <option value="">CLI default</option>{models.map(id => <option key={id} value={id}>{id}</option>)}
        {config.textModel && !models.includes(config.textModel) ? <option value={config.textModel}>{config.textModel}</option> : null}</select></label>
      <fieldset className="space-y-2">
        <legend className="font-medium">Resources</legend>
        <label className="block">Model storage budget (GB)<input className={inputClass} type="number" min={1} max={500} step={1} value={config.resources.modelBudgetGb} onChange={event => setResources({ modelBudgetGb: Number(event.target.value) })} required /></label>
        <label className="block">Keep at least this much disk free (GB)<input className={inputClass} type="number" min={5} max={500} step={1} value={config.resources.minFreeDiskGb} onChange={event => setResources({ minFreeDiskGb: Number(event.target.value) })} required /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={config.resources.allowOnBattery} onChange={event => setResources({ allowOnBattery: event.target.checked })} />Allow work on battery</label>
        <p className="text-muted-foreground">One job at a time.</p>
        <label className="flex items-center gap-2 text-muted-foreground"><input type="checkbox" checked={config.resources.launchAtLogin} disabled />Start at login — {launchReason}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(hours)} onChange={event => setResources({
          workingHours: event.target.checked ? { start: "09:00", end: "18:00", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null })} />Only during working hours</label>
        {hours ? <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">From<input className={inputClass} type="time" value={hours.start} onChange={event => setResources({ workingHours: { ...hours, start: event.target.value } })} required /></label>
          <label className="block">To<input className={inputClass} type="time" value={hours.end} onChange={event => setResources({ workingHours: { ...hours, end: event.target.value } })} required /></label>
          <label className="block">Time zone<input className={inputClass} value={hours.timeZone} onChange={event => setResources({ workingHours: { ...hours, timeZone: event.target.value.trim() } })} required /></label>
        </div> : null}
      </fieldset>
    </fieldset>
    {canManage ? <button className={buttonClass} disabled={command.pending}>{command.pending ? "Saving…" : command.retry ? "Retry save" : "Save setup"}</button> : <p className="text-muted-foreground">Ask a Business admin to change this setup.</p>}
    {formError ? <p role="alert" className="text-destructive">{formError}</p> : null}
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
  </form>;
}
