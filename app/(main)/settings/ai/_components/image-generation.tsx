"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CONNECTIONS, type ConnectionId } from "@/lib/studio/ai/connections";
import { imageModel, type ImageChoice, type ImagePlatformId } from "@/lib/studio/images/catalog";
import { SAMPLE_SHOT, renderShot } from "@/lib/studio/images/prompts";
import type { ImageTests } from "@/lib/studio/images/keys";
import { setImageChoicesAction, testImageAction } from "../actions";

export interface ImageOffer { model: string; platform: ConnectionId }
const dialectWord = { natural: "Flowing description", edit: "Instruction to an editing model", tags: "Short phrases plus a negative prompt", ideogram: "Quoted text first" } as const;
const keyOf = (c: { model: string; platform: string } | null) => c ? `${c.model}|${c.platform}` : "";

/** Storyboard frames: which connected, allowed model draws them, which is the fallback, and a Test with the picture shown here. */
export function ImageActions({ locationId, canManage, offers, choice, fallback, tests, discovered }: {
  locationId: string; canManage: boolean; offers: ImageOffer[]; choice: ImageChoice | null; fallback: ImageChoice | null; tests: ImageTests; discovered: Record<string, string[]>;
}) {
  const [primary, setPrimary] = useState<ImageChoice | null>(choice);
  const [second, setSecond] = useState<ImageChoice | null>(fallback);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string; ms: number; dataUrl?: string; prompt?: string }>>({});
  const [testing, setTesting] = useState("");
  const endpointOf = (o: ImageOffer) => { const e = imageModel(o.model)?.endpoints.find(x => x.platform === o.platform); return e?.discovered ? (discovered[o.platform]?.[0] ?? e.endpoint) : e?.endpoint ?? ""; };
  const toChoice = (value: string): ImageChoice | null => { const [model, platform] = value.split("|"); const o = offers.find(x => x.model === model && x.platform === platform); return o ? { model, platform: platform as ImagePlatformId, ...(imageModel(model)?.endpoints.find(x => x.platform === platform)?.discovered ? { endpoint: endpointOf(o) } : {}) } : null; };
  const save = (nextPrimary: ImageChoice | null, nextSecond: ImageChoice | null) => {
    const before = { primary, second }; setPrimary(nextPrimary); setSecond(nextPrimary ? nextSecond : null); setError("");
    start(async () => { const r = await setImageChoicesAction(locationId, nextPrimary, nextPrimary ? nextSecond : null); if (r.error) { setPrimary(before.primary); setSecond(before.second); setError(r.error); } });
  };
  const label = (o: ImageOffer) => `${imageModel(o.model)?.label ?? o.model} · ${CONNECTIONS[o.platform].label}`;
  const runTest = (o: ImageOffer) => { const k = keyOf(o); setTesting(k); setError("");
    start(async () => { const r = await testImageAction(locationId, o.platform, o.model, imageModel(o.model)?.endpoints.find(x => x.platform === o.platform)?.discovered ? endpointOf(o) : null); setResults(p => ({ ...p, [k]: r })); setTesting(""); }); };

  if (!offers.length) return <section className="space-y-2 rounded-lg border p-4"><h2 className="text-base font-semibold">What makes it</h2>
    <p className="text-sm text-muted-foreground">No image platform is connected and switched on for images yet. Connect one (the fal.ai key alone reaches six models) and allow its image models.</p>
    <Link href="/settings/ai/connections" className="text-sm text-primary hover:underline">Open Connections</Link></section>;
  return <section aria-label="What makes it" className="space-y-3">
    <h2 className="text-base font-semibold">What makes it</h2>
    <div className="space-y-3 rounded-lg border p-4">
      <div><h3 className="font-medium">Storyboard frames</h3><p className="text-xs text-muted-foreground">Frames for beats without footage, drawn from your photo and reviewed before they go into a video. Off until you choose a model: placeholders then keep using your photo as it is.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span className="font-medium">Model</span>
          <select value={keyOf(primary)} disabled={!canManage} onChange={e => save(toChoice(e.target.value), second)} className="block min-h-11 w-full rounded-md border bg-background px-2">
            <option value="">Off (use my photo as it is)</option>{offers.map(o => <option key={keyOf(o)} value={keyOf(o)}>{label(o)}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="font-medium">If it fails, use</span>
          <select value={keyOf(second)} disabled={!canManage || !primary} onChange={e => save(primary, toChoice(e.target.value))} className="block min-h-11 w-full rounded-md border bg-background px-2">
            <option value="">Nothing: show the error</option>{offers.filter(o => keyOf(o) !== keyOf(primary)).map(o => <option key={keyOf(o)} value={keyOf(o)}>{label(o)}</option>)}</select></label>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">{pending && !testing ? "Saving…" : primary ? `In use: ${label(primary)}${second ? `, then ${label(second)}` : ""}.` : "No model chosen."}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
    <div className="space-y-2"><h3 className="text-sm font-semibold">Models you can use</h3>
      <p className="text-xs text-muted-foreground">Only connected platforms and the models you allowed on Connections. Test makes one real picture (a few cents) so a key and an endpoint are proven, not assumed.</p>
      <ul className="space-y-2">{offers.map(o => { const k = keyOf(o), m = imageModel(o.model)!, e = m.endpoints.find(x => x.platform === o.platform)!, r = results[k];
        const last = tests[`${o.platform}|${o.model}|${endpointOf(o)}`]; const sample = renderShot(SAMPLE_SHOT, m.dialect, { acceptsText: m.text, negative: m.negative });
        return <li key={k} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2"><div className="min-w-48 flex-1"><p className="text-sm font-medium">{m.label} <span className="font-normal text-muted-foreground">· {CONNECTIONS[o.platform].label}</span></p>
            <p className="text-xs text-muted-foreground">{m.strength} {e.price ? `${e.price}. ` : ""}{m.references ? `Takes up to ${m.references} reference photo${m.references === 1 ? "" : "s"}.` : "Text only."} Prompt style: {dialectWord[m.dialect]}. {e.status === "documented" ? "Endpoint documented." : "Endpoint unverified until tested."}</p></div>
            {canManage ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => runTest(o)}>{testing === k ? "Making a picture…" : "Test (one picture)"}</Button> : null}</div>
          {last && !r ? <p className={`text-xs ${last.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{last.ok ? `Worked ${new Date(last.at).toLocaleDateString("en-GB")} (${(last.ms / 1000).toFixed(0)} s)` : `Last test failed: ${last.message}`}</p> : null}
          {r ? r.ok && r.dataUrl ? <div className="space-y-1">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={r.dataUrl} alt="Test picture" className="max-h-48 rounded-md border" /><p className="text-xs text-muted-foreground">Made in {(r.ms / 1000).toFixed(1)} s with: {r.prompt}</p></div> : <p role="alert" className="text-sm text-destructive">{r.message}</p> : null}
          <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">How a storyboard shot is written for this model</summary><p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/40 p-2">{sample.prompt}{sample.negative ? `\n\nNegative: ${sample.negative}` : ""}</p></details>
        </li>; })}</ul>
    </div>
  </section>;
}
