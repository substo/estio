import { normalizeInternationalPhone } from "@/lib/utils/phone";

/**
 * Normalize a SIM relay line to E.164. An empty value is allowed because
 * Android/carriers do not always expose the MSISDN stored for a subscription.
 */
export function normalizeSmsRelayPhoneNumber(value: unknown): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const normalized = normalizeInternationalPhone(raw);
    return normalized.isValid ? normalized.formatted : null;
}

export function requireSmsRelayPhoneNumber(value: unknown): string {
    const normalized = normalizeSmsRelayPhoneNumber(value);
    if (!normalized) {
        throw new Error("Enter a valid mobile number in international format, for example +35799123456.");
    }
    return normalized;
}
