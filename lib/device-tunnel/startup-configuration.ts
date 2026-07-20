import { parseDeviceTunnelCanaryScopes } from "./canary-scope";
import { validateSessionAuthKmsKeyName } from "../whatsapp/session-auth-kms";
import { getSessionAuthObjectStoreConfig } from "../whatsapp/session-auth-object-store";

export type WhatsAppDeviceEgressStartupConfiguration = {
    distributedPlacement: boolean;
    runtimeLeaseEnforcement: boolean;
    sessionAuthMode: "local" | "encrypted_snapshot";
    rateLimitMode: "disabled" | "shadow" | "enforce";
    canaryScopeCount: number;
    distributedCanaryCapable: boolean;
};

export type WhatsAppDeviceEgressConfigurationErrorCode =
    | "control_boolean_invalid"
    | "session_auth_mode_invalid"
    | "rate_limit_mode_invalid"
    | "deprecated_control_present"
    | "placement_lease_mismatch"
    | "durable_auth_control_mismatch"
    | "canary_scope_missing"
    | "canary_scope_invalid"
    | "canary_scope_expired"
    | "canary_scope_expiry_too_distant"
    | "kms_configuration_invalid"
    | "r2_configuration_invalid";

export class WhatsAppDeviceEgressConfigurationError extends Error {
    constructor(readonly code: WhatsAppDeviceEgressConfigurationErrorCode) {
        super(code);
        this.name = "WhatsAppDeviceEgressConfigurationError";
    }
}

const DEPRECATED_CONTROL_ENV = [
    "DEVICE_TUNNEL_DISTRIBUTED_MODE",
    "DEVICE_TUNNEL_LEASE_ENFORCEMENT",
    "WHATSAPP_SESSION_AUTH_PROVIDER",
    "WHATSAPP_RATE_LIMIT_ENABLED",
] as const;

function parseBooleanControl(env: NodeJS.ProcessEnv, name: string) {
    if (env[name] === undefined) return false;
    const value = String(env[name]).trim().toLowerCase();
    if (value === "true") return true;
    if (value === "false") return false;
    throw new WhatsAppDeviceEgressConfigurationError("control_boolean_invalid");
}

export function parseWhatsAppRateLimitModeStrict(env: NodeJS.ProcessEnv = process.env) {
    const value = env.WHATSAPP_RATE_LIMIT_MODE === undefined
        ? "disabled"
        : String(env.WHATSAPP_RATE_LIMIT_MODE).trim().toLowerCase();
    if (value !== "disabled" && value !== "shadow" && value !== "enforce") {
        throw new WhatsAppDeviceEgressConfigurationError("rate_limit_mode_invalid");
    }
    return value;
}

export function validateWhatsAppDeviceEgressStartupConfiguration(
    env: NodeJS.ProcessEnv = process.env,
    now = new Date(),
): WhatsAppDeviceEgressStartupConfiguration {
    if (DEPRECATED_CONTROL_ENV.some((name) => env[name] !== undefined)) {
        throw new WhatsAppDeviceEgressConfigurationError("deprecated_control_present");
    }

    const distributedPlacement = parseBooleanControl(env, "DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT");
    const runtimeLeaseEnforcement = parseBooleanControl(env, "DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT");
    const rawSessionAuthMode = env.WHATSAPP_SESSION_AUTH_MODE === undefined
        ? "local"
        : String(env.WHATSAPP_SESSION_AUTH_MODE).trim().toLowerCase();
    if (rawSessionAuthMode !== "local" && rawSessionAuthMode !== "encrypted_snapshot") {
        throw new WhatsAppDeviceEgressConfigurationError("session_auth_mode_invalid");
    }
    const rateLimitMode = parseWhatsAppRateLimitModeStrict(env);

    if (distributedPlacement !== runtimeLeaseEnforcement) {
        throw new WhatsAppDeviceEgressConfigurationError("placement_lease_mismatch");
    }
    const durableAuth = rawSessionAuthMode === "encrypted_snapshot";
    if (durableAuth !== distributedPlacement) {
        throw new WhatsAppDeviceEgressConfigurationError("durable_auth_control_mismatch");
    }

    let scopes;
    try {
        scopes = parseDeviceTunnelCanaryScopes(env);
    } catch {
        throw new WhatsAppDeviceEgressConfigurationError("canary_scope_invalid");
    }

    if (!distributedPlacement && scopes.length > 0) {
        throw new WhatsAppDeviceEgressConfigurationError("durable_auth_control_mismatch");
    }
    if (distributedPlacement && scopes.length === 0) {
        throw new WhatsAppDeviceEgressConfigurationError("canary_scope_missing");
    }
    if (distributedPlacement) {
        for (const scope of scopes) {
            const expiresAt = new Date(scope.expiresAt).getTime();
            if (expiresAt <= now.getTime()) {
                throw new WhatsAppDeviceEgressConfigurationError("canary_scope_expired");
            }
            if (expiresAt - now.getTime() > 7 * 86_400_000) {
                throw new WhatsAppDeviceEgressConfigurationError("canary_scope_expiry_too_distant");
            }
        }
        try {
            validateSessionAuthKmsKeyName(env.WHATSAPP_SESSION_AUTH_KMS_KEY_PATH);
        } catch {
            throw new WhatsAppDeviceEgressConfigurationError("kms_configuration_invalid");
        }
        try {
            getSessionAuthObjectStoreConfig(env);
        } catch {
            throw new WhatsAppDeviceEgressConfigurationError("r2_configuration_invalid");
        }
    }

    return {
        distributedPlacement,
        runtimeLeaseEnforcement,
        sessionAuthMode: rawSessionAuthMode,
        rateLimitMode,
        canaryScopeCount: scopes.length,
        distributedCanaryCapable: distributedPlacement,
    };
}
