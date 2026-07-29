const ALLOWED_DIAGNOSTIC_CODES = new Set([
    "AUTH_REJECTED",
    "ESTIO_UNREACHABLE",
    "GATEWAY_CONNECTION_FAILED",
    "GATEWAY_SILENT",
    "NETWORK_CHANGED",
    "NO_ANDROID_NETWORK",
    "TUNNEL_CONFIG_REJECTED",
    "TUNNEL_TOKEN_REJECTED",
    "UNKNOWN",
]);

const AUTO_RECOVERABLE_DIAGNOSTIC_CODES = new Set([
    "AUTH_REJECTED",
    "GATEWAY_CONNECTION_FAILED",
    "GATEWAY_SILENT",
    "TUNNEL_TOKEN_REJECTED",
]);

export const STO_AUTO_RECONNECT_STALE_MS = 90_000;
export const STO_AUTO_RECONNECT_COOLDOWN_MS = 120_000;

export function normalizeStoReconnectGeneration(value: unknown) {
    const generation = Number(value);
    return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
}

export function sanitizeStoReconnectErrorCode(value: unknown) {
    const code = String(value || "").trim().toUpperCase();
    return ALLOWED_DIAGNOSTIC_CODES.has(code) ? code : null;
}

export function sanitizeStoRuntimeState(value: unknown) {
    const state = String(value || "").trim().toLowerCase();
    return ["connected", "reconnecting", "stopped"].includes(state) ? state : null;
}

export function shouldRecordStoReconnectAttempt(input: {
    requestedGeneration: unknown;
    appliedGeneration: unknown;
}) {
    const requested = normalizeStoReconnectGeneration(input.requestedGeneration);
    const applied = normalizeStoReconnectGeneration(input.appliedGeneration);
    return requested > 0 && applied >= requested;
}

function dateMilliseconds(value: unknown) {
    if (!value) return null;
    const milliseconds = value instanceof Date
        ? value.getTime()
        : new Date(String(value)).getTime();
    return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function shouldAutoRequestStoReconnect(input: {
    bindingStatus: unknown;
    bindingLastSeenAt: unknown;
    lastReconnectRequestedAt: unknown;
    requestedGeneration: unknown;
    appliedGeneration: unknown;
    runtimeState: unknown;
    diagnosticCode: unknown;
    now?: Date;
}) {
    const nowMs = (input.now || new Date()).getTime();
    const bindingLastSeenMs = dateMilliseconds(input.bindingLastSeenAt);
    const lastRequestMs = dateMilliseconds(input.lastReconnectRequestedAt);
    const requested = normalizeStoReconnectGeneration(input.requestedGeneration);
    const applied = normalizeStoReconnectGeneration(input.appliedGeneration);
    const runtimeState = sanitizeStoRuntimeState(input.runtimeState);
    const diagnosticCode = sanitizeStoReconnectErrorCode(input.diagnosticCode);

    return runtimeState === "reconnecting"
        && diagnosticCode !== null
        && AUTO_RECOVERABLE_DIAGNOSTIC_CODES.has(diagnosticCode)
        && String(input.bindingStatus || "").toLowerCase() !== "online"
        && (bindingLastSeenMs === null || nowMs - bindingLastSeenMs >= STO_AUTO_RECONNECT_STALE_MS)
        && requested <= applied
        && (lastRequestMs === null || nowMs - lastRequestMs >= STO_AUTO_RECONNECT_COOLDOWN_MS);
}
