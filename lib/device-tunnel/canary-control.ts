export {
    DEVICE_TUNNEL_CANARY_SCOPES_ENV,
    parseDeviceTunnelCanaryScopes,
} from "./canary-scope";
export type { DeviceTunnelCanaryScope } from "./canary-scope";
import { parseDeviceTunnelCanaryScopes } from "./canary-scope";
import {
    WhatsAppDeviceEgressConfigurationError,
    validateWhatsAppDeviceEgressStartupConfiguration,
} from "./startup-configuration";

function activationErrors(env: NodeJS.ProcessEnv, now: Date) {
    try {
        validateWhatsAppDeviceEgressStartupConfiguration(env, now);
        return [];
    } catch (error) {
        return [error instanceof WhatsAppDeviceEgressConfigurationError
            ? error.code
            : "startup_configuration_invalid"];
    }
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
    const now = args.now || new Date();
    const errors = activationErrors(env, now);
    if (scope.gatewayNodeId !== args.gatewayNodeId && args.gatewayNodeId) errors.push("wrong_gateway_node");
    const expiry = new Date(scope.expiresAt);
    if (expiry <= now) errors.push("canary_scope_expired");
    if (expiry.getTime() - now.getTime() > 7 * 86_400_000) errors.push("canary_scope_expiry_too_distant");
    const uniqueErrors = Array.from(new Set(errors));
    return { selected: true as const, active: uniqueErrors.length === 0, scope, errors: uniqueErrors };
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
