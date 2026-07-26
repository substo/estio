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
