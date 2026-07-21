export function isWhatsAppWebBridgeActiveProbeFresh(args: {
    healthy: boolean;
    lastSuccessAt?: Date | string | null;
    nowMs?: number;
    maxAgeMs: number;
}) {
    if (!args.healthy || !args.lastSuccessAt || !Number.isFinite(args.maxAgeMs) || args.maxAgeMs <= 0) {
        return false;
    }
    const lastSuccessMs = args.lastSuccessAt instanceof Date
        ? args.lastSuccessAt.getTime()
        : Date.parse(String(args.lastSuccessAt));
    if (!Number.isFinite(lastSuccessMs)) return false;
    const ageMs = (args.nowMs ?? Date.now()) - lastSuccessMs;
    return ageMs >= 0 && ageMs <= args.maxAgeMs;
}

export function isWhatsAppWebBridgeCheckpointEligible(args: {
    ready: boolean;
    runtimeLeaseEnforced: boolean;
    ownershipValid: boolean;
    activeProbeHealthy: boolean;
    lastActiveProbeSuccessAt?: Date | string | null;
    nowMs?: number;
    maxAgeMs: number;
}) {
    if (!args.ready || (args.runtimeLeaseEnforced && !args.ownershipValid)) return false;
    return isWhatsAppWebBridgeActiveProbeFresh({
        healthy: args.activeProbeHealthy,
        lastSuccessAt: args.lastActiveProbeSuccessAt,
        nowMs: args.nowMs,
        maxAgeMs: args.maxAgeMs,
    });
}

export function didDeviceTunnelGatewayGenerationChange(args: {
    deviceTunnelBindingId?: string | null;
    sessionGeneration?: string | null;
    gatewayGeneration?: string | null;
}) {
    if (!String(args.deviceTunnelBindingId || "").trim()) return false;
    const sessionGeneration = String(args.sessionGeneration || "").trim();
    const gatewayGeneration = String(args.gatewayGeneration || "").trim();
    return !sessionGeneration || !gatewayGeneration || sessionGeneration !== gatewayGeneration;
}
