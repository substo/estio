"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CLONE_CONSENT_STATEMENT, providerLabels, type HostedVoiceProvider } from "@/lib/studio/voices/policy";
import { consentSpeech, PREVIEW_TEXT_MIN, SAMPLE_PASSAGES, type DesignFields } from "@/lib/studio/voices/library";
import { checkSampleLength, encodeWav16, resampleMono, SAMPLE_POLICY, SAMPLE_TIPS, WAV_RATE, type CloneTarget } from "@/lib/studio/voices/clone-sample";
import { button } from "./voice-library";

type State = { error?: string; notice?: string };
const field = "block min-h-11 w-full rounded-md border bg-background px-3";
const Say = ({ s }: { s: State }) => s.error ? <p role="alert" className="text-destructive">{s.error}</p> : s.notice ? <p role="status" className="text-muted-foreground">{s.notice}</p> : null;
type Mode = "record" | "upload" | "design";

/** Microphone capture as raw PCM, encoded to a 24 kHz mono 16-bit WAV in the browser (MediaRecorder's WebM/Opus is not reliably accepted by the providers).
 *  One continuous take: the consent sentence first, then the passages. The meter shows the chosen voice's minimum and "good enough" marks. */
function Recorder({ target, onChange }: { target: CloneTarget; onChange: (file: File | null, seconds: number) => void }) {
  const policy = SAMPLE_POLICY[target];
  const [phase, setPhase] = useState<"idle" | "recording" | "done">("idle");
  const [seconds, setSeconds] = useState(0); const [level, setLevel] = useState(0); const [error, setError] = useState<string | null>(null); const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<{ stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; source: MediaStreamAudioSourceNode; chunks: Float32Array[]; samples: number; raf: number } | null>(null);
  const teardown = () => { const r = rec.current; if (!r) return; cancelAnimationFrame(r.raf); r.node.onaudioprocess = null; r.node.disconnect(); r.source.disconnect(); r.stream.getTracks().forEach(t => t.stop()); void r.ctx.close(); };
  useEffect(() => () => { teardown(); if (url) URL.revokeObjectURL(url); }, [url]);
  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") { setError("This browser cannot record audio. Use Upload a sample instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext(), source = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
      const state = { stream, ctx, node, source, chunks: [] as Float32Array[], samples: 0, raf: 0 };
      node.onaudioprocess = e => {
        const data = e.inputBuffer.getChannelData(0); state.chunks.push(new Float32Array(data)); state.samples += data.length;
        let peak = 0; for (let i = 0; i < data.length; i += 16) peak = Math.max(peak, Math.abs(data[i])); setLevel(Math.min(1, peak * 1.5)); setSeconds(Math.floor(state.samples / ctx.sampleRate));
      };
      source.connect(node); node.connect(mute); mute.connect(ctx.destination);
      rec.current = state; setSeconds(0); setPhase("recording"); onChange(null, 0);
    } catch { setError("Microphone access was blocked. Allow it in the browser's site settings and try again."); }
  }
  function stop() {
    const r = rec.current; if (!r) return;
    const total = new Float32Array(r.samples); let at = 0; for (const c of r.chunks) { total.set(c, at); at += c.length; }
    const secs = r.samples / r.ctx.sampleRate; teardown(); rec.current = null;
    const wav = encodeWav16(resampleMono(total, r.ctx.sampleRate, WAV_RATE), WAV_RATE);
    const file = new File([wav as BlobPart], "recording.wav", { type: "audio/wav" });
    setUrl(URL.createObjectURL(file)); setSeconds(Math.round(secs)); setLevel(0); setPhase("done"); onChange(file, secs);
  }
  const again = () => { if (url) URL.revokeObjectURL(url); setUrl(null); setPhase("idle"); setSeconds(0); onChange(null, 0); };
  const verdict = phase === "idle" ? null : checkSampleLength(target, seconds);
  const pct = (n: number) => `${Math.min(100, (n / policy.maxSeconds) * 100)}%`;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3">
      {phase === "idle" ? <button type="button" onClick={start} className={button}>Start recording</button> : null}
      {phase === "recording" ? <button type="button" onClick={stop} className={button}>Stop</button> : null}
      {phase === "done" ? <button type="button" onClick={again} className={button}>Record again</button> : null}
      <span aria-live="polite" className="tabular-nums text-muted-foreground">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
    </div>
    <div role="meter" aria-label="Sample length" aria-valuemin={0} aria-valuemax={policy.maxSeconds} aria-valuenow={Math.min(seconds, policy.maxSeconds)} aria-valuetext={`${seconds} seconds; minimum ${policy.minSeconds}, good at ${policy.goodSeconds}`} className="relative h-3 w-full overflow-hidden rounded bg-muted">
      <div className={`h-full ${seconds < policy.minSeconds ? "bg-destructive/70" : seconds < policy.goodSeconds ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: pct(seconds) }} />
      <span className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: pct(policy.minSeconds) }} /><span className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: pct(policy.goodSeconds) }} />
    </div>
    <p className="text-xs text-muted-foreground">Minimum {policy.minSeconds}s · good from {policy.goodSeconds}s · stop before {policy.maxSeconds}s. {policy.basis}</p>
    {phase === "recording" ? <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} className="h-2 w-full overflow-hidden rounded bg-muted"><div className={`h-full ${level > 0.9 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${level * 100}%` }} /></div> : null}
    {phase === "recording" && seconds > 2 && level < 0.03 ? <p className="text-xs text-muted-foreground">No sound yet. Check your microphone.</p> : null}
    {level > 0.9 ? <p className="text-xs text-destructive">Too loud: move back from the microphone.</p> : null}
    {phase === "done" && url ? <audio controls src={url} className="w-full" /> : null}
    {verdict ? <p role={verdict.level === "error" ? "alert" : "status"} className={verdict.level === "error" ? "text-destructive" : verdict.level === "warn" ? "text-amber-700" : "text-muted-foreground"}>{verdict.message}</p> : null}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </div>;
}

/** Length of an uploaded sample, read in the browser (the server only knows WAV headers). */
function useUploadSeconds(file: File | null) {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    setSeconds(null); if (!file) return;
    const url = URL.createObjectURL(file), audio = new Audio();
    audio.preload = "metadata"; audio.onloadedmetadata = () => setSeconds(Number.isFinite(audio.duration) ? audio.duration : null); audio.onerror = () => setSeconds(0); audio.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return seconds;
}

function CloneForm({ locationId, providers, mode }: { locationId: string; providers: HostedVoiceProvider[]; mode: "record" | "upload" }) {
  const router = useRouter();
  const [state, setState] = useState<State>({}); const [busy, setBusy] = useState(false); const [name, setName] = useState("");
  const [provider, setProvider] = useState<HostedVoiceProvider>(providers[0]);
  const [recording, setRecording] = useState<{ file: File | null; seconds: number }>({ file: null, seconds: 0 });
  const [upload, setUpload] = useState<File | null>(null); const uploadSeconds = useUploadSeconds(upload);
  const uploadVerdict = mode === "upload" && upload && uploadSeconds !== null ? checkSampleLength(provider, uploadSeconds) : null;
  const script = `${consentSpeech(name || "your voice name")} ${SAMPLE_PASSAGES.join(" ")}`;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setState({});
    const form = new FormData(event.currentTarget);
    if (mode === "record") {
      const verdict = recording.file ? checkSampleLength(provider, recording.seconds) : { level: "error", message: "Record the passages first." };
      if (verdict.level === "error") { setState({ error: verdict.message }); setBusy(false); return; }
      form.set("sample", recording.file as File); form.set("consentRecorded", "on"); form.set("transcript", script);
    } else if (uploadVerdict?.level === "error") { setState({ error: uploadVerdict.message }); setBusy(false); return; }
    try {
      const response = await fetch("/api/studio/voices/clone", { method: "POST", headers: { "X-Studio-Tenant": locationId }, body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setState({ error: body.error ?? "The voice could not be created." });
      else { setState({ notice: "Voice created. It now appears in the library." }); (event.target as HTMLFormElement).reset(); setName(""); setUpload(null); setRecording({ file: null, seconds: 0 }); router.refresh(); }
    } catch { setState({ error: "The voice could not be created. Check your connection." }); }
    setBusy(false);
  }
  return <form onSubmit={submit} className="space-y-3">
    <label className="block space-y-1"><span>Provider</span><select name="provider" value={provider} onChange={e => setProvider(e.target.value as HostedVoiceProvider)} className={field}>{providers.map(p => <option key={p} value={p}>{providerLabels[p]}</option>)}</select></label>
    <label className="block space-y-1"><span>Voice name</span><input name="name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} className={field} /></label>
    <label className="block space-y-1"><span>Persona (optional)</span><input name="persona" maxLength={80} placeholder="Host, narrator, support agent…" className={field} /></label>
    {mode === "record" ? <div className="space-y-3 rounded-lg border p-3">
      <p className="font-medium">Read this aloud, in one take</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{SAMPLE_TIPS.map(t => <li key={t}>{t}</li>)}</ul>
      <ol className="space-y-2">
        <li className="rounded bg-muted p-2"><span className="block text-xs uppercase tracking-wide text-muted-foreground">1 · Consent</span>{consentSpeech(name || "your voice name")}</li>
        {SAMPLE_PASSAGES.map((p, i) => <li key={i} className="rounded bg-muted p-2"><span className="block text-xs uppercase tracking-wide text-muted-foreground">{i + 2} · Passage</span>{p}</li>)}
      </ol>
      <Recorder key={provider} target={provider} onChange={(file, seconds) => setRecording({ file, seconds })} />
    </div> : <div className="space-y-2"><label className="block space-y-1"><span>Voice sample</span><input name="sample" type="file" required accept="audio/*" onChange={e => setUpload(e.target.files?.[0] ?? null)} className="block w-full" />
      <span className="block text-xs text-muted-foreground">One clean recording of a single speaker. {SAMPLE_POLICY[provider].basis} MP3 or WAV works. The sample goes to the provider and is not kept by Studio.</span></label>
      {uploadVerdict ? <p role={uploadVerdict.level === "error" ? "alert" : "status"} className={uploadVerdict.level === "error" ? "text-destructive" : "text-muted-foreground"}>{uploadVerdict.message}</p> : null}</div>}
    <label className="flex items-start gap-2"><input type="checkbox" name="cleanAudio" className="mt-1 size-4" /><span>Clean up background noise (use only if the room was noisy; it can soften the voice).</span></label>
    <label className="flex items-start gap-2"><input type="checkbox" name="attested" required className="mt-1 size-4" /><span>{CLONE_CONSENT_STATEMENT}</span></label>
    <button type="submit" disabled={busy} className={button}>{busy ? "Creating…" : "Create voice"}</button>
    <Say s={state} />
  </form>;
}

const emptyDesign: DesignFields = { gender: "", age: "", accent: "", tone: "", pace: "", notes: "", previewText: "" };
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
      <label className="space-y-1 sm:col-span-2"><span>Preview line (optional)</span><textarea value={fields.previewText ?? ""} onChange={set("previewText")} rows={3} maxLength={1000} placeholder="Paste a few sentences of your own script so the candidates read it. 100 to 1,000 characters; leave empty and the provider writes one." className={field} />
        {fields.previewText && fields.previewText.trim().length < PREVIEW_TEXT_MIN ? <span className="block text-xs text-muted-foreground">{fields.previewText.trim().length} / {PREVIEW_TEXT_MIN} characters minimum.</span> : null}</label>
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
