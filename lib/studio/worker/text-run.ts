import { authorizeScheduledTextJob } from "../schedule-authority";
import { queryPath } from "../rest-client";
import { aiCredentialContext, decryptStudioSecret } from "../secrets";
import type { IdeaSnapshot } from "../idea-review-policy";
import { StudioJobError, StudioProviderRejectedError, type StudioJobHandler } from "./handlers";
import type { TextProviderResult, TextRunSpec } from "./openai-text";
export interface TextRunDeps<T, S = IdeaSnapshot> {
  rest<T>(path: string, init?: RequestInit): Promise<T>;
  authorizeScheduledJob?(workspaceId: string, jobId: string): Promise<boolean>;
  decryptKey(workspaceId: string, credential: { ciphertext: string; iv: string; auth_tag: string; key_id: string }): string;
  generate(snapshot: S, key: string, signal: AbortSignal): Promise<TextProviderResult<T>>;
}
export function createTextRunHandler<T, S = IdeaSnapshot>(spec: TextRunSpec<T, S>, deps: TextRunDeps<T, S>): StudioJobHandler {
  return async (job, context) => {
    const reviewId = String(job.payload.reviewId ?? "");
    if (!/^[0-9a-f-]{36}$/.test(reviewId)) throw new StudioJobError("invalid_job_payload", "This job is missing its text workflow.", false);
    const [review] = await deps.rest<Array<{ snapshot: S; result: unknown; model: string; prompt_version: string; workflow: string }>>(queryPath("studio_idea_reviews", {
      select: "snapshot,result,model,prompt_version,workflow", workflow: `eq.${spec.workflow}`, workspace_id: `eq.${job.workspace_id}`, id: `eq.${reviewId}`, job_id: `eq.${job.id}`, limit: "1" }));
    if (!review) throw new StudioJobError("text_run_missing", "The text workflow is no longer available.", false);
    if (review.model !== spec.model || review.prompt_version !== spec.promptVersion || review.workflow !== spec.workflow) throw new StudioJobError("text_run_version_unsupported", "This review requires a matching worker version before processing.", false);
    if (review.result) return { reviewId, alreadyReviewed: true };
    if (deps.authorizeScheduledJob && !await deps.authorizeScheduledJob(job.workspace_id, job.id)) throw new StudioJobError("schedule_authority_revoked", "The recurring schedule author no longer has workspace access. Reauthorize the schedule before retrying.", false);
    const [credential] = await deps.rest<Array<{ ciphertext: string; iv: string; auth_tag: string; key_id: string }>>(queryPath("studio_workspace_ai_credentials", {
      select: "ciphertext,iv,auth_tag,key_id", workspace_id: `eq.${job.workspace_id}`, provider: "eq.openai", limit: "1" }));
    if (!credential) throw new StudioJobError("openai_key_missing", "Add an OpenAI key in AI settings before retrying.", false);
    let key: string;
    try { key = deps.decryptKey(job.workspace_id, credential); }
    catch { throw new StudioJobError("openai_key_unreadable", "Save the workspace OpenAI key again before retrying.", false); }
    const fence = { p_workspace_id: job.workspace_id, p_review_id: reviewId, p_job_id: job.id, p_worker_id: context.workerId, p_lease_token: job.lease_token };
    const rpc = <T>(name: string, body: Record<string, unknown>) => deps.rest<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
    const active = () => { if (context.signal.aborted) throw new StudioJobError("worker_lease_lost", "The worker lost its lease.", true); };
    active();
    const attempt = await rpc<{ outcome: string; attempt_id?: string }>("studio_begin_text_run_attempt", fence);
    if (attempt.outcome === "schedule_inactive") throw new StudioJobError("schedule_inactive", "Recurring consent, inputs or membership changed. Review and reauthorize the schedule before generating again.", false);
    if (attempt.outcome === "saved") return { reviewId, alreadyReviewed: true };
    if (attempt.outcome === "budget_exhausted") throw new StudioJobError("ai_budget_exhausted", "The workspace needs at least a $0.01 available budget hold for this review. Check AI settings before retrying.", false);
    if (attempt.outcome === "reconciled") throw new StudioJobError("ai_replacement_required", "Billing was reviewed. An AI manager must separately authorize replacement work from Jobs.", false);
    if (attempt.outcome === "uncertain") throw uncertain();
    if (attempt.outcome !== "started" || !attempt.attempt_id) throw new Error("Invalid attempt response");
    try {
      active();
      const output = await deps.generate(review.snapshot, key, context.signal);
      active();
      await rpc("studio_finish_text_run_attempt", { ...fence, p_attempt_id: attempt.attempt_id, p_result: output.result,
        p_input_tokens: output.inputTokens, p_output_tokens: output.outputTokens, p_response_id: output.providerResponseId, p_rate_version: output.rateVersion });
    } catch (error) {
      const rejected = error instanceof StudioProviderRejectedError;
      const { p_review_id: _review, ...jobFence } = fence;
      await rpc("studio_close_ai_attempt", { ...jobFence, p_attempt_id: attempt.attempt_id, p_rejected: rejected }).catch(() => {});
      if (rejected) throw error;
      throw uncertain();
    }
    return { reviewId };
  };
}
const uncertain = () => new StudioJobError("ai_outcome_uncertain", "An AI call may have been billed without a usable saved result. The budget hold is retained; an AI manager can review this from Jobs. Automatic resend is blocked.", false);
export function productionTextRunDeps<T, S = IdeaSnapshot>(rest: TextRunDeps<T, S>["rest"], generate: TextRunDeps<T, S>["generate"]): TextRunDeps<T, S> {
  return { rest, generate, authorizeScheduledJob: (workspaceId, jobId) => authorizeScheduledTextJob(rest, workspaceId, jobId), decryptKey: (workspaceId, c) => decryptStudioSecret({ ciphertext: c.ciphertext, iv: c.iv, authTag: c.auth_tag, keyId: c.key_id }, aiCredentialContext(workspaceId, "openai")) };
}
