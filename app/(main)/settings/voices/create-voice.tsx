"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CLONE_CONSENT_STATEMENT, providerLabels, type HostedVoiceProvider } from "@/lib/studio/voices/policy";
import { consentSpeech, MIN_RECORDING_SECONDS, RECORDING_TIPS, SAMPLE_PASSAGES, type DesignFields } from "@/lib/studio/voices/library";
import { button } from "./voice-library";

type State = { error?: string; notice?: string };
const field = "block min-h-11 w-full rounded-md border bg-background px-3";
const Say = ({ s }: { s: State }) => s.error ? <p role="alert" className="text-destructive">{s.error}</p> : s.notice ? <p role="status" className="text-muted-foreground">{s.notice}</p> : null;
type Mode = "record" | "upload" | "design";

/** Microphone capture with a level meter. The recording is one continuous clip: the consent sentence first, then the passages. */
function Recorder({ onChange }: { onChange: (file: File | null, seconds: number) => void }) {
  const [phase, setPhase] = useState<"idle" | "recording" | "done">("idle");
  const [seconds, setSeconds] = useState(0); const [level, setLevel] = useState(0); const [error, setError] = useState<string | null>(null); const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; chunks: Blob[]; started: number; timer: number; raf: number } | null>(null);
  useEffect(() => () => { const r = rec.current; if (r) { clearInterval(r.timer); cancelAnimationFrame(r.raf); r.stream.getTracks().forEach(t => t.stop()); void r.ctx.close(); } if (url) URL.revokeObjectURL(url); }, [url]);
  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("This browser cannot record audio. Use Upload a sample instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext(), analyser = ctx.createAnalyser(); analyser.fftSize = 512; ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const recorder = new MediaRecorder(stream), chunks: Blob[] = [];
      const state = { recorder, stream, ctx, chunks, started: Date.now(), timer: 0, raf: 0 };
      const meter = () => { analyser.getByteTimeDomainData(data); let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128)); setLevel(Math.min(1, peak / 100)); state.raf = requestAnimationFrame(meter); };
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        clearInterval(state.timer); cancelAnimationFrame(state.raf); stream.getTracks().forEach(t => t.stop()); void ctx.close();
        const secs = Math.round((Date.now() - state.started) / 1000);
        const mime = (recorder.mimeType || "audio/webm").split(";")[0], ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        const file = new File(chunks, `recording.${ext}`, { type: mime });
        setUrl(URL.createObjectURL(file)); setSeconds(secs); setLevel(0); setPhase("done"); onChange(file, secs); rec.current = null;
      };
      rec.current = state; recorder.start(); setSeconds(0); setPhase("recording"); onChange(null, 0);
      state.timer = window.setInterval(() => setSeconds(Math.round((Date.now() - state.started) / 1000)), 500); meter();
    } catch { setError("Microphone access was blocked. Allow it in the browser's site settings and try again."); }
  }
  const stop = () => rec.current?.recorder.stop();
  const again = () => { if (url) URL.revokeObjectURL(url); setUrl(null); setPhase("idle"); setSeconds(0); onChange(null, 0); };
  const short = phase === "done" && seconds < MIN_RECORDING_SECONDS;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3">
      {phase === "idle" ? <button type="button" onClick={start} className={button}>Start recording</button> : null}
      {phase === "recording" ? <button type="button" onClick={stop} className={button}>Stop</button> : null}
      {phase === "done" ? <button type="button" onClick={again} className={button}>Record again</button> : null}
      <span aria-live="polite" className="tabular-nums text-muted-foreground">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} / aim for 1:30</span>
    </div>
    {phase === "recording" ? <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} className="h-2 w-full overflow-hidden rounded bg-muted"><div className={`h-full ${level > 0.9 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.round(level * 100)}%` }} /></div> : null}
    {phase === "recording" && level < 0.05 ? <p className="text-xs text-muted-foreground">No sound yet. Check your microphone.</p> : null}
    {level > 0.9 ? <p className="text-xs text-destructive">Too loud: move back from the microphone.</p> : null}
    {phase === "done" && url ? <audio controls src={url} className="w-full" /> : null}
    {short ? <p role="alert" className="text-destructive">That is only {seconds} seconds. Record at least {MIN_RECORDING_SECONDS} seconds (the passages take about a minute and a half).</p> : null}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </div>;
}

function CloneForm({ locationId, providers, mode }: { locationId: string; providers: HostedVoiceProvider[]; mode: "record" | "upload" }) {
  const router = useRouter();
  const [state, setState] = useState<State>({}); const [busy, setBusy] = useState(false); const [name, setName] = useState("");
  const [recording, setRecording] = useState<{ file: File | null; seconds: number }>({ file: null, seconds: 0 });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setState({});
    const form = new FormData(event.currentTarget);
    if (mode === "record") {
      if (!recording.file || recording.seconds < MIN_RECORDING_SECONDS) { setState({ error: `Record at least ${MIN_RECORDING_SECONDS} seconds first.` }); setBusy(false); return; }
      form.set("sample", recording.file); form.set("consentRecorded", "on");
    }
    try {
      const response = await fetch("/api/studio/voices/clone", { method: "POST", headers: { "X-Studio-Tenant": locationId }, body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setState({ error: body.error ?? "The voice could not be created." });
      else { setState({ notice: "Voice created. It now appears in the library." }); (event.target as HTMLFormElement).reset(); setName(""); setRecording({ file: null, seconds: 0 }); router.refresh(); }
    } catch { setState({ error: "The voice could not be created. Check your connection." }); }
    setBusy(false);
  }
  return <form onSubmit={submit} className="space-y-3">
    <label className="block space-y-1"><span>Provider</span><select name="provider" className={field}>{providers.map(p => <option key={p} value={p}>{providerLabels[p]}</option>)}</select></label>
    <label className="block space-y-1"><span>Voice name</span><input name="name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} className={field} /></label>
    <label className="block space-y-1"><span>Persona (optional)</span><input name="persona" maxLength={80} placeholder="Host, narrator, support agent…" className={field} /></label>
    {mode === "record" ? <div className="space-y-3 rounded-lg border p-3">
      <p className="font-medium">Read this aloud, in one take</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{RECORDING_TIPS.map(t => <li key={t}>{t}</li>)}</ul>
      <ol className="space-y-2">
        <li className="rounded bg-muted p-2"><span className="block text-xs uppercase tracking-wide text-muted-foreground">1 · Consent</span>{consentSpeech(name || "your voice name")}</li>
        {SAMPLE_PASSAGES.map((p, i) => <li key={i} className="rounded bg-muted p-2"><span className="block text-xs uppercase tracking-wide text-muted-foreground">{i + 2} · Passage</span>{p}</li>)}
      </ol>
      <Recorder onChange={(file, seconds) => setRecording({ file, seconds })} />
    </div> : <label className="block space-y-1"><span>Voice sample</span><input name="sample" type="file" required accept="audio/*" className="block w-full" />
      <span className="block text-xs text-muted-foreground">One clean recording of a single speaker, 30 seconds to 2 minutes works best. The sample goes to the provider and is not kept by Studio.</span></label>}
    <label className="flex items-start gap-2"><input type="checkbox" name="attested" required className="mt-1 size-4" /><span>{CLONE_CONSENT_STATEMENT}</span></label>
    <button type="submit" disabled={busy} className={button}>{busy ? "Creating…" : "Create voice"}</button>
    <Say s={state} />
  </form>;
}

const emptyDesign: DesignFields = { gender: "", age: "", accent: "", tone: "", pace: "", notes: "" };
function DesignForm({ locationId, initial }: { locationId: string; initial?: Partial<DesignFields> }) {
  const router = useRouter();
  const [fields, setFields] = useState<DesignFields>({ ...emptyDesign, ...initial }); const [busy, setBusy] = useState(false); const [state, setState] = useState<State>({});
  const [previews, setPreviews] = useState<Array<{ generatedVoiceId: string; audioBase64: string }>>([]); const [prompt, setPrompt] = useState(""); const [name, setName] = useState("");
  const set = (k: keyof DesignFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setFields({ ...fields, [k]: e.target.value });
  const post = async (path: string, body: unknown) => { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify(body) }); return { ok: r.ok, body: await r.json().catch(() => ({})) as Record<string, unknown> }; };
  async function design(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setState({}); setPreviews([]);
    try { const r = await post("/api/studio/voices/design", fields);
      if (!r.ok) setState({ error: String(r.body.error ?? "Could not design the voice.") }); else { setPreviews(r.body.previews as never); setPrompt(String(r.body.prompt)); } }
    catch { setState({ error: "Could not design the voice. Check your connection." }); }
    setBusy(false);
  }
  async function save(generatedVoiceId: string) {
    if (!name.trim()) { setState({ error: "Name the voice first." }); return; }
    setBusy(true); setState({});
    try { const r = await post("/api/studio/voices/design/save", { name, fields, generatedVoiceId });
      if (!r.ok) setState({ error: String(r.body.error ?? "The voice could not be saved.") }); else { setState({ notice: "Voice saved. It now appears in the library." }); setPreviews([]); setName(""); router.refresh(); } }
    catch { setState({ error: "The voice could not be saved. Check your connection." }); }
    setBusy(false);
  }
  return <div className="space-y-3">
    <form onSubmit={design} className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1"><span>Gender</span><select value={fields.gender} onChange={set("gender")} className={field}><option value="">Any</option><option value="woman">Woman</option><option value="man">Man</option></select></label>
      <label className="space-y-1"><span>Age</span><select value={fields.age} onChange={set("age")} className={field}><option value="">Any</option><option value="young">Young</option><option value="middle-aged">Middle-aged</option><option value="older">Older</option></select></label>
      <label className="space-y-1"><span>Accent (optional)</span><input value={fields.accent} onChange={set("accent")} placeholder="British, Irish, Texan…" maxLength={40} className={field} /></label>
      <label className="space-y-1"><span>Tone</span><input value={fields.tone} onChange={set("tone")} placeholder="warm and upbeat, calm, authoritative…" maxLength={60} className={field} /></label>
      <label className="space-y-1"><span>Pace</span><select value={fields.pace} onChange={set("pace")} className={field}><option value="">Natural</option><option value="slow">Slow</option><option value="medium">Medium</option><option value="fast">Fast</option></select></label>
      <label className="space-y-1 sm:col-span-2"><span>Anything else</span><textarea value={fields.notes} onChange={set("notes")} rows={3} maxLength={500} placeholder="A friendly tutorial host who sounds like they're smiling. Clear diction, a little breathy." className="block w-full rounded-md border bg-background px-3 py-2" /></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Describe delivery (pace, warmth, breathiness) rather than the word &quot;accent&quot; unless you mean a regional accent. Designing uses your ElevenLabs credits.</p>
      <div className="sm:col-span-2"><button type="submit" disabled={busy} className={button}>{busy && !previews.length ? "Designing…" : "Design voice"}</button></div>
    </form>
    {previews.length ? <div className="space-y-3 rounded-lg border p-3"><p className="text-xs text-muted-foreground">Prompt sent: {prompt}</p>
      <label className="block space-y-1"><span>Name for the voice you pick</span><input value={name} onChange={e => setName(e.target.value)} maxLength={80} className={field} /></label>
      <ul className="space-y-2">{previews.map((p, i) => <li key={p.generatedVoiceId} className="flex flex-wrap items-center gap-3"><span className="text-sm font-medium">Candidate {i + 1}</span><audio controls src={`data:audio/mpeg;base64,${p.audioBase64}`} className="max-w-full" /><button type="button" disabled={busy} onClick={() => save(p.generatedVoiceId)} className={button}>Use this voice</button></li>)}</ul></div> : null}
    <Say s={state} />
  </div>;
}

/** Disclosed: the library stays the first thing on the page. */
export function CreateVoice({ locationId, providers }: { locationId: string; providers: HostedVoiceProvider[] }) {
  const [mode, setMode] = useState<Mode>("record");
  const [seed, setSeed] = useState<{ key: number; fields: Partial<DesignFields> } | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const on = (e: Event) => { if (!providers.includes("elevenlabs")) return; setSeed({ key: Date.now(), fields: (e as CustomEvent<Partial<DesignFields>>).detail }); setMode("design"); if (details.current) { details.current.open = true; details.current.scrollIntoView({ behavior: "smooth", block: "nearest" }); } };
    window.addEventListener("voices:design", on); return () => window.removeEventListener("voices:design", on);
  }, [providers]);
  if (!providers.length) return <p className="text-sm text-muted-foreground">Add a Fish Audio or ElevenLabs key in Settings → AI to record, clone or design a voice.</p>;
  const modes: Array<[Mode, string, boolean]> = [["record", "Record", true], ["upload", "Upload a sample", true], ["design", "Design from a description", providers.includes("elevenlabs")]];
  return <details ref={details} className="rounded-xl border p-4 text-sm">
    <summary className="min-h-11 cursor-pointer font-medium leading-[2.75rem]">Create a voice</summary>
    <div className="mt-3 space-y-3">
      <div role="tablist" aria-label="How to create a voice" className="flex flex-wrap gap-2">
        {modes.filter(m => m[2]).map(([key, label]) => <button key={key} role="tab" type="button" aria-selected={mode === key} onClick={() => setMode(key)} className={`inline-flex min-h-11 items-center rounded-md border px-3 font-medium ${mode === key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>{label}</button>)}
      </div>
      {mode === "design" ? <DesignForm key={seed?.key ?? 0} locationId={locationId} initial={seed?.fields} /> : <CloneForm key={mode} locationId={locationId} providers={providers} mode={mode} />}
    </div>
  </details>;
}
