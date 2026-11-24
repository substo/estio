"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
import { defaultDeviceConfig, type StudioDeviceConfig } from "@/lib/studio/devices-policy";
import type { StudioDeviceSummary } from "@/lib/studio/devices";
import { MODEL_CATALOG, modelFit, modelTaskLabel, readReportedModels, recommendedModels, type ModelTask } from "@/lib/studio/local-models";
import { buttonClass, endpoint, primaryButtonClass, record } from "./shared";

const tasks = Object.keys(modelTaskLabel) as ModelTask[];
/** Local models for one paired Mac: what it already has, what is installing, and one click to install or remove. The Mac does the download itself. */
export function LocalModels({ device, canManage }: { device: StudioDeviceSummary; canManage: boolean }) {
  const router = useRouter();
  const command = useStudioCommand(endpoint);
  const hw = record(device.capabilities.hardware);
  const hardware = { memoryGb: typeof hw.memoryGb === "number" ? hw.memoryGb : undefined, freeDiskGb: typeof hw.freeDiskGb === "number" ? hw.freeDiskGb : undefined };
  const states = new Map(readReportedModels(device.capabilities.modelStates).map(s => [s.id, s]));
  const saved = device.config.version > 0 ? device.config.value as StudioDeviceConfig : defaultDeviceConfig;
  const desired = saved.models;
  const [picked, setPicked] = useState<ModelTask[]>(tasks);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const busy = [...states.values()].some(s => s.state === "installing") || (desired ?? []).some(id => !states.get(id) || states.get(id)?.state === "absent") && device.online;
  useEffect(() => { if (!busy) return; const timer = setInterval(() => router.refresh(), 5000); return () => clearInterval(timer); }, [busy, router]);
  const save = async (models: string[]) => {
    const result = await command.run({ action: "save_config", deviceId: device.id, expectedVersion: device.config.version, config: { ...saved, models } });
    if (result?.ok) router.refresh();
  };
  const reported = states.size > 0;
  const firstRun = desired === undefined && reported && canManage;
  const recommended = recommendedModels(hardware, picked);
  return <section aria-labelledby={`local-models-${device.id}`} className="space-y-3 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 id={`local-models-${device.id}`} className="font-medium">Local models</h4>
      <p className="text-muted-foreground">{hardware.memoryGb ? `${hardware.memoryGb} GB memory` : "Memory not reported"}{hardware.freeDiskGb !== undefined ? ` · ${hardware.freeDiskGb} GB free` : ""}</p>
    </div>
    <p className="text-muted-foreground">Run tasks on this Mac instead of paying a provider. Models download from Hugging Face to this Mac only; nothing is sent to us, and a model that is already here is detected, not downloaded again.</p>
    {!reported ? <p className="text-muted-foreground">{device.online ? "Waiting for this Mac to report its models (update the companion if this stays empty)." : "Start the companion on this Mac to see and install models."}</p> : null}
    {firstRun ? <fieldset disabled={command.pending} className="space-y-2 rounded-md bg-muted/40 p-3">
      <legend className="font-medium">Which tasks should this Mac run itself?</legend>
      {tasks.map(task => <label key={task} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={picked.includes(task)}
        onChange={event => setPicked(list => event.target.checked ? [...list, task] : list.filter(t => t !== task))} />{modelTaskLabel[task]}</label>)}
      <p className="text-muted-foreground">{recommended.length ? `Recommended for this Mac: ${recommended.map(id => MODEL_CATALOG.find(m => m.id === id)?.title).join(", ")}.` : "Nothing in the catalog fits this Mac for those tasks."}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButtonClass} disabled={!recommended.length} onClick={() => save(recommended)}>Install recommended</button>
        <button type="button" className={buttonClass} onClick={() => save([])}>Not now</button>
      </div>
    </fieldset> : null}
    {reported ? <ul className="space-y-2">
      {MODEL_CATALOG.map(model => {
        const state = states.get(model.id);
        const wanted = (desired ?? []).includes(model.id);
        const fit = modelFit(model, hardware, state?.state === "installed");
        const installed = state?.state === "installed";
        return <li key={model.id} className="space-y-1 rounded-md border p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p><span className="font-medium">{model.title}</span> <span className="text-muted-foreground">· {modelTaskLabel[model.task]} · {model.sizeGb} GB · {model.licence}</span></p>
            <p role="status" className="text-muted-foreground">{installed ? (state?.source === "found" ? "Already on this Mac" : "Installed")
              : state?.state === "installing" ? `Installing ${state.progress ?? 0}%` : state?.state === "error" ? "Could not install"
              : wanted ? (device.online ? "Queued on the Mac" : "Waiting for the Mac to come online") : "Not installed"}</p>
          </div>
          <p className="text-muted-foreground">{model.summary}</p>
          {fit.level !== "ok" && !installed ? <p className={fit.level === "no" ? "text-destructive" : "text-amber-600"}>{fit.level === "no" ? "Cannot install: " : "Heads up: "}{fit.reason}</p> : null}
          {installed && fit.level === "tight" ? <p className="text-amber-600">{fit.reason}</p> : null}
          {state?.state === "error" && state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
          {model.terms && !installed && !wanted && canManage ? <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={accepted.has(model.id)} onChange={e => setAccepted(prev => { const next = new Set(prev); if (e.target.checked) next.add(model.id); else next.delete(model.id); return next; })} />
            <span>I have read and accept {model.terms.map((t, i) => <span key={t.url}>{i ? " and the " : "the "}<a className="text-primary underline" href={t.url} target="_blank" rel="noreferrer">{t.label}</a></span>)} for this model, for my own use.</span>
          </label> : null}
          {canManage ? <div className="flex flex-wrap gap-2">
            {!installed && !wanted && fit.level !== "no" ? <button type="button" className={buttonClass} disabled={command.pending || Boolean(model.terms && !accepted.has(model.id))} onClick={() => save([...(desired ?? []), model.id])}>Install</button> : null}
            {wanted && !installed ? <button type="button" className={buttonClass} disabled={command.pending} onClick={() => save((desired ?? []).filter(id => id !== model.id))}>{state?.state === "installing" ? "Cancel" : "Remove from list"}</button> : null}
            {installed && state?.source === "managed" ? <button type="button" className={`${buttonClass} text-destructive`} disabled={command.pending} onClick={() => save((desired ?? []).filter(id => id !== model.id))}>Remove from this Mac</button> : null}
          </div> : null}
        </li>;
      })}
    </ul> : null}
    {!canManage ? <p className="text-muted-foreground">Ask a Business admin to install or remove models.</p> : null}
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
  </section>;
}
