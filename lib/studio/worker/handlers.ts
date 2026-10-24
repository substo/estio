import type { StudioJob } from "./queue";

/**
 * A handler failure. `retryable` covers transient causes (provider outage, rate
 * limit, network); permanent causes (bad input, missing key) fail immediately.
 * Messages are shown to workspace members, so never include secrets.
 */
export class StudioJobError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly retryAfterSeconds?: number) {
    super(message); this.name = "StudioJobError";
  }
}
/** A definitive provider rejection response; no successful processing was returned. */
export class StudioProviderRejectedError extends StudioJobError {}

export interface StudioJobContext { signal: AbortSignal; workerId: string }
export type StudioJobHandler = (job: StudioJob, context: StudioJobContext) => Promise<Record<string, unknown>>;

/** Proves the hosted worker is running and can reach the queue. No AI spend. */
const diagnostic: StudioJobHandler = async (_job, context) => ({ ok: true, workerId: context.workerId, checkedAt: new Date().toISOString() });

export const studioJobHandlers: Record<string, StudioJobHandler> = { "studio.diagnostic": diagnostic };
export const studioJobKindLabels: Record<string, string> = { "studio.youtube_discovery": "YouTube discovery", "studio.knowledge_extract": "Knowledge extraction", "studio.script_brief": "Script brief", "studio.idea_review": "Idea review", "studio.diagnostic": "Worker check", "studio.transcribe_upload": "Transcribe upload" };
