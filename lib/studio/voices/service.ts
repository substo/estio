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
import { cloneProviderVoice, deleteProviderVoice, listProviderVoices, synthesizeHosted, VoiceProviderError } from "./clients";
import { requireVoiceManager, resolveVoiceKey, VoiceSettingsError } from "./keys";
import { CLONE_CONSENT_STATEMENT, LOCAL_SPEAKERS, isHostedProvider, providerLabels, type CloneInput, type HostedVoiceProvider, type VoiceRow } from "./policy";

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
  await call("studio_sync_voices", access, { p_provider: "local", p_voices: LOCAL_SPEAKERS.map(s => ({ providerVoiceId: s, name: s.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()), kind: "preset" })), p_prune: true });
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
  try { providerVoiceId = await cloneProviderVoice(input.provider, key, { name: input.name, sample: new Blob([bytes], { type: sample.type }), filename: sample.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "sample.mp3", language: input.language }); }
  catch (error) { throw new VoiceSettingsError(providerMessage(error) ?? "Could not clone the voice. Try again."); }
  try {
    return await call<{ id: string }>("studio_record_voice_clone", access, { p_provider: input.provider, p_provider_voice_id: providerVoiceId, p_name: input.name, p_language: input.language, p_persona: input.persona,
      p_statement: CLONE_CONSENT_STATEMENT, p_sample_sha256: sha });
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
  const removed = await call<{ provider: string; providerVoiceId: string; removeAtProvider: boolean }>("studio_delete_voice", access, { p_voice_id: voiceId });
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

export interface Narration { uploadIds: string[]; beats: number; characters: number }
/** Hosted narration for a content piece: one MP3 per script paragraph, generated here with the Location's key, saved as private media. The Mac only downloads the files. */
export async function renderNarration(locationId: string, recordId: string, voice: VoiceRow, script: string, deps: { synth?: typeof synthesizeHosted; access?: { locationId: string; app: "estio" | "substo"; userId: string }; onBeat?: (done: number, total: number) => Promise<void> | void } = {}): Promise<Narration> {
  // A caller that already proved the requester (the click that started a background render) passes the access along: no request context exists later.
  const access = deps.access ?? await requireVoiceManager(locationId);
  if (!isHostedProvider(voice.provider)) throw new VoiceSettingsError("This voice is generated on the Mac.");
  const beats = parseScript(script);
  if (!beats.length) throw new VoiceSettingsError("The script has no spoken paragraphs.");
  const long = beats.find(b => b.narration.length > 4500);
  if (long) throw new VoiceSettingsError(`Paragraph ${long.index} is longer than 4,500 characters. Split it and try again.`);
  const key = await needKey(access.locationId, voice.provider);
  const config = readStudioR2Config();
  if (!config) throw new StudioCommandError("Media storage is not configured.", 503);
  const store = createStudioR2Store(config), synth = deps.synth ?? synthesizeHosted;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
  const dir = await mkdtemp(join(tmpdir(), "studio-narration-"));
  const uploadIds: string[] = [];
  try {
    for (const beat of beats) {
      let audio: Buffer;
      try { audio = await synth(voice.provider, key, voice.providerVoiceId, beat.narration); }
      catch (error) { throw new VoiceSettingsError(providerMessage(error) ?? "The voice provider could not generate the narration."); }
      const id = randomUUID(), file = join(dir, `${id}.mp3`);
      await writeFile(file, audio, { mode: 0o600 });
      await store.uploadCreateOnly({ key: `${access.locationId}/uploads/${id}/original`, filePath: file, byteSize: audio.length, contentType: "audio/mpeg" });
      await call("studio_save_narration", access, { p_record_id: recordId, p_upload_id: id, p_filename: `Narration ${stamp} ${String(beat.index).padStart(2, "0")}.mp3`,
        p_byte_size: audio.length, p_sha256: createHash("sha256").update(audio).digest("hex"), p_bucket: store.bucket });
      uploadIds.push(id);
      await deps.onBeat?.(uploadIds.length, beats.length);
    }
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  return { uploadIds, beats: beats.length, characters: beats.reduce((n, b) => n + b.narration.length, 0) };
}
export { StudioDbError };
