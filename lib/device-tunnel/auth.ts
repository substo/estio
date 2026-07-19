import crypto from "crypto";
import jwt from "jsonwebtoken";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const TUNNEL_TOKEN_TTL = "15m";

export type DeviceTunnelTokenPayload = {
    deviceId: string;
    locationId: string;
    bindingId: string;
    credentialVersion: number;
    purpose: "device_tunnel";
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
    deviceId: string;
    locationId: string;
    bindingId: string;
    credentialVersion: number;
}): string {
    return jwt.sign(
        {
            deviceId: args.deviceId,
            locationId: args.locationId,
            bindingId: args.bindingId,
            credentialVersion: args.credentialVersion,
            purpose: "device_tunnel",
        },
        getTunnelJwtSecret(),
        { algorithm: "HS256", expiresIn: TUNNEL_TOKEN_TTL },
    );
}

export function verifyDeviceTunnelToken(token: string): DeviceTunnelTokenPayload {
    const payload = jwt.verify(token, getTunnelJwtSecret(), {
        algorithms: ["HS256"],
    }) as DeviceTunnelTokenPayload;
    if (payload.purpose !== "device_tunnel") throw new Error("Invalid tunnel token purpose");
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
