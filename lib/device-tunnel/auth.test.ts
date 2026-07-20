import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
    DEVICE_TUNNEL_TOKEN_AUDIENCE,
    DEVICE_TUNNEL_TOKEN_TTL_SECONDS,
    generateTunnelChallenge,
    hashTunnelChallenge,
    issueDeviceTunnelToken,
    maskIpAddress,
    validateTunnelPublicKey,
    verifyDeviceTunnelToken,
    verifyTunnelChallengeSignature,
} from "./auth";

test("validates P-256 challenge signatures", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const { challenge, challengeHash } = generateTunnelChallenge();
    const signatureBase64 = crypto.sign("sha256", Buffer.from(challenge), privateKey).toString("base64");

    assert.equal(validateTunnelPublicKey(publicKeyBase64), true);
    assert.equal(hashTunnelChallenge(challenge), challengeHash);
    assert.equal(verifyTunnelChallengeSignature({ publicKeyBase64, challenge, signatureBase64 }), true);
    assert.equal(verifyTunnelChallengeSignature({ publicKeyBase64, challenge: `${challenge}x`, signatureBase64 }), false);
});

test("issues scoped short-lived tunnel tokens", () => {
    process.env.DEVICE_TUNNEL_JWT_SECRET = "test-device-tunnel-secret-that-is-long-enough";
    const token = issueDeviceTunnelToken({
        nodeId: "node-a",
        sessionId: "session-1",
        deviceId: "device-1",
        locationId: "location-1",
        bindingId: "binding-1",
        assignmentEpoch: 7,
        credentialVersion: 2,
    });
    const payload = verifyDeviceTunnelToken(token);
    assert.equal(payload.purpose, "device_tunnel");
    assert.equal(payload.bindingId, "binding-1");
    assert.equal(payload.aud, DEVICE_TUNNEL_TOKEN_AUDIENCE);
    assert.equal(payload.nodeId, "node-a");
    assert.equal(payload.sessionId, "session-1");
    assert.equal(payload.deviceId, "device-1");
    assert.equal(payload.locationId, "location-1");
    assert.equal(payload.assignmentEpoch, 7);
    assert.equal(payload.credentialVersion, 2);
    assert.ok(payload.jti);
    assert.equal(payload.exp - payload.iat, DEVICE_TUNNEL_TOKEN_TTL_SECONDS);
    assert.throws(() => verifyDeviceTunnelToken(token, "node-b"), /another gateway node/);
});

test("rejects a tunnel token with the wrong audience", () => {
    process.env.DEVICE_TUNNEL_JWT_SECRET = "test-device-tunnel-secret-that-is-long-enough";
    const token = jwt.sign({
        nodeId: "node-a",
        sessionId: "session-1",
        deviceId: "device-1",
        locationId: "location-1",
        bindingId: "binding-1",
        assignmentEpoch: 1,
        credentialVersion: 1,
        purpose: "device_tunnel",
    }, process.env.DEVICE_TUNNEL_JWT_SECRET, {
        algorithm: "HS256",
        audience: "wrong-audience",
        jwtid: crypto.randomUUID(),
        expiresIn: 300,
    });
    assert.throws(() => verifyDeviceTunnelToken(token, "node-a"), /audience/);
});

test("masks IP addresses for status storage", () => {
    assert.equal(maskIpAddress("203.0.113.44"), "203.0.113.0/24");
    assert.equal(maskIpAddress("2001:db8:abcd:1::9"), "2001:db8:abcd::/48");
    assert.equal(maskIpAddress("not-an-ip"), null);
});
