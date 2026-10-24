import { readFile } from "node:fs/promises";
import path from "node:path";
import { StudioJobError, StudioProviderRejectedError } from "./handlers";

export const TRANSCRIBE_MODEL = "whisper-1";
export interface TranscribedChunk { text: string; language: string | null; segments: Array<{ start: number; end: number; text: string }> }

/** One chunk through OpenAI's transcription API, with failures classified for retry. */
export async function transcribeChunk(filePath: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<TranscribedChunk> {
  const form = new FormData();
  form.set("model", TRANSCRIBE_MODEL);
  form.set("response_format", "verbose_json");
  form.set("file", new Blob([await readFile(filePath)], { type: "audio/ogg" }), path.basename(filePath));
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` },
      body: form, signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]) });
  } catch { throw new StudioJobError("provider_unreachable", "Could not reach OpenAI. The job will retry.", true); }
  if (response.status === 401 || response.status === 403) throw new StudioProviderRejectedError("openai_key_rejected", "OpenAI rejected this workspace's key. Update it in AI settings, then retry.", false);
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new StudioProviderRejectedError("provider_rate_limited", "OpenAI is rate limiting or the OpenAI account is out of credit. The job will retry.", true, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 300);
  }
  if (response.status >= 500) throw new StudioJobError("provider_unavailable", "OpenAI is temporarily unavailable. The job will retry.", true);
  if (response.status === 400 || response.status === 422) throw new StudioProviderRejectedError("provider_rejected_input", "OpenAI could not transcribe this audio.", false);
  if (!response.ok) throw new StudioJobError("provider_outcome_uncertain", "OpenAI did not return a confirmed result.", false);
  const body = await response.json() as { text?: unknown; language?: unknown; segments?: Array<{ start?: unknown; end?: unknown; text?: unknown }> };
  if (!body || typeof body.text !== "string" || (body.segments !== undefined && !Array.isArray(body.segments))) {
    throw new StudioJobError("provider_outcome_uncertain", "OpenAI returned an unreadable result.", false);
  }
  return {
    text: body.text,
    language: typeof body.language === "string" ? body.language : null,
    segments: (body.segments ?? []).filter(s => s && typeof s.text === "string" && Number.isFinite(Number(s.start)) && Number.isFinite(Number(s.end)))
      .map(s => ({ start: Number(s.start), end: Number(s.end), text: String(s.text) })),
  };
}
