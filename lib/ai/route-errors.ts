import { GoogleGenerativeAIFetchError } from "@google/generative-ai";
import type { AiAttemptFailure } from "./routing";

/**
 * Failure stages for one routed attempt (pure, client-safe). Only a failure known to precede generation lets the chain move
 * to its next step: the connection is missing/signed out, or the provider rejected the request for its limit, quota or
 * credential before producing output. Anything else is treated as started or uncertain and is never replayed elsewhere.
 */
export class AiRouteUnavailableError extends Error {
  readonly aiAttemptStage = "before_generation" as const;
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "AiRouteUnavailableError"; }
}
/** A provider HTTP rejection received before any output (status kept; body text is not). */
export class AiProviderRejectedError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "AiProviderRejectedError"; }
}

const BEFORE_GENERATION_STATUSES = new Set([401, 403, 429]);
export function classifyAiAttemptFailure(error: unknown): AiAttemptFailure {
  if (error instanceof AiRouteUnavailableError) return { stage: "before_generation", reason: error.message };
  if (error instanceof AiProviderRejectedError || error instanceof GoogleGenerativeAIFetchError) {
    const status = error.status;
    if (status !== undefined && BEFORE_GENERATION_STATUSES.has(status)) {
      return { stage: "before_generation", reason: status === 429 ? "Limit or quota reached" : "Credential unavailable" };
    }
    if (error instanceof GoogleGenerativeAIFetchError && error.errorDetails?.some(detail => detail.reason === "API_KEY_INVALID")) {
      return { stage: "before_generation", reason: "Credential unavailable" };
    }
  }
  return { stage: "uncertain", reason: "The request failed after it was sent" };
}
