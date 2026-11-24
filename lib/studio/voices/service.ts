import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStudioAccess } from "../access";
import { StudioCommandError } from "../command-error";
import { StudioDbError } from "../db";
import { createStudioR2Store, readStudioR2Config } from "../media-r2";
import { studioDb } from "../studio-db";
import { parseScript } from "../video-assembly/script";
import { cloneProviderVoice, deleteProviderVoice, designProviderVoice, listProviderVoices, saveDesignedVoice as saveDesignedAtProvider, synthesizeHosted, VoiceProviderError, type DesignPreview } from "./clients";
import { getStudioDevices } from "../devices";
import { readReportedModels } from "../local-models";
import { Prisma } from "@prisma/client";
import { LOCAL_SPEAKER_CATALOG, PREVIEW_TEXT_MAX, PREVIEW_TEXT_MIN, buildDesignPrompt, consentSpeech, designError, normalizeTag, type Availability, type DesignFields, type LocalState } from "./library";
import { getVoiceKeySummary, requireVoiceManager, resolveVoiceKey, VoiceSettingsError } from "./keys";
import { resolveFalKey } from "./sound-keys";
import { generateHostedSound, soundErrorMessage } from "./sound-render";
import type { HostedSoundProvider } from "./sound-providers";
import { CLONE_CONSENT_STATEMENT, LOCAL_SPEAKERS, isHostedProvider, providerLabels, type CloneInput, type HostedVoiceProvider, type LocalCloneInput, type VoiceRow } from "./policy";

const call = <T>(fn: string, access: { locationId: string; app: "estio" | "substo"; userId: string }, args: Record<string, unknown> = {}) =>
  studioDb.call<T>(fn, { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, ...args });
const providerMessage = (error: unknown) => error instanceof VoiceProviderError ? error.message : null;
const needKey = async (locationId: string, provider: HostedVoiceProvider) => {
  const key = await resolveVoiceKey(locationId, provider);
  if (!key) throw new VoiceSettingsError(`Add your ${providerLabels[provider]} key in AI settings first.`);
  return key;
};

export async function listVoices(locationId: string): Promise<VoiceRow[]> {
  const access = await getStudioAccess(locationId);
  if (!access) return [];
  return call<VoiceRow[]>("studio_list_voices", access);
}

/** Local speakers are built in: no key, no cost. Idempotent. */
export async function ensureLocalVoices(locationId: string) {
  const access = await requireVoiceManager(locationId);
  await call("studio_sync_voices", access, { p_provider: "local", p_voices: LOCAL_SPEAKERS.map(s => ({ providerVoiceId: s, name: s.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()), kind: "preset", language: LOCAL_SPEAKER_CATALOG[s].language, description: LOCAL_SPEAKER_CATALOG[s].description, tags: LOCAL_SPEAKER_CATALOG[s].tags })), p_prune: true });
}

/** Mirror the voices in the Location's own provider account. */
export async function refreshProviderVoices(locationId: string, provider: HostedVoiceProvider): Promise<number> {
  const access = await requireVoiceManager(locationId);
  const key = await needKey(access.locationId, provider);
  try {
    const voices = await listProviderVoices(provider, key);
    return await call<number>("studio_sync_voices", access, { p_provider: provider, p_voices: voices, p_prune: true });
  } catch (error) { throw new VoiceSettingsError(providerMessage(error) ?? "Could not refresh voices. Try again."); }
}

/** Clone from one sample the person confirmed they may use. The sample goes to the provider and is not kept; only its digest and the attestation are. */
export async function cloneVoice(locationId: string, input: CloneInput, sample: File): Promise<{ id: string }> {
  const access = await requireVoiceManager(locationId);
  if (!input.attested) throw new VoiceSettingsError("Confirm you have the right to clone this voice.");
  const key = await needKey(access.locationId, input.provider);
  const bytes = Buffer.from(await sample.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  let providerVoiceId: string;
  try { providerVoiceId = await cloneProviderVoice(input.provider, key, { name: input.name, sample: new Blob([bytes], { type: sample.type }), filename: sample.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "sample.mp3", language: input.language, transcript: input.transcript, description: input.description, cleanAudio: input.cleanAudio }); }
  catch (error) { throw new VoiceSettingsError(providerMessage(error) ?? "Could not clone the voice. Try again."); }
  try {
    return await call<{ id: string }>("studio_record_voice_clone", access, { p_provider: input.provider, p_provider_voice_id: providerVoiceId, p_name: input.name, p_language: input.language, p_persona: input.persona,
      p_statement: input.consentRecorded ? `${CLONE_CONSENT_STATEMENT} Recorded consent: "${consentSpeech(input.name)}"`.slice(0, 400) : CLONE_CONSENT_STATEMENT, p_sample_sha256: sha });
  } catch (error) {
    await deleteProviderVoice(input.provider, key, providerVoiceId).catch(() => {});   // never leave an unrecorded clone behind
    throw error;
  }
}

export async function setDefaultVoice(locationId: string, voiceId: string) {
  const access = await requireVoiceManager(locationId);
  await call("studio_set_default_voice", access, { p_voice_id: voiceId });
}

/** Removes the voice here; a clone made through Studio is also deleted at the provider. A voice that was already in the provider account is only unlinked. */
export async function deleteVoice(locationId: string, voiceId: string): Promise<{ providerCleanup: "done" | "failed" | "not_needed" }> {
  const access = await requireVoiceManager(locationId);
  const removed = await call<{ provider: string; providerVoiceId: string; removeAtProvider: boolean; removeReference?: boolean }>("studio_delete_voice", access, { p_voice_id: voiceId });
  if (removed.removeReference) { await removeVoiceReference(access.locationId, voiceId).catch(() => {}); return { providerCleanup: "not_needed" }; }
  if (!removed.removeAtProvider || !isHostedProvider(removed.provider)) return { providerCleanup: "not_needed" };
  const key = await resolveVoiceKey(access.locationId, removed.provider);
  if (!key) return { providerCleanup: "failed" };
  try { await deleteProviderVoice(removed.provider, key, removed.providerVoiceId); return { providerCleanup: "done" }; } catch { return { providerCleanup: "failed" }; }
}

/** A short audition. Hosted voices only; the provider bills the Location's own account. */
export async function previewVoice(locationId: string, voiceId: string): Promise<Buffer> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  const voice = (await listVoices(access.locationId)).find(v => v.id === voiceId);
  if (!voice || !isHostedProvider(voice.provider)) throw new StudioCommandError("Preview is available for hosted voices.", 400);
  const key = await needKey(access.locationId, voice.provider);
  try { return await synthesizeHosted(voice.provider, key, voice.providerVoiceId, "Hello, this is how I will sound in your videos."); }
  catch (error) { throw new StudioCommandError(providerMessage(error) ?? "Could not preview this voice.", 502); }
}

export interface Narration { uploadIds: string[]; beats: number; characters: number; rendered: { beat: number; uploadId: string }[] }
type NarrationAccess = { locationId: string; app: "estio" | "substo"; userId: string };
/** One narration clip: synthesize with the Location's key, store it as private media, record it against the piece. Shared by whole-script and per-block rendering. */
async function renderClip(ctx: { access: NarrationAccess; recordId: string; voice: VoiceRow; key: string; store: ReturnType<typeof createStudioR2Store>; synth: typeof synthesizeHosted; dir: string }, text: string, filename: string): Promise<string> {
  let audio: Buffer;
  try { audio = await ctx.synth(ctx.voice.provider as HostedVoiceProvider, ctx.key, ctx.voice.providerVoiceId, text); }
  catch (error) { throw new VoiceSettingsError(providerMessage(error) ?? "The voice provider could not generate the narration."); }
  const id = randomUUID(), file = join(ctx.dir, `${id}.mp3`);
  await writeFile(file, audio, { mode: 0o600 });
  await ctx.store.uploadCreateOnly({ key: `${ctx.access.locationId}/uploads/${id}/original`, filePath: file, byteSize: audio.length, contentType: "audio/mpeg" });
  await call("studio_save_narration", ctx.access, { p_record_id: ctx.recordId, p_upload_id: id, p_filename: filename,
    p_byte_size: audio.length, p_sha256: createHash("sha256").update(audio).digest("hex"), p_bucket: ctx.store.bucket });
  return id;
}
async function withClipContext<T>(locationId: string, recordId: string, voice: VoiceRow, supplied: NarrationAccess | undefined, synthOverride: typeof synthesizeHosted | undefined, work: (ctx: Parameters<typeof renderClip>[0]) => Promise<T>): Promise<T> {
  // A caller that already proved the requester (the click that started a background render) passes the access along: no request context exists later.
  const access = supplied ?? await requireVoiceManager(locationId);
  if (!isHostedProvider(voice.provider)) throw new VoiceSettingsError("This voice is generated on the Mac.");
  const key = await needKey(access.locationId, voice.provider);
  const config = readStudioR2Config();
  if (!config) throw new StudioCommandError("Media storage is not configured.", 503);
  const dir = await mkdtemp(join(tmpdir(), "studio-narration-"));
  try { return await work({ access, recordId, voice, key, store: createStudioR2Store(config), synth: synthOverride ?? synthesizeHosted, dir }); }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const stampNow = () => new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");

/** Hosted narration for a content piece: one MP3 per script paragraph, generated here with the Location's key, saved as private media. The Mac only downloads the files.
 * `reuse` maps a 1-based beat number to an existing, still-fresh clip so only changed paragraphs are rendered (and paid for). */
export async function renderNarration(locationId: string, recordId: string, voice: VoiceRow, script: string, deps: { synth?: typeof synthesizeHosted; access?: NarrationAccess; onBeat?: (done: number, total: number) => Promise<void> | void; reuse?: ReadonlyMap<number, string> } = {}): Promise<Narration> {
  const beats = parseScript(script);
  if (!beats.length) throw new VoiceSettingsError("The script has no spoken paragraphs.");
  const long = beats.find(b => b.narration.length > 4500);
  if (long) throw new VoiceSettingsError(`Paragraph ${long.index} is longer than 4,500 characters. Split it and try again.`);
  const stamp = stampNow();
  return withClipContext(locationId, recordId, voice, deps.access, deps.synth, async ctx => {
    const uploadIds: string[] = [], rendered: Narration["rendered"] = [];
    for (const beat of beats) {
      const existing = deps.reuse?.get(beat.index);
      if (existing) uploadIds.push(existing);
      else { const id = await renderClip(ctx, beat.narration, `Narration ${stamp} ${String(beat.index).padStart(2, "0")}.mp3`); uploadIds.push(id); rendered.push({ beat: beat.index, uploadId: id }); }
      await deps.onBeat?.(uploadIds.length, beats.length);
    }
    return { uploadIds, rendered, beats: beats.length, characters: beats.reduce((n, b) => n + b.narration.length, 0) };
  });
}

/** One block's audio (the editor's Regenerate audio). Hosted voices only: a Mac voice is generated when the video is made. */
export async function renderBlockNarration(locationId: string, recordId: string, voice: VoiceRow, text: string, label: string): Promise<string> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) throw new VoiceSettingsError("This block has no text to voice.");
  if (clean.length > 4500) throw new VoiceSettingsError("This block is longer than 4,500 characters. Split it and try again.");
  return withClipContext(locationId, recordId, voice, undefined, undefined, ctx => renderClip(ctx, clean, `Narration ${stampNow()} ${label.replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 40) || "block"}.mp3`));
}

const LOCAL_MODEL_ID = "qwen3-tts-0.6b-4bit", CLONE_MODEL_ID = "qwen3-tts-0.6b-base-4bit";
/** What can run right now: which provider keys exist and whether an online Mac has the on-device voice model. */
export async function getVoiceAvailability(locationId: string): Promise<Availability> {
  const [keys, devices] = await Promise.all([getVoiceKeySummary(locationId).catch(() => null), getStudioDevices(locationId).catch(() => null)]);
  const online = devices?.devices.filter(d => d.online && !d.paused && d.status !== "revoked") ?? [];
  const local: LocalState = !online.length ? "mac_offline"
    : online.some(d => readReportedModels(d.capabilities.modelStates).some(m => m.id === LOCAL_MODEL_ID && m.state === "installed")) ? "ready" : "not_installed";
  const localClone = online.some(d => readReportedModels(d.capabilities.modelStates).some(m => m.id === CLONE_MODEL_ID && m.state === "installed"));
  return { fish: Boolean(keys?.keys.fish), elevenlabs: Boolean(keys?.keys.elevenlabs), local, localClone };
}

/** Whether an online Mac has the Stable Audio 3 Small models installed (music and sound effects each have their own). */
export async function getSoundModelState(locationId: string): Promise<{ music: boolean; effects: boolean }> {
  const devices = await getStudioDevices(locationId).catch(() => null);
  const installed = new Set((devices?.devices.filter(d => d.online && !d.paused && d.status !== "revoked") ?? []).flatMap(d => readReportedModels(d.capabilities.modelStates).filter(m => m.state === "installed").map(m => m.id)));
  return { music: installed.has("stable-audio-3-small-music"), effects: installed.has("stable-audio-3-small-sfx") };
}
const GENDER_TAG: Record<string, string> = { woman: "female", female: "female", man: "male", male: "male" };
/** Tags a designed voice carries so it filters like any other voice. */
export function designTags(f: DesignFields): string[] {
  const g = GENDER_TAG[f.gender.trim().toLowerCase()];
  return [g ? normalizeTag("gender", g) : null, normalizeTag("age", f.age), normalizeTag("tone", f.tone.split(/[ ,]+/)[0]), normalizeTag("accent", f.accent)].filter((t): t is string => !!t);
}
/** Voice Design (ElevenLabs): up to three candidate voices from a description. Nothing is saved yet; the provider bills the Location's account. */
export async function designVoicePreviews(locationId: string, fields: DesignFields): Promise<{ prompt: string; previews: DesignPreview[] }> {
  const access = await requireVoiceManager(locationId);
  const prompt = buildDesignPrompt(fields);
  const bad = designError(prompt); if (bad) throw new VoiceSettingsError(bad);
  const text = fields.previewText?.trim();
  if (text && (text.length < PREVIEW_TEXT_MIN || text.length > PREVIEW_TEXT_MAX)) throw new VoiceSettingsError(`The preview text must be ${PREVIEW_TEXT_MIN} to ${PREVIEW_TEXT_MAX} characters, or leave it empty.`);
  const key = await needKey(access.locationId, "elevenlabs");
  try { return { prompt, previews: await designProviderVoice(key, prompt, fetch, fields.previewText?.trim() || undefined) }; }
  catch (error) { throw new VoiceSettingsError(providerMessage(error) ?? "Could not design the voice. Try again."); }
}
export async function saveDesignedVoice(locationId: string, input: { name: string; fields: DesignFields; generatedVoiceId: string; persona?: string | null }): Promise<{ id: string }> {
  const access = await requireVoiceManager(locationId);
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw new VoiceSettingsError("Give the voice a name of up to 80 characters.");
  const prompt = buildDesignPrompt(input.fields);
  const key = await needKey(access.locationId, "elevenlabs");
  let providerVoiceId: string;
  try { providerVoiceId = await saveDesignedAtProvider(key, { name, description: prompt, generatedVoiceId: input.generatedVoiceId }); }
  catch (error) { throw new VoiceSettingsError(providerMessage(error) ?? "Could not save the voice. Try again."); }
  try {
    return await call<{ id: string }>("studio_record_designed_voice", access, { p_provider: "elevenlabs", p_provider_voice_id: providerVoiceId, p_name: name, p_description: prompt.slice(0, 300), p_tags: designTags(input.fields), p_language: null, p_persona: input.persona?.trim() || null });
  } catch (error) { await deleteProviderVoice("elevenlabs", key, providerVoiceId).catch(() => {}); throw error; }
}

/** Queue a preview of a built-in speaker on the account's own Mac. The Voices page polls the job. */
export async function requestLocalPreview(locationId: string, voiceId: string): Promise<{ jobId: string }> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  try { return await call<{ jobId: string }>("studio_request_voice_preview", access, { p_voice_id: voiceId }); }
  catch (error) {
    const code = error instanceof StudioDbError ? error.code : undefined;
    const msg = code && previewMessages[code];
    if (msg) throw new StudioCommandError(msg, 409);
    throw error;
  }
}
export const previewMessages: Record<string, string> = {
  VP001: "This voice no longer exists.", VP002: "Only on-device voices are previewed on the Mac.",
  VP011: "Pair a Mac under Settings → Devices to preview on-device voices.", VP012: "Turn processing on for your Mac under Settings → Devices.",
  VP013: "Your Mac is not ready: install the on-device voice model under Settings → Devices and keep the companion running.", VP014: "Update the Mac companion to preview voices.",
};
export type LocalPreviewState = { status: "pending" } | { status: "failed"; message: string } | { status: "done"; audioBase64: string };
export async function readLocalPreview(locationId: string, jobId: string): Promise<LocalPreviewState> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) throw new StudioCommandError("Preview again.", 400);
  const row = (await studioDb.rows<{ status: string; result: { preview?: { audioBase64?: unknown } } | null; last_error_message: string | null }>(Prisma.sql`
    select status, result, last_error_message from studio.studio_jobs where id = ${jobId}::uuid and location_id = ${access.locationId} and kind = 'studio.voice_preview' and created_by_clerk_user_id = ${access.userId} limit 1`))[0];
  if (!row) throw new StudioCommandError("This preview expired. Preview again.", 404);
  if (row.status === "queued" || row.status === "running") return { status: "pending" };
  const audio = row.result?.preview?.audioBase64;
  if (row.status === "succeeded" && typeof audio === "string") return { status: "done", audioBase64: audio };
  return { status: "failed", message: row.last_error_message || "The Mac could not generate the preview." };
}
export { StudioDbError };

/** Where an on-device clone's reference lives in private storage. Derived from the voice id, never from user input. */
export const voiceReferenceKeys = (locationId: string, voiceId: string) => ({ audio: `${locationId}/voice-refs/${voiceId}.wav`, text: `${locationId}/voice-refs/${voiceId}.json` });
async function removeVoiceReference(locationId: string, voiceId: string) {
  const config = readStudioR2Config(); if (!config) return;
  const store = createStudioR2Store(config), keys = voiceReferenceKeys(locationId, voiceId);
  await store.deleteObject(keys.audio); await store.deleteObject(keys.text);
}

/** Clone on this Mac. The recording and its transcript are kept in private storage only so the owner's own Mac can fetch them; nothing goes to a voice provider. */
export async function cloneVoiceOnDevice(locationId: string, input: LocalCloneInput, sample: File, deps: { store?: Pick<ReturnType<typeof createStudioR2Store>, "uploadCreateOnly" | "bucket" | "deleteObject"> } = {}): Promise<{ id: string }> {
  const access = await requireVoiceManager(locationId);
  const bytes = Buffer.from(await sample.arrayBuffer());
  const config = readStudioR2Config();
  const store = deps.store ?? (config ? createStudioR2Store(config) : null);
  if (!store) throw new StudioCommandError("Media storage is not configured.", 503);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const created = await call<{ id: string; providerVoiceId: string }>("studio_record_local_clone", access, { p_name: input.name, p_language: input.language, p_persona: input.persona,
    p_statement: input.consentRecorded ? `${CLONE_CONSENT_STATEMENT} Recorded consent: "${consentSpeech(input.name)}"`.slice(0, 400) : CLONE_CONSENT_STATEMENT, p_sample_sha256: sha });
  const keys = voiceReferenceKeys(access.locationId, created.id), dir = await mkdtemp(join(tmpdir(), "studio-voice-ref-"));
  try {
    const wav = join(dir, "reference.wav"), meta = join(dir, "reference.json"), text = Buffer.from(JSON.stringify({ text: input.transcript }));
    await writeFile(wav, bytes, { mode: 0o600 }); await writeFile(meta, text, { mode: 0o600 });
    await store.uploadCreateOnly({ key: keys.audio, filePath: wav, byteSize: bytes.length, contentType: "audio/wav" });
    await store.uploadCreateOnly({ key: keys.text, filePath: meta, byteSize: text.length, contentType: "application/json" });
    return { id: created.id };
  } catch (error) {
    // Never leave a voice that cannot be used: remove the row and any stored half.
    await call("studio_delete_voice", access, { p_voice_id: created.id }).catch(() => {});
    await store.deleteObject(keys.audio).catch(() => {}); await store.deleteObject(keys.text).catch(() => {});
    throw error instanceof VoiceSettingsError ? error : new VoiceSettingsError("The recording could not be stored. Try again.");
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// ---- Music bed and sound effect for Make video ------------------------------------------------------------------------------------------
// The editor's own asset generator needs a provider key on the Mac. Keys live in the product, so the server makes the two files with the Location's
// ElevenLabs key and the Mac downloads them like narration. They are stored as "Narration sound-..." uploads, which the Mac job never treats as footage.
export const SOUND_NAME = /^Narration sound-(music|sfx) (?:(\d{2,3})s )?\d{4}-\d{2}-\d{2} \d{4}\.mp3$/;
const SOUND_REUSE_HOURS = 48;
/** Rough spoken length of a script, so the music bed covers the video. */
export function estimateVideoSeconds(script: string): number {
  const words = parseScript(script).reduce((n, b) => n + b.narration.split(/\s+/).filter(Boolean).length, 0);
  return Math.min(180, Math.max(30, Math.ceil(words / 2.5) + 6));
}
export interface VideoSounds { music: string | null; sfx: string | null; skipped: string | null }
export async function renderVideoSounds(access: NarrationAccess, recordId: string, want: { music: HostedSoundProvider | null; sfx: HostedSoundProvider | null; seconds: number }, deps: { generate?: typeof generateHostedSound; key?: (provider: HostedSoundProvider) => Promise<string | null> } = {}): Promise<VideoSounds> {
  const out: VideoSounds = { music: null, sfx: null, skipped: null };
  if (!want.music && !want.sfx) return out;
  const keyFor = deps.key ?? (async (provider: HostedSoundProvider) => provider === "fal" ? resolveFalKey(access.locationId) : resolveVoiceKey(access.locationId, "elevenlabs"));
  const generate = deps.generate ?? generateHostedSound;
  const config = readStudioR2Config();
  if (!config) throw new StudioCommandError("Media storage is not configured.", 503);
  const store = createStudioR2Store(config), dir = await mkdtemp(join(tmpdir(), "studio-sound-"));
  const recent = await studioDb.rows<{ id: string; original_filename: string }>(Prisma.sql`select id, original_filename from studio.studio_uploads
    where location_id = ${access.locationId} and record_id = ${recordId}::uuid and status = 'uploaded' and original_filename like 'Narration sound-%' and created_at > now() - make_interval(hours => ${Prisma.raw(String(Math.trunc(SOUND_REUSE_HOURS)))}) order by created_at desc`);
  const reuse = (role: "music" | "sfx", minSeconds: number) => recent.find(r => { const m = SOUND_NAME.exec(r.original_filename); return m?.[1] === role && (role === "sfx" || Number(m[2] ?? 0) >= minSeconds); })?.id ?? null;
  const save = async (role: "music" | "sfx", audio: Buffer, seconds: number) => {
    const id = randomUUID(), file = join(dir, `${id}.mp3`);
    await writeFile(file, audio, { mode: 0o600 });
    await store.uploadCreateOnly({ key: `${access.locationId}/uploads/${id}/original`, filePath: file, byteSize: audio.length, contentType: "audio/mpeg" });
    await call("studio_save_narration", access, { p_record_id: recordId, p_upload_id: id, p_filename: `Narration sound-${role} ${role === "music" ? `${Math.round(seconds)}s ` : ""}${stampNow()}.mp3`,
      p_byte_size: audio.length, p_sha256: createHash("sha256").update(audio).digest("hex"), p_bucket: store.bucket });
    return id;
  };
  /** Each kind is tried on its own, so one that fails (a plan limit, a bad key) does not stop the other; the page gets the provider's own reason. */
  const reasons: string[] = [];
  const one = async (role: "music" | "sfx", provider: HostedSoundProvider | null, seconds: number): Promise<string | null> => {
    if (!provider) return null;
    const reused = reuse(role, seconds);
    if (reused) return reused;
    try {
      const key = await keyFor(provider);
      if (!key) throw new VoiceSettingsError(`Add your ${provider === "fal" ? "fal.ai" : "ElevenLabs"} key in the voice settings first.`);
      return await save(role, await generate(provider, role === "music" ? "music" : "effects", key, seconds), seconds);
    } catch (error) { reasons.push(soundErrorMessage(error) ?? (error instanceof VoiceSettingsError ? error.message : "The provider could not make this sound.")); return null; }
  };
  try {
    if (want.music) out.music = await one("music", want.music, want.seconds);
    if (want.sfx) out.sfx = await one("sfx", want.sfx, 1);
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  if (reasons.length) out.skipped = [...new Set(reasons)].join(" ");
  return out;
}
