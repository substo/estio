const INTEGER_PATTERN = /^-?\d+$/;

export function normalizeQueueJobIdSegment(value: unknown, fallback = "x"): string {
    let normalized = String(value ?? "").trim();
    if (!normalized) normalized = fallback;

    normalized = normalized
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (!normalized) normalized = fallback;
    if (INTEGER_PATTERN.test(normalized)) {
        normalized = `j_${normalized}`;
    }

    return normalized;
}

export function buildQueueJobId(...segments: unknown[]): string {
    const normalizedSegments = segments.map((segment, index) =>
        normalizeQueueJobIdSegment(segment, `s${index + 1}`)
    );
    const joined = normalizedSegments.join("__");
    if (INTEGER_PATTERN.test(joined)) {
        return `j_${joined}`;
    }
    return joined;
}

export function isDuplicateQueueJobError(error: unknown): boolean {
    const message = String((error as any)?.message || "").toLowerCase();
    if (!message) return false;
    return message.includes("job")
        && message.includes("already")
        && (message.includes("exists") || message.includes("exist"));
}
