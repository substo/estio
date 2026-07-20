import crypto from "crypto";
import jwt from "jsonwebtoken";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
export const DEVICE_TUNNEL_TOKEN_AUDIENCE = "device-tunnel-gateway";
export const DEVICE_TUNNEL_TOKEN_TTL_SECONDS = 5 * 60;

export type DeviceTunnelTokenPayload = {
    aud: string;
    nodeId: string;
    sessionId: string;
    deviceId: string;
    locationId: string;
    bindingId: string;
    assignmentEpoch: number;
    credentialVersion: number;
    purpose: "device_tunnel";
    jti: string;
    iat: number;
    exp: number;
};

function getTunnelJwtSecret(): string {
    const secret = String(process.env.DEVICE_TUNNEL_JWT_SECRET || "").trim();
    if (!secret) throw new Error("DEVICE_TUNNEL_JWT_SECRET is not configured");
    if (secret.length < 32) throw new Error("DEVICE_TUNNEL_JWT_SECRET must contain at least 32 characters");
    return secret;
}

export function generateTunnelChallenge() {
    const challenge = crypto.randomBytes(32).toString("base64url");
    return {
        challenge,
        challengeHash: hashTunnelChallenge(challenge),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    };
}

export function hashTunnelChallenge(challenge: string): string {
    return crypto.createHash("sha256").update(String(challenge || "")).digest("hex");
}

export function validateTunnelPublicKey(publicKeyBase64: string): boolean {
    try {
        const key = crypto.createPublicKey({
            key: Buffer.from(publicKeyBase64, "base64"),
            format: "der",
            type: "spki",
        });
        return key.asymmetricKeyType === "ec";
    } catch {
        return false;
    }
}

export function verifyTunnelChallengeSignature(args: {
    publicKeyBase64: string;
    challenge: string;
    signatureBase64: string;
}): boolean {
    try {
        const key = crypto.createPublicKey({
            key: Buffer.from(args.publicKeyBase64, "base64"),
            format: "der",
            type: "spki",
        });
        return crypto.verify(
            "sha256",
            Buffer.from(args.challenge, "utf8"),
            key,
            Buffer.from(args.signatureBase64, "base64"),
        );
    } catch {
        return false;
    }
}

export function issueDeviceTunnelToken(args: {
    nodeId: string;
    sessionId: string;
    deviceId: string;
    locationId: string;
    bindingId: string;
    assignmentEpoch: number;
    credentialVersion: number;
}): string {
    if (
        !args.nodeId
        || !args.sessionId
        || !args.deviceId
        || !args.locationId
        || !args.bindingId
        || !Number.isSafeInteger(args.assignmentEpoch)
        || args.assignmentEpoch < 0
    ) {
        throw new Error("Device tunnel token scope is invalid");
    }
    return jwt.sign(
        {
            nodeId: args.nodeId,
            sessionId: args.sessionId,
            deviceId: args.deviceId,
            locationId: args.locationId,
            bindingId: args.bindingId,
            assignmentEpoch: args.assignmentEpoch,
            credentialVersion: args.credentialVersion,
            purpose: "device_tunnel",
        },
        getTunnelJwtSecret(),
        {
            algorithm: "HS256",
            audience: DEVICE_TUNNEL_TOKEN_AUDIENCE,
            jwtid: crypto.randomUUID(),
            expiresIn: DEVICE_TUNNEL_TOKEN_TTL_SECONDS,
        },
    );
}

export function verifyDeviceTunnelToken(token: string, expectedNodeId?: string): DeviceTunnelTokenPayload {
    const payload = jwt.verify(token, getTunnelJwtSecret(), {
        algorithms: ["HS256"],
        audience: DEVICE_TUNNEL_TOKEN_AUDIENCE,
    }) as DeviceTunnelTokenPayload;
    if (payload.purpose !== "device_tunnel") throw new Error("Invalid tunnel token purpose");
    if (
        !payload.nodeId
        || !payload.sessionId
        || !payload.deviceId
        || !payload.locationId
        || !payload.bindingId
        || !payload.jti
        || !Number.isSafeInteger(payload.assignmentEpoch)
        || payload.assignmentEpoch < 0
    ) {
        throw new Error("Tunnel token scope is incomplete");
    }
    if (expectedNodeId && payload.nodeId !== expectedNodeId) throw new Error("Tunnel token belongs to another gateway node");
    return payload;
}

export function maskIpAddress(value: string): string | null {
    const ip = String(value || "").trim();
    if (!ip) return null;
    if (ip.includes(":")) {
        const parts = ip.split(":").filter(Boolean);
        return `${parts.slice(0, 3).join(":")}::/48`;
    }
    const parts = ip.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}
