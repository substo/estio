import {
    DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV,
    isDeviceTunnelAndroidTrustedHostname,
    parseDeviceTunnelGatewayHostSuffixes,
    validateTrustedDeviceTunnelGatewayUrl,
} from "./gateway-url";
import { isDistributedDeviceTunnelPlacementEnabled } from "./distributed-placement";
import { isDeviceTunnelRuntimeLeaseEnforcementEnabled } from "./runtime-ownership";
import { validateSessionAuthKmsKeyName } from "../whatsapp/session-auth-kms";
import { getSessionAuthObjectStoreConfig } from "../whatsapp/session-auth-object-store";

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

function activationErrors(env: NodeJS.ProcessEnv) {
    const errors: string[] = [];
    if (!isDistributedDeviceTunnelPlacementEnabled(env)) errors.push("distributed_placement_disabled");
    if (!isDeviceTunnelRuntimeLeaseEnforcementEnabled(env)) errors.push("runtime_lease_enforcement_disabled");
    if (String(env.WHATSAPP_SESSION_AUTH_MODE || "").trim().toLowerCase() !== "encrypted_snapshot") {
        errors.push("durable_session_auth_disabled");
    }
    try { validateSessionAuthKmsKeyName(env.WHATSAPP_SESSION_AUTH_KMS_KEY_PATH); }
    catch { errors.push("kms_configuration_invalid"); }
    try { getSessionAuthObjectStoreConfig(env); }
    catch { errors.push("r2_configuration_incomplete"); }
    return Array.from(new Set(errors));
}

export function resolveDeviceTunnelCanary(args: {
    locationId: string;
    sessionId: string;
    bindingId: string;
    gatewayNodeId?: string | null;
    env?: NodeJS.ProcessEnv;
    now?: Date;
}) {
    const env = args.env || process.env;
    const matches = parseDeviceTunnelCanaryScopes(env).filter((scope) => (
        scope.locationId === args.locationId
        && scope.sessionId === args.sessionId
        && scope.bindingId === args.bindingId
    ));
    if (!matches.length) return { selected: false as const, active: false as const, scope: null, errors: [] as string[] };
    const scope = matches[0];
    const errors = activationErrors(env);
    if (scope.gatewayNodeId !== args.gatewayNodeId && args.gatewayNodeId) errors.push("wrong_gateway_node");
    const now = args.now || new Date();
    const expiry = new Date(scope.expiresAt);
    if (expiry <= now) errors.push("canary_scope_expired");
    if (expiry.getTime() - now.getTime() > 7 * 86_400_000) errors.push("canary_scope_expiry_too_distant");
    return { selected: true as const, active: errors.length === 0, scope, errors };
}

export function requireAuthoritativeDeviceTunnelTokenMode(args: {
    canary: ReturnType<typeof resolveDeviceTunnelCanary>;
    placementMode: "compatibility" | "distributed_canary";
    gatewayPublicUrl: string | null;
}) {
    if (!args.canary.selected) {
        if (args.placementMode !== "compatibility") throw new Error("Distributed token has no exact canary scope");
        return false;
    }
    if (args.placementMode !== "distributed_canary") {
        throw new Error("A selected canary requires a fresh distributed token");
    }
    if (!args.canary.active || args.canary.scope.gatewayUrl !== args.gatewayPublicUrl) {
        throw new Error("Distributed canary scope is not authoritative on this gateway");
    }
    return true;
}
