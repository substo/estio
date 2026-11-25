"use client";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState, useTransition } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAPABILITIES, CAPABILITY_LABELS, type Capability, type ConnectionPlatform, type ConnectionPrefs } from "@/lib/studio/ai/connections";
import { checkConnectionAction, removeConnectionKeyAction, saveConnectionKeyAction, setConnectionPrefsAction } from "../actions";

type State = { error?: string; notice?: string };
const MASK = "••••••••••••••••";

/** One platform, always laid out the same way. Connected: a masked key with a check, Check and Remove, what it is used for, which models are allowed. Not connected: only the key box. */
export function ConnectionCard({ locationId, platform, hint, prefs, canManage }: { locationId: string; platform: ConnectionPlatform; hint: string | null; prefs: ConnectionPrefs; canManage: boolean }) {
  const router = useRouter();
  const id = useId();
  const [connected, setConnected] = useState(Boolean(hint));
  const [shownHint, setShownHint] = useState(hint);
  const [purposes, setPurposes] = useState<Capability[]>(prefs.purposes ?? platform.supports);
  const [disabled, setDisabled] = useState<string[]>(prefs.disabledModels ?? []);
  const [message, setMessage] = useState<State>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useTransition();
  const [save, saveAction, saving] = useActionState(async (_prev: State, form: FormData) => {
    const r = await saveConnectionKeyAction(locationId, platform.id, {}, form);
    if (!r.error) { setConnected(true); setShownHint("····"); router.refresh(); }
    return r;
  }, {} as State);

  const persist = (nextPurposes: Capability[], nextDisabled: string[], previous: { purposes: Capability[]; disabled: string[] }) =>
    start(async () => { const r = await setConnectionPrefsAction(locationId, platform.id, nextPurposes, nextDisabled); if (r.error) { setPurposes(previous.purposes); setDisabled(previous.disabled); setMessage(r); } });
  const togglePurpose = (c: Capability) => {
    const previous = { purposes, disabled }, next = purposes.includes(c) ? purposes.filter(x => x !== c) : [...purposes, c];
    setPurposes(next); setMessage({}); persist(next, disabled, previous);
  };
  const toggleModel = (modelId: string) => {
    const previous = { purposes, disabled }, next = disabled.includes(modelId) ? disabled.filter(x => x !== modelId) : [...disabled, modelId];
    setDisabled(next); setMessage({}); persist(purposes, next, previous);
  };
  const remove = () => start(async () => {
    const r = await removeConnectionKeyAction(locationId, platform.id);
    if (r.error) setMessage(r); else { setConnected(false); setShownHint(null); setConfirming(false); setMessage({}); router.refresh(); }
  });
  const check = () => start(async () => setMessage(await checkConnectionAction(locationId, platform.id)));

  return <li id={platform.id} className="space-y-3 rounded-lg border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-medium">{platform.label}</h3><p className="text-xs text-muted-foreground">{platform.billing}</p></div>
      {connected ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 aria-hidden className="h-4 w-4" />Connected</span>
        : <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Not connected</span>}
    </div>
    {connected ? <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1"><KeyRound aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label={`${platform.label} API key (hidden)`} type="password" value={MASK} readOnly disabled className="pl-8" /></div>
        <span className="text-xs text-muted-foreground">{shownHint && shownHint !== "····" ? `ends ${shownHint}` : "key saved"}</span>
        {canManage ? <>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={check}>Check connection</Button>
          {confirming ? <><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={remove}>Remove key</Button><Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep it</Button></>
            : <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirming(true)}>Remove</Button>}
        </> : null}
      </div>
      <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">Use this platform for</p>
        <div className="flex flex-wrap gap-2">{CAPABILITIES.filter(c => platform.supports.includes(c)).map(c => { const on = purposes.includes(c);
          return <button key={c} type="button" aria-pressed={on} disabled={!canManage} onClick={() => togglePurpose(c)}
            className={`min-h-9 rounded-full border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${on ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:bg-muted"}`}>{CAPABILITY_LABELS[c]}</button>; })}</div></div>
      <details className="text-sm"><summary className="min-h-9 cursor-pointer text-xs text-muted-foreground">Allowed models ({platform.models.filter(m => purposes.includes(m.capability) && !disabled.includes(m.id)).length} of {platform.models.length})</summary>
        <ul className="mt-2 space-y-1">{CAPABILITIES.filter(c => platform.supports.includes(c)).map(c => { const list = platform.models.filter(m => m.capability === c); if (!list.length) return null;
          return <li key={c}><p className="text-xs font-medium text-muted-foreground">{CAPABILITY_LABELS[c]}{purposes.includes(c) ? "" : " (switched off above)"}</p>
            <ul>{list.map(m => <li key={m.id}><label className="flex min-h-9 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!disabled.includes(m.id)} disabled={!canManage || m.id === "text"} onChange={() => toggleModel(m.id)} />
              <span>{m.label}{m.note ? <span className="block text-xs text-muted-foreground">{m.note}</span> : null}</span></label></li>)}</ul></li>; })}</ul></details>
    </> : canManage ? <form action={saveAction} className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1"><Label htmlFor={`${id}-key`} className="text-xs">API key</Label><Input id={`${id}-key`} name="apiKey" type="password" autoComplete="off" spellCheck={false} required /></div>
      <Button type="submit" size="sm" disabled={saving}>{saving ? "Checking…" : "Save key"}</Button>
      <a href={platform.keyUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Where to get a key</a>
    </form> : <p className="text-xs text-muted-foreground">Only an owner or admin can add keys.</p>}
    {save.error ? <p role="alert" className="text-sm text-destructive">{save.error}</p> : null}
    {message.error ? <p role="alert" className="text-sm text-destructive">{message.error}</p> : message.notice ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message.notice}</p> : null}
  </li>;
}
