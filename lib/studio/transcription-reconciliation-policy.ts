import { StudioCommandError } from "./command-error";
import { canManageStudioAi } from "./ai-settings-policy";

export class ReconciliationError extends StudioCommandError {}
export type ReconciliationCommand = {
  requestId: string; attemptId: string; expectedVersion: number;
  action: "no_charge" | "billed" | "authorize_replacement";
  evidence: string; costMicros: number | null; confirmPaid: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Provider evidence is a manager attestation, never a guessed timeout outcome. */
export function readReconciliationCommand(value: unknown): ReconciliationCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReconciliationError("Invalid review.");
  const b = value as Record<string, unknown>;
  if (typeof b.requestId !== "string" || !uuid.test(b.requestId) || typeof b.attemptId !== "string" || !uuid.test(b.attemptId)
    || !Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 1) throw new ReconciliationError("Reload this review before continuing.");
  if (b.action !== "no_charge" && b.action !== "billed" && b.action !== "authorize_replacement") throw new ReconciliationError("Choose a review action.");
  const evidence = typeof b.evidence === "string" ? b.evidence.trim() : "";
  if (evidence.length < 20 || evidence.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(evidence)) throw new ReconciliationError("Describe the evidence and its reference in 20–2000 characters.");
  if (/\bsk-[A-Za-z0-9_-]{16,}/.test(evidence)) throw new ReconciliationError("Remove API keys from the evidence.");
  if (b.action === "authorize_replacement") {
    if (b.confirmPaid !== true || b.costMicros !== null) throw new ReconciliationError("Explicitly authorize another paid attempt.");
  } else {
    if (b.confirmPaid !== false || !Number.isSafeInteger(b.costMicros) || Number(b.costMicros) < 0 || Number(b.costMicros) > 100_000_000_000
      || (b.action === "no_charge" && b.costMicros !== 0) || (b.action === "billed" && Number(b.costMicros) === 0)) throw new ReconciliationError("Enter the confirmed cost in micro-USD, or choose no charge.");
  }
  return { requestId: b.requestId.toLowerCase(), attemptId: b.attemptId.toLowerCase(), expectedVersion: Number(b.expectedVersion),
    action: b.action, evidence, costMicros: b.costMicros as number | null, confirmPaid: b.confirmPaid as boolean };
}

/** Exact USD conversion, preserving provider costs below one cent. */
export function reconciliationCostMicros(value: string): number {
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(value.trim())) throw new ReconciliationError("Enter US dollars with up to six decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const cost = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (cost > 100_000_000_000) throw new ReconciliationError("The cost exceeds $100,000.");
  return cost;
}

/** App realm and principal must agree; a matching email is never authority. */
export function canReviewTranscription(profile: { brand: "estio" | "substo"; userId: string } | null,
  access: (Parameters<typeof canManageStudioAi>[0] & { userId: string }) | null): boolean {
  return !!profile && !!access && profile.brand === access.app && profile.userId === access.userId && canManageStudioAi(access);
}
