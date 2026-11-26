import "server-only";
import { withoutSpeakerCues } from "./script-speakers";
import { StudioCommandError } from "./command-error";
import { getStudioContentRecord, saveStudioContentRecord } from "./content";
import { studioDb } from "./studio-db";
import { audioHash, blockAudioStatus, blocksDoc, blocksToScript, narrationBlocks, reconcileBlocks, setBlockAudio, type BlockAudio, type ScriptBlock } from "./script-blocks";
import { getVoiceAvailability, listVoices, renderBlockNarration } from "./voices/service";
import { voiceStatus } from "./voices/library";
import { isHostedProvider, type VoiceRow } from "./voices/policy";
import { VoiceSettingsError } from "./voices/keys";

/** The voice a piece speaks with: its own override when that voice is still usable, otherwise the Location default. Same rule the editor shows. */
export function pickPieceVoice(voices: readonly VoiceRow[], override: unknown): VoiceRow | null {
  return voices.find(v => v.id === override) ?? voices.find(v => v.isDefault) ?? voices[0] ?? null;
}
export async function usableVoices(locationId: string): Promise<VoiceRow[]> {
  const [all, availability] = await Promise.all([listVoices(locationId).catch(() => [] as VoiceRow[]), getVoiceAvailability(locationId)]);
  return all.filter(v => voiceStatus(v, availability).usable);
}

export type RegenerateResult = { ok: true; version: number; audio: Record<string, BlockAudio>; rendered: number } | { ok: false; error: string; version?: number; audio?: Record<string, BlockAudio> };

/** Render audio for the piece's own saved narration blocks (all stale/missing ones, or just `only`). Saved first, so the text voiced is exactly the text stored; partial progress is kept if a later block fails. */
export async function regenerateBlockAudio(locationId: string, recordId: string, expectedVersion: number, only?: readonly string[]): Promise<RegenerateResult> {
  const found = await getStudioContentRecord(locationId, recordId);
  if (!found) return { ok: false, error: "This piece could not be found." };
  const { record } = found;
  if (record.archived) return { ok: false, error: "This piece is archived." };
  if (record.version !== expectedVersion) return { ok: false, error: "The script is still saving or changed in another tab. Wait a moment and try again.", version: record.version };
  const voice = pickPieceVoice(await usableVoices(locationId), record.payload.voiceId);
  if (!voice) return { ok: false, error: "Choose a voice first (Settings → Voices)." };
  if (!isHostedProvider(voice.provider)) return { ok: false, error: "This voice runs on your Mac. Its audio is made when you make the video." };
  let blocks = reconcileBlocks(record.payload);
  const targets = narrationBlocks(blocks).filter(b => (only ? only.includes(b.id) : true) && blockAudioStatus(b, voice.id) !== "fresh");
  if (!targets.length) return { ok: true, version: record.version, audio: {}, rendered: 0 };
  const audio: Record<string, BlockAudio> = {};
  let failure: string | null = null;
  for (const [index, block] of targets.entries()) {
    try {
      const uploadId = await renderBlockNarration(locationId, recordId, voice, withoutSpeakerCues(block.text).trim(), `${String(index + 1).padStart(2, "0")} ${block.id}`);
      audio[block.id] = { hash: audioHash(voice.id, block.text), uploadId, voiceId: voice.id, at: new Date().toISOString() };
      blocks = setBlockAudio(blocks, block.id, audio[block.id]);
    } catch (error) {
      failure = error instanceof VoiceSettingsError || error instanceof StudioCommandError ? error.message : "The voice provider could not generate this audio. Try again.";
      break;
    }
  }
  if (!Object.keys(audio).length) return { ok: false, error: failure ?? "Nothing was generated." };
  const saved = await saveStudioContentRecord(locationId, recordId, { kind: "content", title: record.title, payload: { title: record.title, scriptBlocks: blocksDoc(blocks), script: blocksToScript(blocks) } }, record.version);
  const version = Number((saved as { version?: unknown }).version ?? record.version + 1);
  return failure ? { ok: false, error: `${failure} The blocks before it were saved.`, version, audio } : { ok: true, version, audio, rendered: Object.keys(audio).length };
}

/** Uploads that really belong to this piece and finished: only these may be reused as narration. */
export async function ownedUploadIds(locationId: string, recordId: string, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await studioDb.rows<{ id: string }>(
    (await import("@prisma/client")).Prisma.sql`select id from studio.studio_uploads where location_id = ${locationId} and record_id = ${recordId}::uuid and status = 'uploaded' and id = any(${ids as string[]}::uuid[])`);
  return new Set(rows.map(r => r.id));
}

/** Make video: beat n is the n-th narration block. Fresh, owned clips are reused; the rest are rendered. Returns the beat -> upload map (empty when blocks and script disagree). */
export async function reusableBeatAudio(locationId: string, recordId: string, payload: Record<string, unknown>, voiceId: string, beatCount: number): Promise<{ reuse: Map<number, string>; blocks: ScriptBlock[] }> {
  const blocks = reconcileBlocks(payload);
  const narr = narrationBlocks(blocks);
  if (narr.length !== beatCount) return { reuse: new Map(), blocks };
  const candidates = narr.flatMap((b, i) => blockAudioStatus(b, voiceId) === "fresh" && b.audio ? [[i + 1, b.audio.uploadId] as const] : []);
  const owned = await ownedUploadIds(locationId, recordId, candidates.map(c => c[1]));
  return { reuse: new Map(candidates.filter(c => owned.has(c[1]))), blocks };
}

/** Best effort after a video render: remember the clips on their blocks so the next video (or the editor) sees them as fresh. Never throws. */
export async function rememberRenderedBlockAudio(actor: { locationId: string; userId: string }, recordId: string, voiceId: string, spokenText: ReadonlyMap<number, string>, rendered: readonly { beat: number; uploadId: string }[]): Promise<void> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await studioDb.one<{ title: string; version: number; payload: Record<string, unknown> }>(
        (await import("@prisma/client")).Prisma.sql`select title, version, payload from studio.studio_records where location_id = ${actor.locationId} and id = ${recordId}::uuid and kind = 'content'`);
      if (!row) return;
      let blocks = reconcileBlocks(row.payload); const narr = narrationBlocks(blocks);
      for (const r of rendered) {
        const block = narr[r.beat - 1], text = spokenText.get(r.beat);
        if (block && text !== undefined && audioHash(voiceId, block.text) === audioHash(voiceId, text)) blocks = setBlockAudio(blocks, block.id, { hash: audioHash(voiceId, text), uploadId: r.uploadId, voiceId, at: new Date().toISOString() });
      }
      try {
        await studioDb.call("studio_save_record", { p_location_id: actor.locationId, p_record_id: recordId, p_kind: "content", p_title: row.title,
          p_payload_patch: { scriptBlocks: blocksDoc(blocks), script: blocksToScript(blocks) }, p_expected_version: Number(row.version), p_clerk_user_id: actor.userId });
        return;
      } catch (error) { if ((error as { code?: string }).code !== "40001") return; }
    }
  } catch { /* the video is already queued; remembering clips is an optimisation */ }
}
