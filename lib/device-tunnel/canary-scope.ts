import {
    DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV,
    isDeviceTunnelAndroidTrustedHostname,
    parseDeviceTunnelGatewayHostSuffixes,
    validateTrustedDeviceTunnelGatewayUrl,
} from "./gateway-url";

export const DEVICE_TUNNEL_CANARY_SCOPES_ENV = "DEVICE_TUNNEL_CANARY_SCOPES";

export type DeviceTunnelCanaryScope = {
    locationId: string;
    sessionId: string;
    bindingId: string;
    gatewayNodeId: string;
    gatewayUrl: string;
    changeRef: string;
    expiresAt: string;
};

const SAFE_SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/;

function requiredId(value: unknown, name: string) {
    const normalized = String(value || "").trim();
    if (!SAFE_SCOPE_ID.test(normalized)) throw new Error(`Device tunnel canary ${name} is invalid`);
    return normalized;
}

export function parseDeviceTunnelCanaryScopes(env: NodeJS.ProcessEnv = process.env): DeviceTunnelCanaryScope[] {
    const raw = String(env[DEVICE_TUNNEL_CANARY_SCOPES_ENV] || "").trim();
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("DEVICE_TUNNEL_CANARY_SCOPES must be valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.length > 25) {
        throw new Error("DEVICE_TUNNEL_CANARY_SCOPES must contain at most 25 exact scopes");
    }
    const trustedHostSuffixes = parseDeviceTunnelGatewayHostSuffixes(env[DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV]);
    const scopes = parsed.map((value: any) => {
        const expiresAt = new Date(String(value?.expiresAt || ""));
        if (!Number.isFinite(expiresAt.getTime())) throw new Error("Device tunnel canary expiry is invalid");
        const gatewayUrl = validateTrustedDeviceTunnelGatewayUrl({
            value: String(value?.gatewayUrl || ""),
            trustedHostSuffixes,
            production: true,
        });
        if (!isDeviceTunnelAndroidTrustedHostname(new URL(gatewayUrl).hostname)) {
            throw new Error("Device tunnel canary hostname is outside the Android trust boundary");
        }
        return {
            locationId: requiredId(value?.locationId, "location ID"),
            sessionId: requiredId(value?.sessionId, "session ID"),
            bindingId: requiredId(value?.bindingId, "binding ID"),
            gatewayNodeId: requiredId(value?.gatewayNodeId, "gateway node ID"),
            gatewayUrl,
            changeRef: requiredId(value?.changeRef, "change reference"),
            expiresAt: expiresAt.toISOString(),
        };
    });
    const keys = new Set<string>();
    for (const scope of scopes) {
        const key = `${scope.locationId}\0${scope.sessionId}\0${scope.bindingId}`;
        if (keys.has(key)) throw new Error("Device tunnel canary scopes contain a duplicate tenant/session/binding");
        keys.add(key);
    }
    return scopes;
}
