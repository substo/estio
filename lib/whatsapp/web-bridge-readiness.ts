const NON_READY_STALE_STATUSES = new Set(["authenticated", "starting", "loading"]);

export const DEFAULT_WEB_BRIDGE_NON_READY_STALE_MS = 180_000;

function parseTimestampMs(value: unknown) {
    if (!value) return null;
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(time) ? time : null;
}

export function getStaleWhatsAppWebBridgeNonReadyReason(args: {
    status?: unknown;
    ready?: unknown;
    lastEventAt?: unknown;
    startedAt?: unknown;
    nowMs?: number;
    maxAgeMs?: number;
}) {
    if (args.ready) return null;

    const status = String(args.status || "").trim().toLowerCase();
    if (!NON_READY_STALE_STATUSES.has(status)) return null;

    const referenceMs = parseTimestampMs(args.lastEventAt) ?? parseTimestampMs(args.startedAt);
    if (!referenceMs) return null;

    const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
    const maxAgeMs = Math.max(Number(args.maxAgeMs || DEFAULT_WEB_BRIDGE_NON_READY_STALE_MS), 30_000);
    const ageMs = nowMs - referenceMs;
    if (ageMs <= maxAgeMs) return null;

    return `WhatsApp Web Bridge session stayed ${status} for ${Math.round(ageMs / 1000)} seconds without becoming ready.`;
}
