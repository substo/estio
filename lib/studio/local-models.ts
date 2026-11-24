/**
 * Reviewed catalog of models a paired Mac may install and run itself (Settings -> Connected computer -> Local models).
 * Shared by the server (validation, UI) and the companion (detection, install). Everything here is fixed code: the server only
 * ever names catalog ids, never repos, commands or paths. Bump MODEL_CATALOG_VERSION when an entry's repo/revision changes.
 */
export const MODEL_CATALOG_VERSION = 1;
export type ModelTask = "voice" | "transcription" | "music" | "effects";
export type ModelRuntime = "mlx-audio" | "parakeet-mlx";
export interface CatalogModel {
  id: string; task: ModelTask; title: string; summary: string;
  /** Hugging Face repo and the exact revision that was tested. */
  repo: string; revision: string;
  sizeGb: number; minMemoryGb: number; minFreeDiskGb: number;
  languages: readonly string[]; licence: string; runtime: ModelRuntime;
  /** Files that must exist (after resolving cache links) and be at least this large for the model to count as installed. */
  files: readonly { path: string; minBytes: number }[];
  /** Built-in speakers, for voice models that ship named voices. */
  voices?: readonly string[]; defaultVoice?: string;
  /** Zero-shot voice cloning from a short reference clip and its transcript (no built-in speakers). */
  cloning?: boolean;
  /** Terms the person installing must accept first (shown with a checkbox; the model is never installed without it). */
  terms?: readonly { label: string; url: string }[];
}
export const MODEL_CATALOG: readonly CatalogModel[] = Object.freeze([
  { id: "qwen3-tts-0.6b-4bit", task: "voice", title: "Qwen3-TTS 0.6B (4-bit)", summary: "On-device narration with built-in speakers. Slower than a hosted voice, free to run, nothing leaves the Mac.",
    repo: "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit", revision: "08c72cad5e2fd0f41730c8bd1f28149585e46361",
    sizeGb: 1.0, minMemoryGb: 8, minFreeDiskGb: 6, languages: ["en", "zh", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"], licence: "Apache-2.0", runtime: "mlx-audio",
    files: [{ path: "model.safetensors", minBytes: 500_000_000 }, { path: "config.json", minBytes: 100 }],
    voices: ["serena", "vivian", "uncle_fu", "ryan", "aiden", "ono_anna", "sohee", "eric", "dylan"], defaultVoice: "ryan" },
  { id: "qwen3-tts-0.6b-base-4bit", task: "voice", title: "Qwen3-TTS 0.6B Base (voice cloning)", summary: "Clone a voice on this Mac from a short recording. The recording stays on your Mac; nothing is sent to a voice provider.",
    repo: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit", revision: "0d6bb6fe33f92d47a507e23b9148940e8366ab5b",
    sizeGb: 1.7, minMemoryGb: 8, minFreeDiskGb: 6, languages: ["en", "zh", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"], licence: "Apache-2.0", runtime: "mlx-audio",
    files: [{ path: "model.safetensors", minBytes: 900_000_000 }, { path: "config.json", minBytes: 100 }, { path: "speech_tokenizer/model.safetensors", minBytes: 600_000_000 }], cloning: true },
  { id: "parakeet-tdt-0.6b-v3", task: "transcription", title: "Parakeet TDT 0.6B v3", summary: "On-device speech-to-text for video transcription (25 European languages).",
    repo: "mlx-community/parakeet-tdt-0.6b-v3", revision: "ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15",
    sizeGb: 2.5, minMemoryGb: 8, minFreeDiskGb: 8, languages: ["en", "de", "fr", "es", "it", "pt", "nl", "pl", "ru", "uk", "cs", "el", "bg", "hr", "da", "et", "fi", "hu", "lv", "lt", "mt", "ro", "sk", "sl", "sv"], licence: "CC-BY-4.0", runtime: "parakeet-mlx",
    files: [{ path: "model.safetensors", minBytes: 1_000_000_000 }, { path: "config.json", minBytes: 100 }] },
  { id: "stable-audio-3-small-music", task: "music", title: "Stable Audio 3 Small: music", summary: "Instrumental music beds made on this Mac (up to about 2 minutes, stereo). Free to run, nothing leaves the Mac. Slow and tight on 8 GB: close other apps while it runs.",
    repo: "mlx-community/stable-audio-3-small-music", revision: "48bf34ca57d6f5a2e37282602066210dc6ff3eac",
    sizeGb: 3.5, minMemoryGb: 8, minFreeDiskGb: 10, languages: ["en"], licence: "Stability AI Community Licence + Gemma Terms of Use", runtime: "mlx-audio",
    files: [{ path: "model.safetensors", minBytes: 2_000_000_000 }, { path: "config.json", minBytes: 100 }, { path: "t5gemma-b-b-ul2/model.safetensors", minBytes: 1_000_000_000 }],
    terms: [{ label: "Stability AI Community License", url: "https://stability.ai/community-license-agreement" }, { label: "Gemma Terms of Use", url: "https://ai.google.dev/gemma/terms" }] },
  { id: "stable-audio-3-small-sfx", task: "effects", title: "Stable Audio 3 Small: sound effects", summary: "Short sound effects (whooshes, hits, ambience) made on this Mac. Free to run, nothing leaves the Mac. Same size and terms as the music model.",
    repo: "mlx-community/stable-audio-3-small-sfx", revision: "ca6c38718d27cd2b446a4661c8851f1f3d0a3870",
    sizeGb: 3.5, minMemoryGb: 8, minFreeDiskGb: 10, languages: ["en"], licence: "Stability AI Community Licence + Gemma Terms of Use", runtime: "mlx-audio",
    files: [{ path: "model.safetensors", minBytes: 2_000_000_000 }, { path: "config.json", minBytes: 100 }, { path: "t5gemma-b-b-ul2/model.safetensors", minBytes: 1_000_000_000 }],
    terms: [{ label: "Stability AI Community License", url: "https://stability.ai/community-license-agreement" }, { label: "Gemma Terms of Use", url: "https://ai.google.dev/gemma/terms" }] },
] satisfies CatalogModel[]);
export const catalogIds = MODEL_CATALOG.map(m => m.id);
export const catalogModel = (id: unknown): CatalogModel | undefined => MODEL_CATALOG.find(m => m.id === id);
export const modelTaskLabel: Record<ModelTask, string> = { voice: "Voices (narration)", transcription: "Transcription", music: "Music", effects: "Sound effects" };
/** Hugging Face cache folder name for a repo, e.g. models--mlx-community--parakeet-tdt-0.6b-v3. */
export const hubFolder = (repo: string) => `models--${repo.replace("/", "--")}`;

export type ModelFitLevel = "ok" | "tight" | "no";
export interface ModelFit { level: ModelFitLevel; reason: string }
export interface FitHardware { memoryGb?: number; freeDiskGb?: number }
/** Can this Mac hold and run the model? "tight" = runs but expect swapping or little headroom; "no" = refuse to install. */
export function modelFit(model: CatalogModel, hw: FitHardware, installed = false): ModelFit {
  const mem = hw.memoryGb, free = hw.freeDiskGb;
  if (!installed && free !== undefined && free < model.minFreeDiskGb) return { level: "no", reason: `Needs ${model.minFreeDiskGb} GB free disk; this Mac has ${free} GB.` };
  if (mem !== undefined && mem < model.minMemoryGb) return { level: "no", reason: `Needs ${model.minMemoryGb} GB of memory; this Mac has ${mem} GB.` };
  if (mem !== undefined && mem <= model.minMemoryGb) return { level: "tight", reason: `Runs on ${mem} GB but with little headroom: close other apps, expect slower generation.` };
  if (!installed && free !== undefined && free < model.minFreeDiskGb * 2) return { level: "tight", reason: `Only ${free} GB of disk free; this leaves little room for builds.` };
  return { level: "ok", reason: "Fits this Mac." };
}
/** Best model per requested task that fits this Mac (never recommends one that cannot run, or one with terms the person has not accepted). */
export function recommendedModels(hw: FitHardware, tasks: readonly ModelTask[]): string[] {
  const out: string[] = [];
  for (const task of tasks) {
    const pick = MODEL_CATALOG.filter(m => m.task === task && !m.terms && modelFit(m, hw).level !== "no").sort((a, b) => a.sizeGb - b.sizeGb)[0];
    if (pick) out.push(pick.id);
  }
  return out;
}

export type ModelState = "absent" | "installing" | "installed" | "error";
export interface ReportedModel { id: string; state: ModelState; /** managed = installed by this app and removable here; found = already on the Mac. */ source?: "managed" | "found"; progress?: number; error?: string }
const stateNames: readonly string[] = ["absent", "installing", "installed", "error"];
/** Whitelist what a Mac reports (the heartbeat is untrusted input). */
export function readReportedModels(value: unknown): ReportedModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(); const out: ReportedModel[] = [];
  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !catalogIds.includes(r.id) || seen.has(r.id) || typeof r.state !== "string" || !stateNames.includes(r.state)) continue;
    seen.add(r.id);
    out.push({ id: r.id, state: r.state as ModelState,
      ...(r.source === "managed" || r.source === "found" ? { source: r.source } : {}),
      ...(typeof r.progress === "number" && Number.isFinite(r.progress) ? { progress: Math.max(0, Math.min(100, Math.round(r.progress))) } : {}),
      ...(typeof r.error === "string" && /^[A-Za-z0-9 .,:'()/_-]{1,160}$/.test(r.error) ? { error: r.error } : {}) });
  }
  return out;
}
/** Validate the desired list from Settings: catalog ids only, no duplicates. Returns null when invalid. */
export function readDesiredModels(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const out: string[] = [];
  for (const id of value) { if (typeof id !== "string" || !catalogIds.includes(id) || out.includes(id)) return null; out.push(id); }
  return out;
}
