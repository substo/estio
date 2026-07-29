import {
    DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV,
    isDeviceTunnelAndroidTrustedHostname,
    parseDeviceTunnelGatewayHostSuffixes,
    validateTrustedDeviceTunnelGatewayUrl,
} from "./gateway-url";

export const DEVICE_TUNNEL_CANARY_SCOPES_ENV = "DEVICE_TUNNEL_CANARY_SCOPES";
export const DEVICE_TUNNEL_PRODUCTION_SCOPES_ENV = "DEVICE_TUNNEL_PRODUCTION_SCOPES";

export type DeviceTunnelExactScope = {
    locationId: string;
    sessionId: string;
    bindingId: string;
    gatewayNodeId: string;
    gatewayUrl: string;
    changeRef: string;
};

export type DeviceTunnelCanaryScope = DeviceTunnelExactScope & {
    expiresAt: string;
};

export type DeviceTunnelProductionScope = DeviceTunnelExactScope;

const SAFE_SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/;

function requiredId(value: unknown, name: string) {
    const normalized = String(value || "").trim();
    if (!SAFE_SCOPE_ID.test(normalized)) throw new Error(`Device tunnel canary ${name} is invalid`);
    return normalized;
}

function parseDeviceTunnelExactScopes(args: {
    env: NodeJS.ProcessEnv;
    envName: string;
    label: string;
    expiring: boolean;
}): Array<DeviceTunnelExactScope & { expiresAt?: string }> {
    const raw = String(args.env[args.envName] || "").trim();
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${args.envName} must be valid JSON`);
    }
    if (!Array.isArray(parsed) || parsed.length > 25) {
        throw new Error(`${args.envName} must contain at most 25 exact scopes`);
    }
    const trustedHostSuffixes = parseDeviceTunnelGatewayHostSuffixes(
        args.env[DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV],
    );
    const scopes = parsed.map((value: any) => {
        const expiresAt = args.expiring ? new Date(String(value?.expiresAt || "")) : null;
        if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
            throw new Error(`Device tunnel ${args.label} expiry is invalid`);
        }
        const gatewayUrl = validateTrustedDeviceTunnelGatewayUrl({
            value: String(value?.gatewayUrl || ""),
            trustedHostSuffixes,
            production: true,
        });
        if (!isDeviceTunnelAndroidTrustedHostname(new URL(gatewayUrl).hostname)) {
            throw new Error(`Device tunnel ${args.label} hostname is outside the Android trust boundary`);
        }
        return {
            locationId: requiredId(value?.locationId, `${args.label} location ID`),
            sessionId: requiredId(value?.sessionId, `${args.label} session ID`),
            bindingId: requiredId(value?.bindingId, `${args.label} binding ID`),
            gatewayNodeId: requiredId(value?.gatewayNodeId, `${args.label} gateway node ID`),
            gatewayUrl,
            changeRef: requiredId(value?.changeRef, `${args.label} change reference`),
            ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
        };
    });
    const keys = new Set<string>();
    for (const scope of scopes) {
        const key = `${scope.locationId}\0${scope.sessionId}\0${scope.bindingId}`;
        if (keys.has(key)) {
            throw new Error(`Device tunnel ${args.label} scopes contain a duplicate tenant/session/binding`);
        }
        keys.add(key);
    }
    return scopes;
}

export function parseDeviceTunnelCanaryScopes(
    env: NodeJS.ProcessEnv = process.env,
): DeviceTunnelCanaryScope[] {
    return parseDeviceTunnelExactScopes({
        env,
        envName: DEVICE_TUNNEL_CANARY_SCOPES_ENV,
        label: "canary",
        expiring: true,
    }) as DeviceTunnelCanaryScope[];
}

export function parseDeviceTunnelProductionScopes(
    env: NodeJS.ProcessEnv = process.env,
): DeviceTunnelProductionScope[] {
    return parseDeviceTunnelExactScopes({
        env,
        envName: DEVICE_TUNNEL_PRODUCTION_SCOPES_ENV,
        label: "production",
        expiring: false,
    }) as DeviceTunnelProductionScope[];
}
