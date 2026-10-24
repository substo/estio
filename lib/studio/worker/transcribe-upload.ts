import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { queryPath } from "../rest-client";
import { aiCredentialContext, decryptStudioSecret } from "../secrets";
import { extractAudioChunks, probeMedia } from "./ffmpeg";
import { StudioJobError, StudioProviderRejectedError, type StudioJobHandler } from "./handlers";
import { TRANSCRIBE_MODEL, transcribeChunk, type TranscribedChunk } from "./openai-transcribe";

export const CHUNK_SECONDS = 600;
const MAX_DURATION_SECONDS = 6 * 3600;

export interface TranscribeDeps {
  rest<T>(path: string, init?: RequestInit): Promise<T>;
  presignWorkerRead(key: string): Promise<string>;
  decryptKey(workspaceId: string, credential: { ciphertext: string; iv: string; auth_tag: string; key_id: string }): string;
  probe(url: string, signal: AbortSignal): Promise<{ durationSeconds: number; hasAudio: boolean }>;
  extractChunks(url: string, directory: string, chunkSeconds: number, signal: AbortSignal): Promise<string[]>;
  transcribe(filePath: string, apiKey: string, signal: AbortSignal): Promise<TranscribedChunk>;
  tmpRoot?: string; now?: () => Date;
}

const rpc = (deps: TranscribeDeps, name: string, body: Record<string, unknown>) =>
  deps.rest<unknown>(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });

function secondsUntilNextUtcMonth(now: Date) {
  return Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / 1000) + 60;
}

/**
 * Transcribe a customer's own upload with the workspace's OpenAI key. Budget is
 * reserved durably per chunk before sending. Chunk + usage commit atomically.
 * Ambiguous calls retain their hold and cannot be automatically sent again.
 */
export function createTranscribeUploadHandler(deps: TranscribeDeps): StudioJobHandler {
  return async (job, context) => {
    const workspaceId = job.workspace_id;
    const uploadId = String(job.payload.uploadId ?? "");
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new StudioJobError("invalid_job_payload", "This job is missing its upload.", false);
    const [upload] = await deps.rest<Array<{ object_key: string; status: string }>>(queryPath("studio_uploads", {
      select: "object_key,status", workspace_id: `eq.${workspaceId}`, id: `eq.${uploadId}`, limit: "1" }));
    if (!upload || upload.status !== "uploaded") throw new StudioJobError("upload_missing", "The upload is no longer available.", false);
    const existing = await deps.rest<Array<{ duration_seconds: number }>>(queryPath("studio_transcripts", {
      select: "duration_seconds", workspace_id: `eq.${workspaceId}`, upload_id: `eq.${uploadId}`, limit: "1" }));
    if (existing.length) return { uploadId, alreadyTranscribed: true };

    const [credential] = await deps.rest<Array<{ ciphertext: string; iv: string; auth_tag: string; key_id: string }>>(queryPath("studio_workspace_ai_credentials", {
      select: "ciphertext,iv,auth_tag,key_id", workspace_id: `eq.${workspaceId}`, provider: "eq.openai", limit: "1" }));
    if (!credential) throw new StudioJobError("openai_key_missing", "Add an OpenAI key in AI settings, then retry this job.", false);
    let apiKey: string;
    try { apiKey = deps.decryptKey(workspaceId, credential); }
    catch { throw new StudioJobError("openai_key_unreadable", "The saved OpenAI key could not be read. Save it again in AI settings, then retry.", false); }

    const url = await deps.presignWorkerRead(upload.object_key);
    const media = await deps.probe(url, context.signal);
    if (!media.hasAudio) throw new StudioJobError("no_audio_track", "This file has no audio to transcribe.", false);
    if (!Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0) throw new StudioJobError("media_unreadable", "The uploaded file could not be read as audio or video.", false);
    if (media.durationSeconds > MAX_DURATION_SECONDS) throw new StudioJobError("media_too_long", "Transcription supports recordings up to 6 hours.", false);

    const done = await deps.rest<Array<{ chunk_index: number; duration_seconds: number }>>(queryPath("studio_transcript_chunks", {
      select: "chunk_index,duration_seconds", workspace_id: `eq.${workspaceId}`, upload_id: `eq.${uploadId}`, order: "chunk_index.asc" }));
    const doneIndexes = new Set(done.map(c => c.chunk_index));
    const chunkCount = Math.ceil(media.durationSeconds / CHUNK_SECONDS);
    const chunkDuration = (index: number) => Math.min(CHUNK_SECONDS, media.durationSeconds - index * CHUNK_SECONDS);
    const fence = { p_workspace_id: workspaceId, p_upload_id: uploadId, p_job_id: job.id,
      p_worker_id: context.workerId, p_lease_token: job.lease_token };
    const assertActive = () => {
      if (context.signal.aborted) throw new StudioJobError("worker_lease_lost", "The worker lost its job lease.", true);
    };
    let language: string | null = null;
    if (doneIndexes.size < chunkCount) {
      const directory = await mkdtemp(path.join(deps.tmpRoot ?? os.tmpdir(), "studio-transcribe-"));
      try {
        const files = await deps.extractChunks(url, directory, CHUNK_SECONDS, context.signal);
        for (const [index, file] of files.entries()) {
          if (doneIndexes.has(index) || index >= chunkCount) continue;
          assertActive();
          const attempt = await rpc(deps, "studio_begin_transcription_attempt", { ...fence, p_chunk_index: index,
            p_duration_seconds: chunkDuration(index) }) as { outcome: string; attempt_id?: string };
          if (attempt.outcome === "saved") continue;
          if (attempt.outcome === "uncertain") throw uncertainOutcome();
          if (attempt.outcome === "reconciled") throw new StudioJobError("transcription_replacement_required", "Billing was reviewed for a missing chunk. An AI manager must separately authorize replacement processing from Jobs before it can be sent again.", false);
          if (attempt.outcome === "budget_exhausted") throw new StudioJobError("ai_budget_exhausted", "This workspace's monthly AI cap is reached or set to $0. Raise it in AI settings and retry, or it will retry next month.",
            true, secondsUntilNextUtcMonth(deps.now?.() ?? new Date()));
          if (attempt.outcome !== "started" || !attempt.attempt_id) throw new Error("Invalid transcription attempt response");
          try {
            assertActive();
            const result = await deps.transcribe(file, apiKey, context.signal);
            language ??= result.language;
            assertActive();
            const offset = index * CHUNK_SECONDS;
            await rpc(deps, "studio_finish_transcription_attempt", { ...fence, p_attempt_id: attempt.attempt_id,
              p_text: result.text, p_segments: result.segments.map(s => ({ start: s.start + offset, end: s.end + offset, text: s.text })) });
          } catch (error) {
            // Never release on a timeout, abort, lost response, 5xx, invalid JSON,
            // failed result commit, or crash. Recovery also handles process death.
            const rejected = error instanceof StudioProviderRejectedError;
            await rpc(deps, "studio_close_transcription_attempt", { ...fence, p_attempt_id: attempt.attempt_id,
              p_rejected: rejected }).catch(() => {});
            if (rejected) throw error;
            throw uncertainOutcome();
          }
          await rm(file, { force: true });
        }
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
    const saved = await deps.rest<Array<{ chunk_index: number }>>(queryPath("studio_transcript_chunks", {
      select: "chunk_index", workspace_id: `eq.${workspaceId}`, upload_id: `eq.${uploadId}` }));
    if (saved.length < chunkCount) throw new StudioJobError("transcription_incomplete", "Part of the recording was not transcribed. The job will retry the missing part.", true);
    assertActive();
    await rpc(deps, "studio_finish_upload_transcript", { ...fence, p_model: TRANSCRIBE_MODEL,
      p_language: language && /^[a-z]{2,12}$/.test(language) ? language : null, p_duration_seconds: media.durationSeconds });
    return { uploadId, chunks: chunkCount, durationSeconds: media.durationSeconds };
  };
}

function uncertainOutcome() {
  return new StudioJobError("transcription_outcome_uncertain", "A transcription call may have been billed without a saved result. Its budget hold is retained. Automatic resend is blocked pending reconciliation.", false);
}

/** Production wiring: service REST, private R2 reads, ffmpeg, and OpenAI. */
export function productionTranscribeDeps(input: { rest: TranscribeDeps["rest"]; presignWorkerRead: TranscribeDeps["presignWorkerRead"] }): TranscribeDeps {
  return { ...input, probe: probeMedia, extractChunks: extractAudioChunks, transcribe: (file, key, signal) => transcribeChunk(file, key, signal),
    decryptKey: (workspaceId, c) => decryptStudioSecret({ ciphertext: c.ciphertext, iv: c.iv, authTag: c.auth_tag, keyId: c.key_id }, aiCredentialContext(workspaceId, "openai")) };
}
