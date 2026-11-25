"use client";
import Link from "next/link";
import { useActionState, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IMAGE_MODELS, IMAGE_PLATFORMS, UNSUPPORTED_IMAGE_MODELS, type ImageChoice, type ImageModel, type ImagePlatformId } from "@/lib/studio/images/catalog";
import { SAMPLE_SHOT, renderShot } from "@/lib/studio/images/prompts";
import type { ImagePlatformState, ImageTests } from "@/lib/studio/images/keys";
import { discoverImageModelsAction, removeImageKeyAction, saveImageKeyAction, setImageChoiceAction, testImageAction } from "../actions";

type State = { error?: string; notice?: string };
const dialectWord = { natural: "Flowing description", edit: "Instruction to an editing model", tags: "Short phrases plus a negative prompt", ideogram: "Quoted text first" } as const;

function KeyForm({ locationId, platform, hint }: { locationId: string; platform: ImagePlatformId; hint: string | null }) {
  const [state, action, pending] = useActionState(saveImageKeyAction.bind(null, locationId, platform), {} as State);
  const [removed, remove, removing] = useActionState(removeImageKeyAction.bind(null, locationId, platform), {} as State);
  const id = useId();
  return <div className="space-y-2">
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1"><Label htmlFor={`${id}-key`} className="text-xs">{hint ? `Replace key (ends ${hint})` : "API key"}</Label>
        <Input id={`${id}-key`} name="apiKey" type="password" autoComplete="off" spellCheck={false} required /></div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Checking…" : "Save key"}</Button>
      {hint ? <Button type="button" variant="link" size="sm" className="h-auto px-0 text-destructive" disabled={removing} onClick={() => (document.getElementById(`${id}-rm`) as HTMLFormElement | null)?.requestSubmit()}>Remove</Button> : null}
    </form>
    {hint ? <form id={`${id}-rm`} action={remove} className="hidden" /> : null}
    {state.error || removed.error ? <p role="alert" className="text-sm text-destructive">{state.error ?? removed.error}</p> : state.notice ? <p role="status" className="text-sm text-muted-foreground">{state.notice}</p> : null}
  </div>;
}

function ModelRow({ locationId, model, hasKey, choice, tests, canManage, discovered }: {
  locationId: string; model: ImageModel; hasKey: Partial<Record<ImagePlatformId, boolean>>; choice: ImageChoice | null; tests: ImageTests; canManage: boolean; discovered: Record<string, string[]>;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ platform: string; ok: boolean; message: string; ms: number; dataUrl?: string; prompt?: string } | null>(null);
  const sample = renderShot(SAMPLE_SHOT, model.dialect, { acceptsText: model.text, negative: model.negative });
  return <li className="space-y-2 rounded-md border p-3">
    <div><p className="font-medium">{model.label}</p><p className="text-xs text-muted-foreground">{model.strength}</p>
      <p className="text-xs text-muted-foreground">{model.references ? `Takes up to ${model.references} reference photo${model.references === 1 ? "" : "s"}` : "Text only (no reference photo)"} · {model.text ? "draws readable text" : "not for text"} · prompt style: {dialectWord[model.dialect]}</p>
      {model.note ? <p className="text-xs text-muted-foreground">{model.note}</p> : null}</div>
    <ul className="space-y-2">{model.endpoints.map(e => {
      const platform = IMAGE_PLATFORMS[e.platform], endpoint = e.discovered ? (picked[e.platform] ?? (choice?.model === model.id && choice.platform === e.platform ? choice.endpoint : undefined) ?? discovered[e.platform]?.[0] ?? e.endpoint) : e.endpoint;
      const on = choice?.model === model.id && choice.platform === e.platform;
      const last = tests[`${e.platform}|${model.id}|${endpoint}`];
      const list = e.discovered ? discovered[e.platform] ?? [] : [];
      return <li key={e.platform} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-40 font-medium">{platform.label}</span>
        <span className="text-xs text-muted-foreground">{e.price ? `${e.price} · ` : ""}{e.status === "documented" ? "endpoint documented" : "endpoint unverified until tested"}</span>
        {!hasKey[e.platform] ? <span className="text-xs text-muted-foreground">Add the key above to use this.</span> : <>
          {e.discovered && list.length ? <select aria-label={`Model id on ${platform.label}`} value={endpoint} onChange={ev => setPicked(p => ({ ...p, [e.platform]: ev.target.value }))} className="min-h-9 rounded-md border bg-background px-2 text-xs">{list.map(id => <option key={id} value={id}>{id}</option>)}</select> : null}
          <Button type="button" size="sm" variant={on ? "default" : "outline"} disabled={!canManage || pending} aria-pressed={on}
            onClick={() => start(async () => { const r = await setImageChoiceAction(locationId, on ? null : model.id, on ? null : e.platform, e.discovered ? endpoint : null); setMessage(r.error ?? ""); })}>{on ? "In use" : "Use this"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={!canManage || pending}
            onClick={() => start(async () => { setMessage(""); const r = await testImageAction(locationId, e.platform, model.id, e.discovered ? endpoint : null); setResult({ platform: e.platform, ...r }); })}>Test (one picture)</Button>
          {last ? <span className={`text-xs ${last.ok ? "text-emerald-600" : "text-destructive"}`}>{last.ok ? `Worked ${new Date(last.at).toLocaleDateString("en-GB")} (${(last.ms / 1000).toFixed(0)} s)` : `Failed: ${last.message}`}</span> : null}
        </>}
      </li>;
    })}</ul>
    {result && model.endpoints.some(e => e.platform === result.platform) ? <div className="space-y-1">
      {result.ok ? <>{result.dataUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={result.dataUrl} alt="Test picture" className="max-h-48 rounded-md border" /> : null}<p className="text-xs text-muted-foreground">Made in {(result.ms / 1000).toFixed(1)} s with: {result.prompt}</p></>
        : <p role="alert" className="text-sm text-destructive">{result.message}</p>}</div> : null}
    {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
    <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">How a storyboard shot is written for this model</summary>
      <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/40 p-2">{sample.prompt}{sample.negative ? `\n\nNegative: ${sample.negative}` : ""}</p></details>
  </li>;
}

/** Settings → AI → Images: which platforms hold your keys and which models draw the storyboard frames. Off until a model is chosen. */
export function ImageGenerationCard({ locationId, canManage, platforms, choice, tests, discovered }: {
  locationId: string; canManage: boolean; platforms: ImagePlatformState[]; choice: ImageChoice | null; tests: ImageTests; discovered: Record<string, string[]>;
}) {
  const hasKey = Object.fromEntries(platforms.map(p => [p.id, Boolean(p.hint)])) as Partial<Record<ImagePlatformId, boolean>>;
  const [found, setFound] = useState(discovered);
  const [, start] = useTransition();
  return <section aria-labelledby="img-heading" className="space-y-4 rounded-xl border bg-card p-4">
    <div className="space-y-1">
      <h2 id="img-heading" className="text-lg font-semibold">Storyboard images</h2>
      <p className="text-sm text-muted-foreground">Off until you choose a model. When on, frames for beats without footage are drawn by the model you pick, using your photo as the reference. Your photo and the prompts go only to the platform you choose, only when you generate, and are billed to your account there.</p>
      <p className="text-sm">{choice ? <>In use: <strong>{IMAGE_MODELS.find(m => m.id === choice.model)?.label}</strong> on <strong>{IMAGE_PLATFORMS[choice.platform].label}</strong>{choice.endpoint ? ` (${choice.endpoint})` : ""}.</> : "No model chosen: placeholders keep using your photo as it is."}</p>
    </div>
    <div className="space-y-2"><h3 className="text-sm font-semibold">1. Platforms and keys</h3>
      <p className="text-xs text-muted-foreground">A platform is where your key and bill live. Several platforms run the same model, so add the ones you already use. One key is enough to start.</p>
      <ul className="space-y-2">{platforms.map(p => { const info = IMAGE_PLATFORMS[p.id]; return <li key={p.id} className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-medium">{info.label}</p><p className="text-xs">{p.hint ? <span className="text-emerald-600">Key ending {p.hint}</span> : <span className="text-muted-foreground">No key</span>}</p></div>
        <p className="text-xs text-muted-foreground">{info.billing}</p>
        {p.shared ? <p className="text-xs text-muted-foreground">{info.sharedKey} <Link href={info.sharedKeyHref ?? "/settings/ai"} className="underline underline-offset-2">{info.sharedKeyLabel ?? "Settings → AI"}</Link></p>
          : canManage ? <KeyForm locationId={locationId} platform={p.id} hint={p.hint} /> : <p className="text-xs text-muted-foreground">Only an owner or admin can change keys.</p>}
        <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Where to get a key</a>
      </li>; })}</ul>
    </div>
    <div className="space-y-2"><h3 className="text-sm font-semibold">2. Models</h3>
      <p className="text-xs text-muted-foreground">Each model is shown on every platform that runs it. &quot;Test&quot; makes one real picture (a few cents) so a key and an endpoint are proven, not assumed. Model names change often: OpenAI and Google ids come from their own lists.
        {" "}{hasKey.openai || hasKey.google ? <button type="button" className="underline underline-offset-2" onClick={() => start(async () => { const [o, g] = await Promise.all([discoverImageModelsAction(locationId, "openai"), discoverImageModelsAction(locationId, "google")]); setFound({ openai: o, google: g }); })}>Refresh the model lists</button> : null}</p>
      <ul className="space-y-2">{IMAGE_MODELS.map(m => <ModelRow key={m.id} locationId={locationId} model={m} hasKey={hasKey} choice={choice} tests={tests} canManage={canManage} discovered={found} />)}
        {UNSUPPORTED_IMAGE_MODELS.map(m => <li key={m.id} className="rounded-md border border-dashed p-3 text-sm"><p className="font-medium">{m.label} <span className="text-xs font-normal text-muted-foreground">· not available</span></p><p className="text-xs text-muted-foreground">{m.reason}</p></li>)}</ul>
    </div>
  </section>;
}
