import assert from "node:assert/strict";
import test from "node:test";
import {
    parseDeviceTunnelCanaryScopes,
    requireAuthoritativeDeviceTunnelTokenMode,
    resolveDeviceTunnelCanary,
} from "./canary-control";

const scope = {
    locationId: "location-1",
    sessionId: "session-1",
    bindingId: "binding-1",
    gatewayNodeId: "node-b",
    gatewayUrl: "wss://node-b.egress.estio.co/device-tunnel",
    changeRef: "change-123",
    expiresAt: "2026-07-22T00:00:00.000Z",
};
const productionScope = {
    locationId: scope.locationId,
    sessionId: scope.sessionId,
    bindingId: scope.bindingId,
    gatewayNodeId: scope.gatewayNodeId,
    gatewayUrl: scope.gatewayUrl,
    changeRef: "production-change-456",
};

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
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

test("canary selection is exact, reviewable, expiring, and activation-ready", () => {
    const resolved = resolveDeviceTunnelCanary({
        locationId: scope.locationId,
        sessionId: scope.sessionId,
        bindingId: scope.bindingId,
        gatewayNodeId: scope.gatewayNodeId,
        env: env(),
        now: new Date("2026-07-20T12:00:00.000Z"),
    });
    assert.equal(resolved.selected, true);
    assert.equal(resolved.active, true);
    assert.equal(resolved.scopeType, "canary");
    assert.equal(resolved.authorizationExpiresAt?.toISOString(), scope.expiresAt);
    assert.equal(resolved.scope?.changeRef, "change-123");
    assert.equal(resolveDeviceTunnelCanary({
        locationId: "another-location",
        sessionId: scope.sessionId,
        bindingId: scope.bindingId,
        env: env(),
    }).selected, false);
});

test("graduated production selection remains exact and has no expiry fence", () => {
    const resolved = resolveDeviceTunnelCanary({
        locationId: scope.locationId,
        sessionId: scope.sessionId,
        bindingId: scope.bindingId,
        gatewayNodeId: scope.gatewayNodeId,
        env: env({
            DEVICE_TUNNEL_CANARY_SCOPES: "[]",
            DEVICE_TUNNEL_PRODUCTION_SCOPES: JSON.stringify([productionScope]),
        }),
        now: new Date("2036-07-20T12:00:00.000Z"),
    });
    assert.equal(resolved.selected, true);
    assert.equal(resolved.active, true);
    assert.equal(resolved.scopeType, "production");
    assert.equal(resolved.authorizationExpiresAt, null);
    assert.equal(resolved.scope?.changeRef, productionScope.changeRef);
});

test("a selected scope rejects compatibility and an unselected scope rejects distributed tokens", () => {
    const selected = resolveDeviceTunnelCanary({
        locationId: scope.locationId, sessionId: scope.sessionId, bindingId: scope.bindingId,
        gatewayNodeId: scope.gatewayNodeId, env: env(), now: new Date("2026-07-20T12:00:00.000Z"),
    });
    assert.throws(() => requireAuthoritativeDeviceTunnelTokenMode({
        canary: selected, placementMode: "compatibility", gatewayPublicUrl: scope.gatewayUrl,
    }), /fresh distributed token/);
    const unselected = resolveDeviceTunnelCanary({
        locationId: "other", sessionId: scope.sessionId, bindingId: scope.bindingId, env: env(),
    });
    assert.throws(() => requireAuthoritativeDeviceTunnelTokenMode({
        canary: unselected, placementMode: "distributed_canary", gatewayPublicUrl: scope.gatewayUrl,
    }), /no exact canary scope/);
});

test("selected canaries fail closed when ownership or providers are incomplete", () => {
    const resolved = resolveDeviceTunnelCanary({
        locationId: scope.locationId,
        sessionId: scope.sessionId,
        bindingId: scope.bindingId,
        gatewayNodeId: "node-a",
        env: env({ WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY: "" }),
        now: new Date("2026-07-20T12:00:00.000Z"),
    });
    assert.equal(resolved.selected, true);
    assert.equal(resolved.active, false);
    assert.deepEqual(resolved.errors.sort(), ["r2_configuration_invalid", "wrong_gateway_node"]);
});

test("canary configuration rejects alternate endpoints, duplicates, and expired scopes", () => {
    assert.throws(() => parseDeviceTunnelCanaryScopes(env({
        DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([{ ...scope, gatewayUrl: "wss://evil.test/device-tunnel" }]),
    })), /trusted suffixes/);
    assert.throws(() => parseDeviceTunnelCanaryScopes(env({
        DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES: "example.test",
        DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([{ ...scope, gatewayUrl: "wss://node.example.test/device-tunnel" }]),
    })), /Android trust boundary/);
    assert.throws(() => parseDeviceTunnelCanaryScopes(env({
        DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([scope, scope]),
    })), /duplicate/);
    const expired = resolveDeviceTunnelCanary({
        locationId: scope.locationId,
        sessionId: scope.sessionId,
        bindingId: scope.bindingId,
        env: env(),
        now: new Date("2026-07-23T00:00:00.000Z"),
    });
    assert.equal(expired.active, false);
    assert.deepEqual(expired.errors, ["canary_scope_expired"]);
    const tooLong = resolveDeviceTunnelCanary({
        locationId: scope.locationId,
        sessionId: scope.sessionId,
        bindingId: scope.bindingId,
        env: env({
            DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([{ ...scope, expiresAt: "2026-08-20T00:00:00.000Z" }]),
        }),
        now: new Date("2026-07-20T12:00:00.000Z"),
    });
    assert.deepEqual(tooLong.errors, ["canary_scope_expiry_too_distant"]);
});
