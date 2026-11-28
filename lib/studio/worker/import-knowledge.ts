import { StudioDbError, type StudioDb } from "../db";
import { StudioJobError, type StudioJobHandler } from "./handlers";

export function createImportKnowledgeHandler(db: StudioDb): StudioJobHandler {
  return async (job, context) => {
    // Retry admission only. Generation belongs to the existing paired-Mac outline batches.
    const delay = job.attempts <= 5 ? 60 : 900;
    let result: { state: string; outlineId?: string };
    try {
      result = await db.call("studio_start_import_knowledge", {
        p_job_id: job.id, p_worker_id: context.workerId, p_lease_token: job.lease_token,
      });
    } catch (error) {
      const code = error instanceof StudioDbError ? error.code : undefined;
      if (code === "P2010") throw new StudioJobError("knowledge_input_too_large", "This source exceeds the full extraction limit.", false);
      if (code === "42501") throw new StudioJobError("knowledge_access_changed", "The importing account no longer has access to this source.", false);
      if (code === "22023") throw new StudioJobError("knowledge_invalid_input", "Studio couldn’t use the saved source evidence.", false);
      if (code === "P2011") {
        throw new StudioJobError("knowledge_mac_wait", "Waiting for the importing account’s paired Mac subscription to be ready.", true, delay);
      }
      if (code === "P2012") throw new StudioJobError("knowledge_capacity", "Waiting for room in the Knowledge queue.", true, delay);
      throw new StudioJobError("knowledge_admission", "Studio couldn’t start extraction. It will check again.", true, delay);
    }
    if (result.state === "started" && result.outlineId) return { outlineId: result.outlineId };
    if (result.state === "waiting_transcript") throw new StudioJobError("knowledge_wait_transcript", "Waiting for the source transcript.", true, delay);
    if (result.state === "no_evidence") throw new StudioJobError("knowledge_no_evidence", "Save a transcript or description to extract knowledge.", false);
    if (result.state === "source_changed") throw new StudioJobError("knowledge_source_changed", "The original source changed or was removed.", false);
    throw new StudioJobError("worker_lease_lost", "Studio lost the extraction lease.", false);
  };
}
