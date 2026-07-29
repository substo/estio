export {
    DEVICE_TUNNEL_CANARY_SCOPES_ENV,
    DEVICE_TUNNEL_PRODUCTION_SCOPES_ENV,
    parseDeviceTunnelCanaryScopes,
    parseDeviceTunnelProductionScopes,
} from "./canary-scope";
export type {
    DeviceTunnelCanaryScope,
    DeviceTunnelProductionScope,
} from "./canary-scope";
import {
    parseDeviceTunnelCanaryScopes,
    parseDeviceTunnelProductionScopes,
} from "./canary-scope";
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
    const exactMatch = (scope: { locationId: string; sessionId: string; bindingId: string }) => (
        scope.locationId === args.locationId
        && scope.sessionId === args.sessionId
        && scope.bindingId === args.bindingId
    );
    const productionMatches = parseDeviceTunnelProductionScopes(env).filter(exactMatch);
    const canaryMatches = parseDeviceTunnelCanaryScopes(env).filter(exactMatch);
    if (productionMatches.length && canaryMatches.length) {
        return {
            selected: true as const,
            active: false as const,
            scope: productionMatches[0],
            scopeType: "production" as const,
            authorizationExpiresAt: null,
            errors: ["scope_overlap"],
        };
    }
    if (productionMatches.length) {
        const scope = productionMatches[0];
        const errors = activationErrors(env, args.now || new Date());
        if (scope.gatewayNodeId !== args.gatewayNodeId && args.gatewayNodeId) errors.push("wrong_gateway_node");
        const uniqueErrors = Array.from(new Set(errors));
        return {
            selected: true as const,
            active: uniqueErrors.length === 0,
            scope,
            scopeType: "production" as const,
            authorizationExpiresAt: null,
            errors: uniqueErrors,
        };
    }
    const matches = canaryMatches;
    if (!matches.length) {
        return {
            selected: false as const,
            active: false as const,
            scope: null,
            scopeType: null,
            authorizationExpiresAt: null,
            errors: [] as string[],
        };
    }
    const scope = matches[0];
    const now = args.now || new Date();
    const errors = activationErrors(env, now);
    if (scope.gatewayNodeId !== args.gatewayNodeId && args.gatewayNodeId) errors.push("wrong_gateway_node");
    const expiry = new Date(scope.expiresAt);
    if (expiry <= now) errors.push("canary_scope_expired");
    if (expiry.getTime() - now.getTime() > 7 * 86_400_000) errors.push("canary_scope_expiry_too_distant");
    const uniqueErrors = Array.from(new Set(errors));
    return {
        selected: true as const,
        active: uniqueErrors.length === 0,
        scope,
        scopeType: "canary" as const,
        authorizationExpiresAt: expiry,
        errors: uniqueErrors,
    };
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
