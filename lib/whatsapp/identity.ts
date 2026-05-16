export function normalizeDigits(value: string | null | undefined) {
    return String(value || "").replace(/\D/g, "");
}

export function normalizeLidJid(value: string | null | undefined): string | null {
    const raw = String(value || "").trim().toLowerCase().replace(/^\+/, "");
    if (!raw) return null;

    const lidIndex = raw.indexOf("@lid");
    if (lidIndex < 0) return null;

    const lidDigits = normalizeDigits(raw.slice(0, lidIndex));
    return lidDigits ? `${lidDigits}@lid` : null;
}

export function normalizeLidRaw(value: string | null | undefined): string | null {
    const normalized = normalizeLidJid(value);
    return normalized ? normalized.replace("@lid", "") : null;
}

function normalizeComparableJid(value: unknown): string | null {
    const raw = String(value || "").trim().toLowerCase();
    return raw || null;
}

export function isHighConfidenceResolvedPhone(value: string | null | undefined): boolean {
    const digits = normalizeDigits(value);
    return digits.length >= 8 && !digits.startsWith("0");
}

export function extractPhoneJidCandidate(value: unknown): string | null {
    const jid = normalizeComparableJid(value);
    if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;

    const digits = normalizeDigits(jid.replace("@s.whatsapp.net", ""));
    return isHighConfidenceResolvedPhone(digits) ? digits : null;
}

export function extractDirectPhoneFieldCandidate(value: unknown): string | null {
    const raw = String(value || "").trim();
    if (!raw || raw.includes("@")) return null;

    const digits = normalizeDigits(raw.replace(/^whatsapp:/i, ""));
    return isHighConfidenceResolvedPhone(digits) ? digits : null;
}
