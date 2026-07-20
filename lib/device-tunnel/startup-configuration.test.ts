import assert from "node:assert/strict";
import test from "node:test";
import {
    WhatsAppDeviceEgressConfigurationError,
    validateWhatsAppDeviceEgressStartupConfiguration,
} from "./startup-configuration";

const now = new Date("2026-07-20T12:00:00.000Z");
const scope = {
    locationId: "location-1",
    sessionId: "session-1",
    bindingId: "binding-1",
    gatewayNodeId: "node-b",
    gatewayUrl: "wss://node-b.egress.estio.co/device-tunnel",
    changeRef: "change-123",
    expiresAt: "2026-07-22T00:00:00.000Z",
};

function canaryEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
        DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES: "egress.estio.co",
        DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([scope]),
        DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true",
        DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true",
        WHATSAPP_SESSION_AUTH_MODE: "encrypted_snapshot",
        WHATSAPP_SESSION_AUTH_KMS_KEY_PATH: "projects/p/locations/global/keyRings/r/cryptoKeys/k",
        CLOUDFLARE_R2_ACCOUNT_ID: "a".repeat(32),
        WHATSAPP_SESSION_AUTH_R2_ACCESS_KEY_ID: "dedicated-access",
        WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY: "dedicated-secret",
        WHATSAPP_SESSION_AUTH_R2_BUCKET: "private-auth",
        ...overrides,
    };
}

function expectCode(env: NodeJS.ProcessEnv, code: string) {
    assert.throws(
        () => validateWhatsAppDeviceEgressStartupConfiguration(env, now),
        (error) => error instanceof WhatsAppDeviceEgressConfigurationError && error.message === code,
    );
}

test("unset and explicit-off controls preserve narrow local compatibility", () => {
    assert.deepEqual(validateWhatsAppDeviceEgressStartupConfiguration({}, now), {
        distributedPlacement: false,
        runtimeLeaseEnforcement: false,
        sessionAuthMode: "local",
        rateLimitMode: "disabled",
        canaryScopeCount: 0,
        distributedCanaryCapable: false,
    });
    for (const rateLimitMode of ["disabled", "shadow", "enforce"] as const) {
        const config = validateWhatsAppDeviceEgressStartupConfiguration({
            DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "false",
            DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "false",
            WHATSAPP_SESSION_AUTH_MODE: "local",
            WHATSAPP_RATE_LIMIT_MODE: rateLimitMode,
        }, now);
        assert.equal(config.rateLimitMode, rateLimitMode);
        assert.equal(config.distributedCanaryCapable, false);
    }
});

test("an exact durable canary configuration is valid without global session activation", () => {
    const config = validateWhatsAppDeviceEgressStartupConfiguration(canaryEnv(), now);
    assert.equal(config.distributedCanaryCapable, true);
    assert.equal(config.canaryScopeCount, 1);
    assert.equal(config.rateLimitMode, "disabled");
});

test("every partial or contradictory four-control configuration fails closed", () => {
    expectCode({ DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true" }, "placement_lease_mismatch");
    expectCode({ DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true" }, "placement_lease_mismatch");
    expectCode({
        DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true",
        DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true",
    }, "durable_auth_control_mismatch");
    expectCode({ WHATSAPP_SESSION_AUTH_MODE: "encrypted_snapshot" }, "durable_auth_control_mismatch");
    expectCode(canaryEnv({ DEVICE_TUNNEL_CANARY_SCOPES: "[]" }), "canary_scope_missing");
    expectCode(canaryEnv({ WHATSAPP_SESSION_AUTH_KMS_KEY_PATH: "wrong" }), "kms_configuration_invalid");
    expectCode(canaryEnv({ WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY: "" }), "r2_configuration_invalid");
});

test("ambiguous and deprecated control values are rejected with non-secret codes", () => {
    expectCode({ DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "1" }, "control_boolean_invalid");
    expectCode({ DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "" }, "control_boolean_invalid");
    expectCode({ WHATSAPP_SESSION_AUTH_MODE: "remote" }, "session_auth_mode_invalid");
    expectCode({ WHATSAPP_RATE_LIMIT_MODE: "enabled" }, "rate_limit_mode_invalid");
    expectCode({ WHATSAPP_RATE_LIMIT_ENABLED: "false" }, "deprecated_control_present");
    expectCode({ DEVICE_TUNNEL_DISTRIBUTED_MODE: "false" }, "deprecated_control_present");
});

test("scopes cannot be staged ambiguously or outlive their review window", () => {
    expectCode({
        DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES: "egress.estio.co",
        DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([scope]),
    }, "durable_auth_control_mismatch");
    expectCode(canaryEnv({ DEVICE_TUNNEL_CANARY_SCOPES: "not-json" }), "canary_scope_invalid");
    expectCode(canaryEnv({
        DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([{ ...scope, expiresAt: "2026-07-20T11:00:00.000Z" }]),
    }), "canary_scope_expired");
    expectCode(canaryEnv({
        DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([{ ...scope, expiresAt: "2026-08-20T00:00:00.000Z" }]),
    }), "canary_scope_expiry_too_distant");
});
