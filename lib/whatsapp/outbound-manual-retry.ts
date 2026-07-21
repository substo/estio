const RETRYABLE_MESSAGE_STATUSES = new Set(["failed", "delivery_unconfirmed"]);
const RETRYABLE_OUTBOX_STATUSES = new Set(["failed", "dead", "delivery_unconfirmed"]);

export type WhatsAppManualRetryEligibilityCode =
    | "eligible"
    | "scope_mismatch"
    | "unsupported_kind"
    | "body_mismatch"
    | "message_not_terminal"
    | "outbox_not_terminal"
    | "outbox_locked";

export function getWhatsAppManualRetryEligibility(input: {
    scopeMatches: boolean;
    kind: unknown;
    bodyMatches: boolean;
    messageStatus: unknown;
    outboxStatus: unknown;
    outboxLocked: boolean;
}): { eligible: boolean; code: WhatsAppManualRetryEligibilityCode } {
    if (!input.scopeMatches) return { eligible: false, code: "scope_mismatch" };
    if (String(input.kind || "").toLowerCase() !== "text") return { eligible: false, code: "unsupported_kind" };
    if (!input.bodyMatches) return { eligible: false, code: "body_mismatch" };
    if (!RETRYABLE_MESSAGE_STATUSES.has(String(input.messageStatus || "").toLowerCase())) {
        return { eligible: false, code: "message_not_terminal" };
    }
    if (!RETRYABLE_OUTBOX_STATUSES.has(String(input.outboxStatus || "").toLowerCase())) {
        return { eligible: false, code: "outbox_not_terminal" };
    }
    if (input.outboxLocked) return { eligible: false, code: "outbox_locked" };
    return { eligible: true, code: "eligible" };
}
