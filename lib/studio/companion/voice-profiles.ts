import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkSampleLength, wavSeconds } from "../voices/clone-sample";

export interface VoiceReference { id: string; audioUrl: string; textUrl: string }
export const voicesRoot = (home = homedir()) => join(home, "Library", "Application Support", "Estio", "StudioCompanion", "voices");
const MAX_WAV = 12 * 1024 * 1024, MAX_JSON = 8 * 1024;

async function fetchBounded(url: string, max: number, fetcher: typeof fetch, signal?: AbortSignal): Promise<Uint8Array> {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("voice_reference_refused");
  const response = await fetcher(target, { redirect: "error", signal });
  if (!response.ok) throw new Error("voice_reference_unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > max) throw new Error("voice_reference_size");
  return bytes;
}
/** The profile of an on-device clone lives only on this Mac: ~/Library/Application Support/Estio/StudioCompanion/voices/<voice id>/{reference.wav,reference.txt}.
 *  It is fetched once from the short-lived links the server mints at claim time, checked, and reused for every later job. */
export async function ensureVoiceReference(ref: VoiceReference, opts: { root?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<{ audio: string; text: string }> {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(ref.id)) throw new Error("voice_reference_id");
  const dir = join(opts.root ?? voicesRoot(), ref.id), audio = join(dir, "reference.wav"), text = join(dir, "reference.txt");
  try { if ((await stat(audio)).size > 0 && (await stat(text)).size > 0) return { audio, text: (await readFile(text, "utf8")).trim() }; } catch { /* first use on this Mac */ }
  const fetcher = opts.fetcher ?? fetch;
  const [wav, meta] = await Promise.all([fetchBounded(ref.audioUrl, MAX_WAV, fetcher, opts.signal), fetchBounded(ref.textUrl, MAX_JSON, fetcher, opts.signal)]);
  const seconds = wavSeconds(wav);
  if (seconds === null || checkSampleLength("local", seconds).level === "error") throw new Error("voice_reference_invalid");
  const spoken = (JSON.parse(new TextDecoder().decode(meta)) as { text?: unknown }).text;
  if (typeof spoken !== "string" || spoken.trim().length < 20 || spoken.length > 1500) throw new Error("voice_reference_text");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmpA = `${audio}.part`, tmpT = `${text}.part`;
  await writeFile(tmpA, wav, { mode: 0o600 }); await writeFile(tmpT, spoken.trim(), { mode: 0o600 });
  await rename(tmpA, audio); await rename(tmpT, text);
  return { audio, text: spoken.trim() };
}
export async function forgetVoiceReference(id: string, root = voicesRoot()) { if (/^[0-9a-f-]{36}$/.test(id)) await rm(join(root, id), { recursive: true, force: true }); }
