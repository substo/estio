import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
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
        deviceId: "device-1",
        locationId: "location-1",
        bindingId: "binding-1",
        credentialVersion: 2,
    });
    const payload = verifyDeviceTunnelToken(token);
    assert.equal(payload.purpose, "device_tunnel");
    assert.equal(payload.bindingId, "binding-1");
    assert.equal(payload.credentialVersion, 2);
    assert.ok(payload.exp > payload.iat);
});

test("masks IP addresses for status storage", () => {
    assert.equal(maskIpAddress("203.0.113.44"), "203.0.113.0/24");
    assert.equal(maskIpAddress("2001:db8:abcd:1::9"), "2001:db8:abcd::/48");
    assert.equal(maskIpAddress("not-an-ip"), null);
});
