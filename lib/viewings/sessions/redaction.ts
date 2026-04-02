const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g;
const ID_LIKE_RE = /\b(?=[A-Z0-9_-]{8,}\b)(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/gi;

const REDACTED_EMAIL = "[REDACTED_EMAIL]";
const REDACTED_PHONE = "[REDACTED_PHONE]";
const REDACTED_ID = "[REDACTED_ID]";
const REDACTED_NOTE = "[REDACTED_INTERNAL_NOTE]";

const INTERNAL_NOTE_KEYS = new Set([
    "internalNotes",
    "viewingNotes",
    "ownerNotes",
    "privateNotes",
    "confidentialNotes",
    "internalOnlyNotes",
]);

export function redactSensitiveText(input: string): string {
    return String(input || "")
        .replace(ID_LIKE_RE, REDACTED_ID)
        .replace(EMAIL_RE, REDACTED_EMAIL)
        .replace(PHONE_RE, REDACTED_PHONE);
}

export function sanitizeModelInputValue<T = unknown>(value: T): T {
    if (value == null) return value;

    if (typeof value === "string") {
        return redactSensitiveText(value) as T;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeModelInputValue(entry)) as T;
    }

    if (typeof value !== "object") {
        return value;
    }

    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(source)) {
        if (INTERNAL_NOTE_KEYS.has(key)) {
            output[key] = REDACTED_NOTE;
            continue;
        }
        output[key] = sanitizeModelInputValue(raw);
    }
    return output as T;
}
